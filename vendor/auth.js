/**
 * MisakaAuth —— 全站统一鉴权公共件
 * =========================================================
 * 「一个主密码管全站」的落地件：登录、登录态存取、带 token 调用云函数、
 * 以及各模块解锁口令（派生密钥）的会话级缓存。
 *
 * 设计约束（阶段 0 实测得出，别改）：
 *  1. **token 只能走 Authorization 请求头**。云开发的 HTTP 访问服务会
 *     自动回显任意 Origin 的 CORS（连 evil.example.com 都放通），
 *     若把身份放进 Cookie，任何站点都能诱导浏览器带身份调写接口。
 *  2. 登录态（token）存 localStorage —— 长期记住，跟以往一致。
 *  3. 解密密钥（CryptoKey）存 sessionStorage —— 同一标签页刷新不丢，
 *     关掉标签页即失效。**绝不写 localStorage**。
 *
 * 后端路由见 cloudfunctions/api/index.js。
 * 用法：<script src="../js/lib/secrets.js?v=..."> 先于 auth.js 加载
 * =========================================================
 */
(function (root) {
  'use strict';

  // 刻意留空：不内置任何作者私有的后端地址。云模式由用户在「设置 → 云端同步」里填自己的 API。
  var DEFAULT_API_BASE = '';
  var LS_TOKEN = 'misakaToken';      // 登录态（长期）
  var SS_KEY_PREFIX = 'misakaKey:';  // 派生密钥缓存（本标签页）
  var CALL_TIMEOUT_MS = 25000;

  function base() {
    var b = root.MISAKA_API_BASE || DEFAULT_API_BASE;
    return String(b).replace(/\/+$/, '');
  }

  function secrets() { return root.MisakaSecrets; }

  /* ---------- 登录态 ---------- */
  function token() {
    try { return localStorage.getItem(LS_TOKEN) || ''; } catch (e) { return ''; }
  }
  function setToken(t) {
    try { localStorage.setItem(LS_TOKEN, String(t || '')); } catch (e) { /* ignore */ }
  }
  function clearToken() {
    try { localStorage.removeItem(LS_TOKEN); } catch (e) { /* ignore */ }
  }
  function isLoggedIn() { return !!token(); }

  /* ---------- 网络 ---------- */
  function request(path, opts) {
    opts = opts || {};
    var url = base() + '/' + String(path).replace(/^\/+/, '');
    if (opts.query) {
      var qs = [];
      Object.keys(opts.query).forEach(function (k) {
        if (opts.query[k] != null) qs.push(encodeURIComponent(k) + '=' + encodeURIComponent(opts.query[k]));
      });
      if (qs.length) url += (url.indexOf('?') === -1 ? '?' : '&') + qs.join('&');
    }
    var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, opts.timeout || CALL_TIMEOUT_MS) : null;

    var init = {
      method: opts.method || 'GET',
      cache: 'no-store',
      headers: {}
    };
    if (ctrl) init.signal = ctrl.signal;
    if (opts.body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    if (opts.auth !== false) {
      var t = token();
      if (t) init.headers['Authorization'] = 'Bearer ' + t;
    }

    return fetch(url, init).then(function (r) {
      return r.text().then(function (txt) {
        var data = null;
        try { data = JSON.parse(txt); } catch (e) { data = { ok: false, msg: '响应不是 JSON（HTTP ' + r.status + '）' }; }
        return { status: r.status, data: data };
      });
    }).then(function (res) {
      if (timer) clearTimeout(timer);
      return res.data;
    }).catch(function (e) {
      if (timer) clearTimeout(timer);
      var err = new Error(e && e.name === 'AbortError' ? '请求超时' : ('网络不可达（' + (e && e.message ? e.message : e) + '）'));
      err.code = 'network';
      throw err;
    });
  }

  /** 登录：成功则自动写入登录态 */
  function login(password) {
    return request('/auth/login', { method: 'POST', body: { password: password }, auth: false })
      .then(function (j) {
        if (j && j.ok && j.token) { setToken(j.token); return { token: j.token, exp: j.exp }; }
        var e = new Error((j && j.msg) || '登录失败');
        e.code = 'login';
        e.status = j && j.code;
        throw e;
      });
  }

  /** 校验当前登录态是否还有效（服务器侧判定） */
  function ping() {
    return request('/auth/ping').then(function (j) { return !!(j && j.ok && j.valid); })
      .catch(function () { return false; });
  }

  function logout() {
    clearToken();
    forgetKeys();
  }

  /* ---------- 各模块的解锁密钥（会话级缓存） ---------- */
  function keySlot(name) { return SS_KEY_PREFIX + String(name); }

  /**
   * 用口令解锁某模块：派生密钥并缓存到本标签页。
   * 缓存里带 salt/iterations 指纹 —— salt 一变（改过密码）缓存自动作废。
   */
  function unlock(name, password, saltB64, iterations) {
    var S = secrets();
    if (!S) return Promise.reject(new Error('未加载 secrets.js'));
    return S.deriveKey(password, saltB64, iterations).then(function (key) {
      return S.exportKey(key).then(function (b64) {
        try {
          sessionStorage.setItem(keySlot(name), JSON.stringify({
            salt: saltB64, iterations: iterations, key: b64
          }));
        } catch (e) { /* 存不下也不影响本次解锁 */ }
        return key;
      });
    });
  }

  /** 取本标签页缓存的密钥；salt 不匹配或不存在则返回 null */
  function cachedKey(name, saltB64, iterations) {
    var S = secrets();
    if (!S) return Promise.resolve(null);
    var raw = null;
    try { raw = sessionStorage.getItem(keySlot(name)); } catch (e) { return Promise.resolve(null); }
    if (!raw) return Promise.resolve(null);
    var rec = null;
    try { rec = JSON.parse(raw); } catch (e) { return Promise.resolve(null); }
    if (!rec || !rec.key) return Promise.resolve(null);
    // salt 或迭代次数变了 → 缓存里的密钥已经不对，丢弃
    if (saltB64 && rec.salt !== saltB64) return Promise.resolve(null);
    if (iterations && Number(rec.iterations) !== Number(iterations)) return Promise.resolve(null);
    return S.importKey(rec.key).catch(function () { return null; });
  }

  function forgetKey(name) {
    try { sessionStorage.removeItem(keySlot(name)); } catch (e) { /* ignore */ }
  }
  function forgetKeys() {
    try {
      var del = [];
      for (var i = 0; i < sessionStorage.length; i++) {
        var k = sessionStorage.key(i);
        if (k && k.indexOf(SS_KEY_PREFIX) === 0) del.push(k);
      }
      del.forEach(function (k) { sessionStorage.removeItem(k); });
    } catch (e) { /* ignore */ }
  }

  root.MisakaAuth = {
    base: base,
    token: token,
    setToken: setToken,
    clearToken: clearToken,
    isLoggedIn: isLoggedIn,
    request: request,
    login: login,
    ping: ping,
    logout: logout,
    unlock: unlock,
    cachedKey: cachedKey,
    forgetKey: forgetKey,
    forgetKeys: forgetKeys
  };
})(window);
