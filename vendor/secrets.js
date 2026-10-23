/**
 * MisakaSecrets —— 客户端加解密公共件
 * =========================================================
 * 给「静态站点上公开可下载的数据」做真加密：公开部分保持明文，
 * 敏感部分整体加密成一个密文块，只有输入口令才就地解开。
 *
 * 密文块结构（与足迹地图 v19 完全同构，可互相搬运）：
 *   {
 *     v: 1,
 *     kdf:    { name:'PBKDF2', hash:'SHA-256', iterations: 600000, salt: <base64> },
 *     cipher: { name:'AES-GCM', iv: <base64 12B> },
 *     data:   <base64（密文 || 16B 认证标签）>
 *   }
 *
 * 关键性质：
 *  1. 口令 → PBKDF2-SHA256(600000) → AES-256-GCM 密钥；
 *     口令对不对由 GCM 认证标签判定（不会"解出错数据"）。
 *  2. 密钥**绝不落盘**：调用方只把 CryptoKey 留在内存，或按本文件
 *     提供的约定存进 sessionStorage（关掉标签页即失效）。
 *  3. 本文件不懂任何业务，纯工具。任何模块都能引。
 *
 * 依赖：WebCrypto（https / localhost 才有；http 裸域与 file:// 不可用）
 * 用法：<script src="../js/lib/secrets.js?v=YYYYMMDDx"></script>
 *       window.MisakaSecrets.deriveKey(pwd, salt, iter).then(...)
 * =========================================================
 */
(function (root) {
  'use strict';

  var PBKDF2_ITER = 600000;   // 与 _tools/set-main-pass.js、足迹地图 v19 保持一致
  var GCM_IV_BYTES = 12;
  var GCM_TAG_BITS = 128;
  var EXPORT_SALT_BYTES = 16;
  var BIN_MAGIC = 'MISKPHOT';  // 二进制密文的 8 字节魔数（识别「这是加密过的图」）

  function available() {
    return !!(root.crypto && root.crypto.subtle && root.crypto.getRandomValues && root.TextEncoder);
  }

  function b64ToBuf(b64) {
    var bin = atob(String(b64));
    var u8 = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
  }
  function bufToB64(buf) {
    var u8 = new Uint8Array(buf), bin = '';
    for (var i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
    return btoa(bin);
  }
  function randomSalt() {
    return bufToB64(root.crypto.getRandomValues(new Uint8Array(EXPORT_SALT_BYTES)));
  }
  function enc(str) { return new TextEncoder().encode(str); }
  function dec(buf) { return new TextDecoder().decode(buf); }

  /** 口令 → AES-GCM 密钥（PBKDF2-SHA256） */
  function deriveKey(pwd, saltB64, iterations) {
    if (!available()) return Promise.reject(new Error('no-webcrypto'));
    var iter = Number(iterations) || PBKDF2_ITER;
    var salt;
    try {
      // salt 必须是 base64。传裸字符串时 atob 会抛 InvalidCharacterError，
      // 错误信息很难懂，这里换成一句人话（踩过一次：KDF.salt 写成 'misaka-media-v1'）。
      salt = b64ToBuf(saltB64);
    } catch (e) {
      return Promise.reject(new Error('salt 不是合法的 base64：' + saltB64));
    }
    if (!salt.length) return Promise.reject(new Error('salt 不能为空'));
    return root.crypto.subtle.importKey('raw', enc(String(pwd)), 'PBKDF2', false, ['deriveKey'])
      .then(function (base) {
        return root.crypto.subtle.deriveKey(
          { name: 'PBKDF2', salt: salt, iterations: iter, hash: 'SHA-256' },
          base,
          { name: 'AES-GCM', length: 256 },
          true,                       // extractable：需要它才能把密钥缓存进 sessionStorage
          ['encrypt', 'decrypt']
        );
      });
  }

  /** 导出密钥为 base64（用于本标签页内缓存，避免每次刷新都跑 60 万次 PBKDF2） */
  function exportKey(key) {
    return root.crypto.subtle.exportKey('raw', key).then(bufToB64);
  }
  function importKey(b64) {
    if (!available()) return Promise.reject(new Error('no-webcrypto'));
    return root.crypto.subtle.importKey('raw', b64ToBuf(b64), { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  }

  /**
   * 加密。value 会先 JSON.stringify。
   * @returns Promise<密文块>
   */
  function seal(key, value, kdfMeta) {
    if (!key) return Promise.reject(new Error('no-key'));
    var iv = root.crypto.getRandomValues(new Uint8Array(GCM_IV_BYTES));
    return root.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv, tagLength: GCM_TAG_BITS },
      key,
      enc(JSON.stringify(value))
    ).then(function (buf) {
      return {
        v: 1,
        kdf: {
          name: 'PBKDF2',
          hash: 'SHA-256',
          iterations: (kdfMeta && kdfMeta.iterations) || PBKDF2_ITER,
          salt: (kdfMeta && kdfMeta.salt) || ''
        },
        cipher: { name: 'AES-GCM', iv: bufToB64(iv) },
        data: bufToB64(buf)
      };
    });
  }

  /**
   * 解密。
   * @returns Promise<解析后的 JSON 值>；口令不对 / 密文被改动 → reject
   */
  function open(key, blob) {
    if (!key) return Promise.reject(new Error('no-key'));
    if (!isBlob(blob)) return Promise.reject(new Error('bad-blob'));
    return root.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: b64ToBuf(blob.cipher.iv), tagLength: GCM_TAG_BITS },
      key,
      b64ToBuf(blob.data)
    ).then(function (buf) {
      return JSON.parse(dec(buf));
    });
  }

  /** 是否是本文件产出的密文块 */
  function isBlob(b) {
    return !!(b && typeof b === 'object' && b.v && b.kdf && b.cipher && typeof b.data === 'string' && b.data);
  }

  /**
   * 加密任意二进制（私密写真用）。
   * 输出紧凑二进制：[8B 魔数][12B iv][AES-GCM 密文（含 16B 认证标签）]，
   * **不做 base64/JSON 包装** —— 直接当 .bin 文件上传，避免体积膨胀 33%。
   * 密文是均匀随机字节，云厂商的图片审核系统物理上无法识别内容。
   * @returns Promise<Uint8Array>
   */
  function encryptBytes(key, buf) {
    if (!key) return Promise.reject(new Error('no-key'));
    var iv = root.crypto.getRandomValues(new Uint8Array(GCM_IV_BYTES));
    return root.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv, tagLength: GCM_TAG_BITS },
      key,
      buf
    ).then(function (ct) {
      var magic = enc(BIN_MAGIC);
      var out = new Uint8Array(magic.length + GCM_IV_BYTES + ct.byteLength);
      out.set(magic, 0);
      out.set(iv, magic.length);
      out.set(new Uint8Array(ct), magic.length + GCM_IV_BYTES);
      return out;
    });
  }

  /**
   * 解密 encryptBytes 的产物。
   * @returns Promise<ArrayBuffer>（原始图片字节）
   */
  function decryptBytes(key, buf) {
    if (!key) return Promise.reject(new Error('no-key'));
    var u8 = (buf instanceof Uint8Array) ? buf : new Uint8Array(buf);
    var magic = enc(BIN_MAGIC);
    if (dec(u8.slice(0, magic.length)) !== BIN_MAGIC) {
      return Promise.reject(new Error('not-encrypted-binary'));
    }
    var iv = u8.slice(magic.length, magic.length + GCM_IV_BYTES);
    var ct = u8.slice(magic.length + GCM_IV_BYTES);
    return root.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv, tagLength: GCM_TAG_BITS },
      key,
      ct
    );
  }

  root.MisakaSecrets = {
    PBKDF2_ITER: PBKDF2_ITER,
    GCM_IV_BYTES: GCM_IV_BYTES,
    GCM_TAG_BITS: GCM_TAG_BITS,
    BIN_MAGIC: BIN_MAGIC,
    available: available,
    b64ToBuf: b64ToBuf,
    bufToB64: bufToB64,
    randomSalt: randomSalt,
    deriveKey: deriveKey,
    exportKey: exportKey,
    importKey: importKey,
    seal: seal,
    open: open,
    isBlob: isBlob,
    encryptBytes: encryptBytes,
    decryptBytes: decryptBytes
  };
})(window);
