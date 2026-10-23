/**
 * footprint-map · 运行时配置与环境层
 * =========================================================
 * 本文件在 app.js 之前加载，只做「决定数据从哪来、往哪去」。
 * 业务逻辑（渲染 / 筛选 / 表单）全部留在 app.js，不在这里重写。
 *
 * 三种运行模式（FP.effectiveMode() 决定）：
 *   local  —— 浏览器本地库（localStorage）。file:// 双击可用，数据全在本机，
 *             改动立即持久化，刷新/下次打开还在，靠导出 JSON 备份和搬移。
 *   static —— 静态托管但没有配远端 API。读 seed.js 的初始数据，改动存本机。
 *   cloud  —— 配了远端 API base。走 /map/list → /map/ops 同步，可跨设备。
 *
 * 为什么要分这三种：一份代码要同时满足「双击能开」「上传就能用」
 * 「想同步再接云」三个场景，而这三者的数据源和持久化方式完全不同。
 * =========================================================
 */
(function (root) {
  'use strict';

  var LS_SETTINGS = 'fp_settings_v1';
  var LS_DB       = 'fp_db_v1';
  var SS_UNLOCK   = 'fp_unlocked_v1';
  var LS_PWD      = 'fp_pwd_v1';

  function safeGet(store, k) {
    try { return store.getItem(k); } catch (e) { return null; }
  }
  function safeSet(store, k, v) {
    try { store.setItem(k, v); return true; }
    catch (e) { return false; }   // 配额满 / 隐私模式
  }

  /* ---------- 环境探测 ---------- */
  var env = {
    fileProtocol: root.location.protocol === 'file:',
    // WebCrypto 只在 https / localhost 等安全上下文里可用；file:// 下 crypto.subtle 是 undefined
    webCrypto: !!(root.crypto && root.crypto.subtle && (root.isSecureContext !== false)),
    secure: root.isSecureContext === true,
    // 浏览器禁用了本地存储（隐私模式 / 策略限制）时，本地模式存不下东西，必须提前告知
    storage: (function () {
      try {
        var k = '__fp_probe__';
        root.localStorage.setItem(k, '1');
        root.localStorage.removeItem(k);
        return true;
      } catch (e) { return false; }
    })()
  };

  /* ---------- 设置 ---------- */
  function readSettings() {
    var raw = safeGet(root.localStorage, LS_SETTINGS);
    var d = { mode: 'auto', apiBase: '', title: '', tiandituTk: '' };
    if (!raw) return d;
    try {
      var p = JSON.parse(raw);
      if (p && typeof p === 'object') {
        if (typeof p.mode === 'string') d.mode = p.mode;
        if (typeof p.apiBase === 'string') d.apiBase = p.apiBase;
        if (typeof p.title === 'string') d.title = p.title;
        if (typeof p.tiandituTk === 'string') d.tiandituTk = p.tiandituTk;
      }
    } catch (e) { /* 坏数据就当没存过 */ }
    return d;
  }

  function writeSettings(patch) {
    var s = readSettings();
    Object.keys(patch || {}).forEach(function (k) { s[k] = patch[k]; });
    safeSet(root.localStorage, LS_SETTINGS, JSON.stringify(s));
    return s;
  }

  /**
   * 实际生效的模式。
   * auto 的判定顺序：配了 apiBase → cloud；否则 file:// 或本机有库 → local；否则 static。
   * 说明：auto 下不主动探测网络（探测会让首屏多等一次超时），由用户显式配置决定。
   */
  function effectiveMode() {
    var s = readSettings();
    if (s.mode === 'local' || s.mode === 'static' || s.mode === 'cloud') return s.mode;
    if (s.apiBase) return 'cloud';
    if (env.fileProtocol) return 'local';
    return 'static';
  }

  /* ---------- 本地数据库（local 模式的全量数据） ---------- */
  var localDB = {
    get: function () {
      var raw = safeGet(root.localStorage, LS_DB);
      if (!raw) return null;
      try {
        var p = JSON.parse(raw);
        if (!p || !Array.isArray(p.markers)) return null;
        return p;
      } catch (e) { return null; }
    },
    set: function (obj) {
      var ok = safeSet(root.localStorage, LS_DB, JSON.stringify(obj));
      if (!ok) throw new Error('浏览器本地存储写入失败（可能超出配额，建议先导出一份备份）');
      return ok;
    },
    clear: function () { try { root.localStorage.removeItem(LS_DB); } catch (e) { /* ignore */ } },
    bytes: function () {
      var raw = safeGet(root.localStorage, LS_DB);
      return raw ? raw.length : 0;
    }
  };

  /* ---------- 本地口令（只用来"挡一下"，不是加密） ---------- */
  /**
   * ⚠️ 本地模式下没有 WebCrypto，做不了真加密。这里的口令只决定
   * 「私密点要不要显示」，数据本身在 localStorage 里是明文。
   * UI 上必须如实告知，不能让人以为是加密保护。
   */

  /* 纯 JS SHA-256（file:// 下 WebCrypto 不可用时的兜底；只用于口令指纹比对） */
  var K256 = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];

  /**
   * SHA-256（纯 JS，仅用于口令指纹）。
   * 密码学强度不是这里的目的 —— file:// 下没有 WebCrypto，
   * 而这里只需要「同一口令算同一个值、不同口令算不出碰撞」。
   */
  function sha256(ascii) {
    function rr(v, a) { return (v >>> a) | (v << (32 - a)); }
    var maxWord = Math.pow(2, 32);
    var i, j, result = '', words = [];
    var asciiBitLength = ascii.length * 8;
    var hash = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
                0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var k = K256;

    ascii += '\x80';
    while (ascii.length % 64 - 56) ascii += '\x00';
    for (i = 0; i < ascii.length; i++) {
      j = ascii.charCodeAt(i);
      if (j >> 8) return '';                 // 只吃 ASCII，调用前先转 UTF-8 字节串
      words[i >> 2] |= j << ((3 - i) % 4) * 8;
    }
    words[words.length] = (asciiBitLength / maxWord) | 0;
    words[words.length] = asciiBitLength;

    for (j = 0; j < words.length;) {
      var w = words.slice(j, j += 16);
      var oldHash = hash.slice(0, 8);
      hash = hash.slice(0, 8);
      for (i = 0; i < 64; i++) {
        var w15 = w[i - 15], w2 = w[i - 2];
        var a = hash[0], e = hash[4];
        var temp1 = (hash[7]
          + (rr(e, 6) ^ rr(e, 11) ^ rr(e, 25))
          + ((e & hash[5]) ^ ((~e) & hash[6]))
          + k[i]
          + (w[i] = (i < 16) ? (w[i] | 0) : (
              w[i - 16]
              + (rr(w15, 7) ^ rr(w15, 18) ^ (w15 >>> 3))
              + w[i - 7]
              + (rr(w2, 17) ^ rr(w2, 19) ^ (w2 >>> 10))
            ) | 0)) | 0;
        var temp2 = ((rr(a, 2) ^ rr(a, 13) ^ rr(a, 22))
          + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]))) | 0;
        hash = [(temp1 + temp2) | 0].concat(hash);
        hash[4] = (hash[4] + temp1) | 0;
      }
      for (i = 0; i < 8; i++) hash[i] = (hash[i] + oldHash[i]) | 0;
    }

    for (i = 0; i < 8; i++) {
      for (j = 3; j + 1; j--) {
        var b = (hash[i] >> (j * 8)) & 255;
        result += ((b < 16) ? '0' : '') + b.toString(16);
      }
    }
    return result;
  }

  /** 口令指纹 = SHA-256(salt + 口令)。salt 固定，只用于区分不同口令 */
  function fingerprint(pwd) {
    var s = 'fp-local-v1:' + String(pwd || '');
    // SHA-256 的本实现只吃 ASCII，中文口令先转 UTF-8 字节串
    var bytes = '';
    try {
      bytes = unescape(encodeURIComponent(s));
    } catch (e) { bytes = s; }
    var h = sha256(bytes);
    return h ? 'h1:' + h : 'h1:' + bytes.length + ':' + bytes.split('').map(function (c) {
      return c.charCodeAt(0).toString(16);
    }).join('');
  }

  var pwd = {
    has: function () { return !!safeGet(root.localStorage, LS_PWD); },
    set: function (v) { return safeSet(root.localStorage, LS_PWD, fingerprint(v)); },
    check: function (v) { return safeGet(root.localStorage, LS_PWD) === fingerprint(v); },
    clear: function () { try { root.localStorage.removeItem(LS_PWD); } catch (e) { /* ignore */ } }
  };

  /* ---------- 会话级解锁态（关标签页即失效） ---------- */
  var session = {
    unlocked: function () { return safeGet(root.sessionStorage, SS_UNLOCK) === '1'; },
    markUnlocked: function () { safeSet(root.sessionStorage, SS_UNLOCK, '1'); },
    clearUnlocked: function () { try { root.sessionStorage.removeItem(SS_UNLOCK); } catch (e) { /* ignore */ } }
  };

  /* ---------- 初始数据 ---------- */
  /** seed.js 挂在 window.__FP_SEED__；没有就退回空图 */
  function seed() {
    var s = root.__FP_SEED__;
    if (s && Array.isArray(s.markers)) return s;
    return {
      config: { defaultCenter: [35.0, 105.0], defaultZoom: 5, title: '我的足迹地图' },
      categories: [
        { key: 'journey', name: '路程', icon: 'red-dot', inRoute: true },
        { key: 'food', name: '🍜 好吃的', icon: 'orange-fork', inRoute: false },
        { key: 'sight', name: '🏞️ 风景', icon: 'blue-mountain', inRoute: false }
      ],
      markers: []
    };
  }

  /* ---------- 对外 ---------- */
  root.FP = {
    env: env,
    settings: readSettings,
    saveSettings: writeSettings,
    effectiveMode: effectiveMode,
    isLocal: function () { return effectiveMode() === 'local'; },
    isCloud: function () { return effectiveMode() === 'cloud'; },
    localDB: localDB,
    pwd: pwd,
    session: session,
    seed: seed,
    keys: { settings: LS_SETTINGS, db: LS_DB, pwd: LS_PWD },
    _sha256: sha256   // 暴露给自检脚本，业务代码不用它
  };

  // 云模式：把 apiBase 交给 auth.js（它读 window.MISAKA_API_BASE）
  var st = readSettings();
  if (st.apiBase) root.MISAKA_API_BASE = st.apiBase;

})(window);
