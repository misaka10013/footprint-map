/**
 * footprint-map · 我的足迹地图 app.js
 * =========================================================
 * 一份代码，三种数据去处（模式由 config.js 的 FP.effectiveMode() 决定）：
 *
 *  local  —— 浏览器本地库（localStorage fp_db_v1）。file:// 双击可用，
 *            改动立即落本机，不联网、不请求任何接口。
 *  static —— 静态托管但没有配远端 API。初始数据来自 seed.js，改动同样落本机。
 *  cloud  —— 配了远端 API base。走 /map/list → /map/ops 同步，可跨设备、可多端。
 *
 * 本地两种模式共用一条路径（loadLocalDB / persistLocal），区别只在 UI 文案。
 *
 * 云端模式的数据架构（原设计，未改）：
 *  云端（主）  { items:[公开点位…], priv:[{id,blob}…], categories, config, kdf, rev }
 *  快照（备）  data.json —— 云端不可达时回退。只含公开点位。
 *  草稿（本地）localStorage mapDraft_v1 = { rev, ops:[…] } op 变更日志
 * ========================================================= */
(function () {
  'use strict';

  /* =========================================================
   * 运行模式（config.js 先于本文件加载）
   * ========================================================= */
  var FP = window.FP || null;
  /** 非云模式 = 数据全在本机（local 与 static 行为一致，只有文案不同） */
  function isLocalLike() { return !FP || !FP.isCloud(); }
  function isFileMode() { return !!(FP && FP.env.fileProtocol); }

  /* =========================================================
   * 常量
   * ========================================================= */
  var LS_DRAFT_KEY = 'mapDraft_v1';      // 未提交的变更日志 { rev, ops }
  var LS_FILTER_KEY = 'mapFilterState';  // 筛选状态（与云化无关，沿用）
  var LS_LEGACY_DATA_KEY = 'mapData';    // v19 的整份快照 key —— 启动时清掉，别让它盖住云端数据

  // 会话密钥槽位：**与媒体库共用 'main'** —— 同一标签页里解锁过任一模块，
  // 打开另一个就不必再输一次密码。密钥只存 sessionStorage，关标签页即失效。
  var MODULE = 'main';
  var KDF = {                            // 私密密文块的派生参数
    name: 'PBKDF2', hash: 'SHA-256', iterations: 600000,
    // salt 必须是 base64（secrets.js 按 base64 解）—— 'misaka-main-v1' 的 base64。
    // 用固定常量：salt 本就在密文块里公开，固定它换来「跨设备、跨模块同一把钥匙」。
    // ⚠️ 改动此值 = 云端所有私密密文全部作废（改前必须重新加密一遍）。
    salt: 'bWlzYWthLW1haW4tdjE='
  };
  var SUBMIT_BATCH_BYTES = 64 * 1024;    // 网关请求体上限约 100 KB，留足余量
  var MAX_SUBMIT_OPS = 500;              // 后端硬限制：单次 op 数

  /* 默认底图：normal / satellite / osm / carto / esri
   * 也可在 data.json 的 config.defaultLayer 中覆盖此设置 */
  /* ===== GCJ-02 <-> WGS-84 坐标转换（国内火星坐标偏移修正） =====
     数据以 GCJ-02 存储（与高德底图一致）；切到 Esri/OSM/Carto 等 WGS-84 国际底图时，
     需把点位坐标反算成 WGS-84 再摆放，否则会偏移几百米。 */
  var GCJ = (function () {
    var PI = Math.PI, a = 6378245.0, ee = 0.00669342162296594323;
    function outOfChina(lat, lng) {
      return (lng < 72.004 || lng > 137.8347) || (lat < 0.8293 || lat > 55.8271);
    }
    function tLat(x, y) {
      var r = -100.0 + 2.0*x + 3.0*y + 0.2*y*y + 0.1*x*y + 0.2*Math.sqrt(Math.abs(x));
      r += (20.0*Math.sin(6.0*x*PI) + 20.0*Math.sin(2.0*x*PI)) * 2.0/3.0;
      r += (20.0*Math.sin(y*PI) + 40.0*Math.sin(y/3.0*PI)) * 2.0/3.0;
      r += (160.0*Math.sin(y/12.0*PI) + 320.0*Math.sin(y*PI/30.0)) * 2.0/3.0;
      return r;
    }
    function tLng(x, y) {
      var r = 300.0 + x + 2.0*y + 0.1*x*x + 0.1*x*y + 0.1*Math.sqrt(Math.abs(x));
      r += (20.0*Math.sin(6.0*x*PI) + 20.0*Math.sin(2.0*x*PI)) * 2.0/3.0;
      r += (20.0*Math.sin(x*PI) + 40.0*Math.sin(x/3.0*PI)) * 2.0/3.0;
      r += (150.0*Math.sin(x/12.0*PI) + 300.0*Math.sin(x/30.0*PI)) * 2.0/3.0;
      return r;
    }
    function wgs2gcj(wlat, wlng) {
      if (outOfChina(wlat, wlng)) return [wlat, wlng];
      var dLat = tLat(wlng-105.0, wlat-35.0), dLng = tLng(wlng-105.0, wlat-35.0);
      var radLat = wlat/180.0*PI, magic = Math.sin(radLat);
      magic = 1 - ee*magic*magic; var sq = Math.sqrt(magic);
      dLat = (dLat*180.0)/((a*(1-ee))/(magic*sq)*PI);
      dLng = (dLng*180.0)/(a/sq*Math.cos(radLat)*PI);
      return [wlat+dLat, wlng+dLng];
    }
    function gcj2wgs(glat, glng) {
      if (outOfChina(glat, glng)) return [glat, glng];
      var dLat = tLat(glng-105.0, glat-35.0), dLng = tLng(glng-105.0, glat-35.0);
      var radLat = glat/180.0*PI, magic = Math.sin(radLat);
      magic = 1 - ee*magic*magic; var sq = Math.sqrt(magic);
      dLat = (dLat*180.0)/((a*(1-ee))/(magic*sq)*PI);
      dLng = (dLng*180.0)/(a/sq*Math.cos(radLat)*PI);
      return [glat-dLat, glng-dLng];
    }
    return { wgs2gcj: wgs2gcj, gcj2wgs: gcj2wgs };
  })();

  var DEFAULT_LAYER_TYPE = 'satellite';

  /* 瓦片底图（不需要 API Key，直接使用瓦片服务） */
  var TILE_LAYERS = {
    normal: {
      name: '标准地图',
      crs: 'gcj02',
      url: 'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',
      options: { maxZoom: 18, subdomains: ['1', '2', '3', '4'], attribution: '&copy; 高德地图' }
    },
    satellite: {
      name: '卫星地图',
      crs: 'gcj02',
      url: 'https://webst0{s}.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}',
      options: { maxZoom: 19, subdomains: ['1', '2', '3', '4'], attribution: '&copy; 高德地图' }
    },
    osm: {
      name: 'OSM',
      crs: 'wgs84',
      url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      options: { maxZoom: 19, attribution: '&copy; OpenStreetMap' }
    },
    carto: {
      name: 'Carto 浅色',
      crs: 'wgs84',
      url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
      options: { maxZoom: 19, subdomains: 'abcd', attribution: '&copy; CartoDB' }
    },
    esri: {
      name: 'Esri 卫星',
      crs: 'wgs84',
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      options: { maxZoom: 19, attribution: '&copy; Esri, Maxar, Earthstar Geographics' }
    },
    tianditu: {
      name: '天地图卫星',
      crs: 'wgs84',
      // 天地图必须带自己的 tk（申请：https://console.tianditu.gov.cn/api/key）。
      // 这里刻意不内置任何 key —— 源码公开，内置 key 等于把配额送人。
      needsKey: true,
      url: 'https://t{s}.tianditu.gov.cn/DataServer?T=img_w&x={x}&y={y}&l={z}&tk={tk}',
      options: { maxZoom: 18, subdomains: '01234567', attribution: '&copy; 天地图' },
      overlay: {
        url: 'https://t{s}.tianditu.gov.cn/DataServer?T=cia_w&x={x}&y={y}&l={z}&tk={tk}',
        options: { maxZoom: 18, subdomains: '01234567', attribution: '&copy; 天地图' }
      }
    }
  };

  /* 内置 SVG 图标库（L.divIcon 使用） */
  var ICONS = {
    'red-dot':     '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20"><circle cx="10" cy="10" r="9" fill="#e74c3c" stroke="#fff" stroke-width="2"/></svg>',
    'gray-ring':   '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20"><circle cx="10" cy="10" r="8" fill="none" stroke="#95a5a6" stroke-width="2.5"/></svg>',
    'orange-fork': '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24"><path fill="#e67e22" d="M8 2c-1 3-1 5.5 0 8 0 .8.3 1.5 1 2v10h2V12c.7-.5 1-1.2 1-2 1-2.5 1-5 0-8h-2c.5 2 .5 3.5 0 5V2H8zm9 0c-2 1.5-3 4-3 7 0 2 .7 3.7 2 5v8h2v-8c1.3-1.3 2-3 2-5 0-3-1-5.5-3-7z"/></svg>',
    'gray-fork':   '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24"><path fill="#b8c2cc" d="M8 2c-1 3-1 5.5 0 8 0 .8.3 1.5 1 2v10h2V12c.7-.5 1-1.2 1-2 1-2.5 1-5 0-8h-2c.5 2 .5 3.5 0 5V2H8zm9 0c-2 1.5-3 4-3 7 0 2 .7 3.7 2 5v8h2v-8c1.3-1.3 2-3 2-5 0-3-1-5.5-3-7z"/></svg>',
    'brown-cup':   '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24"><path fill="#8e5a32" d="M5 3v7c0 3.9 3.1 7 7 7s7-3.1 7-7V3h-2v7a5 5 0 0 1-10 0V3H5zm14 9h2a3 3 0 0 1 0 6h-2.4A7 7 0 0 1 12 21a7 7 0 0 1-6.6-3H5a5 5 0 0 0 14 0z" opacity="0.9"/></svg>',
    'green-star':  '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24"><path fill="#27ae60" d="M12 2l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 17.5 5.9 20.6l1.4-6.8L2.2 9.1l6.9-.8L12 2z"/></svg>',
    'blue-mountain':'<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24"><path fill="#2980b9" d="M14 6l-4 8 3 1-1 3 6-10-2-1 1-2-3-1 1-2-3 1-1 3-2-1-1 2 3 1z" transform="translate(-1,-1)"/><path fill="#3498db" d="M3 20h18l-5-9-3 5-2-3-8 7z"/></svg>',
    'yellow-bulb': '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24"><path fill="#f1c40f" d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.2 1 2V18h6v-1.3c0-.8.4-1.5 1-2A7 7 0 0 0 12 2zm-2 18h4v1a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1v-1z"/><path fill="#f39c12" d="M10 17h4v1h-4z"/></svg>'
  };

  /* =========================================================
   * 全局状态
   * ========================================================= */
  var map = null;
  var currentLayerType = 'normal';
  var layerControl = null;
  var layerOverlay = null;
  var data = null;            // { config, categories, markers }
  var markers = {};           // id -> L.marker
  var layerGroups = {};       // 分组筛选: key -> L.layerGroup
  var routeLine = null;       // 路线折线
  var routeNumMarkers = [];   // 序号圆圈
  var routeMode = false;
  var editingId = null;       // 当前弹窗内编辑的 marker id
  var filterState = null;     // { journey_visited: true, food_want: true, ... }
  var timeFilter = { enabled: false, start: '', end: '', preset: 'all', endTouched: false };

  /* =========================================================
   * 工具函数
   * ========================================================= */

  /** 生成 marker id: m_{毫秒时间戳}_{随机4位} */
  function genId() {
    var chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    var rnd = '';
    for (var i = 0; i < 4; i++) {
      rnd += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return 'm_' + Date.now() + '_' + rnd;
  }

  /** 生成分类 key 的筛选 key：journey 拆分为已去/未去，food 拆分为吃过/想吃 */
  function filterKeyOf(category, visited) {
    if (category === 'journey') {
      return visited ? 'journey_visited' : 'journey_unvisited';
    }
    if (category === 'food') {
      return visited ? 'food_visited' : 'food_want';
    }
    return category;
  }

  /* ============ 私密点位（云端：逐条独立密文块） ============
   * 每条私密点位**单独**加密成一个密文块 {v,kdf,cipher,data}，云端只存密文；
   * 密钥由主密码经 PBKDF2-SHA256(600000) 派生（salt 固定 misaka-main-v1），
   * AES-256-GCM（iv 12B / tag 128b），口令对不对由 GCM 认证标签判定。
   * 明文只在内存；草稿、导出文件与静态快照里都只有密文或什么都没有。
   * ========================================================= */
  var privateUnlocked = false;   // 本会话是否已解锁私密点位
  var privateKey = null;         // 解锁后派生的 AES-GCM CryptoKey（仅内存，绝不落盘）
  var privBlobs = {};            // id -> 密文块 JSON 字符串（来自云端或本次草稿）
  var privOrder = [];            // 密文块 id 顺序（导出时保持稳定）
  var pubIds = {};               // id -> true：该 id 在云端/快照里是**公开**条目。
                                 // 用来判断"私密化"时要不要补一条 pubdel —— 不能拿内存里的
                                 // data.markers 判断，因为解锁后私密点也躺在里面，会误判。

  var draft = { rev: 0, ops: [] };                              // 本地未提交变更（op 日志）
  var cloud = { ok: false, rev: 0, exists: false, privCount: 0 }; // 云端状态（privCount 未解锁也拿得到）

  function secrets() { return window.MisakaSecrets; }
  function auth() { return window.MisakaAuth; }

  /** WebCrypto 是否可用（https / localhost 才有；file:// 或 http 裸域下不可用） */
  function hasWebCrypto() {
    var S = secrets();
    return !!(S && S.available());
  }

  /** 单条加密 -> 密文块 JSON 字符串 */
  function sealItem(item) {
    var S = secrets();
    if (!S) return Promise.reject(new Error('未加载 secrets.js'));
    if (!privateKey) return Promise.reject(new Error('未解锁，不能写入私密条目'));
    return S.seal(privateKey, item, KDF).then(function (b) { return JSON.stringify(b); });
  }

  /**
   * 把一条点位的当前状态记进草稿。
   * 自动区分公开/私密：私密点加密成块（priv op），公开点直接明文（pub op）；
   * 私密转公开时补一条 privdel，公开转私密时补一条 pubdel。
   */
  function commitMarker(m) {
    if (!m || !m.id) return Promise.resolve();
    if (m.isPrivate === true) {
      if (!privateUnlocked) {
        showNotice('🔒 未解锁，无法保存对私密点位的改动', 3500);
        return Promise.resolve();
      }
      var needPubDel = wasPublic(m.id);
      return sealItem(m).then(function (blob) {
        privBlobs[m.id] = blob;
        if (privOrder.indexOf(m.id) === -1) privOrder.push(m.id);
        recordOp({ k: 'priv', id: m.id, blob: blob });
        if (needPubDel) recordOp({ k: 'pubdel', id: m.id });
        pubIds[m.id] = false;
      }).catch(function (e) {
        showNotice('⚠️ 加密失败：' + (e && e.message ? e.message : e), 5000);
      });
    }
    var wasPriv = privBlobs[m.id] !== undefined || privOrder.indexOf(m.id) !== -1;
    if (wasPriv) {
      delete privBlobs[m.id];
      privOrder = privOrder.filter(function (x) { return x !== m.id; });
      recordOp({ k: 'privdel', id: m.id });
    }
    recordOp({ k: 'pub', item: m });
    pubIds[m.id] = (m.deleted !== true);
    return Promise.resolve();
  }

  /** 该 id 在云端/快照里当前是不是公开条目（决定"私密化"要不要补 pubdel） */
  function wasPublic(id) {
    return pubIds[id] === true;
  }

  /** 逐条解密云端密文块，并入内存（同 id 覆盖） */
  function decryptAllPrivate() {
    var S = secrets();
    if (!S || !privateKey) return Promise.resolve(0);
    var ids = Object.keys(privBlobs);
    if (!ids.length) return Promise.resolve(0);
    var idx = {};
    data.markers.forEach(function (m, i) { if (m && m.id) idx[m.id] = i; });
    var tasks = ids.map(function (id) {
      var blob = null;
      try { blob = JSON.parse(privBlobs[id]); } catch (e) { return Promise.resolve({ id: id, bad: true }); }
      return S.open(privateKey, blob).then(function (item) {
        return { id: id, item: item };
      }).catch(function () { return { id: id, bad: true }; });
    });
    return Promise.all(tasks).then(function (rs) {
      var n = 0, bad = 0;
      rs.forEach(function (r) {
        if (r.bad || !r.item || typeof r.item !== 'object') { bad++; return; }
        var m = r.item;
        m.isPrivate = true;
        m.id = r.id;                       // 以密文块的 key 为准，保证与云端对得上
        if (idx[m.id] !== undefined) data.markers[idx[m.id]] = m;
        else { idx[m.id] = data.markers.length; data.markers.push(m); }
        n++;
      });
      if (bad) console.warn('有 ' + bad + ' 条私密块解不开（可能是另一把口令加密的）');
      return n;
    });
  }

  /** 从内存移除私密点（重新锁定时调用） */
  function stripPrivateFromMemory() {
    if (!data || !Array.isArray(data.markers)) return;
    data.markers = data.markers.filter(function (m) { return m.isPrivate !== true; });
  }

  /* =========================================================
   * 本地草稿（op 变更日志）
   * ========================================================= */
  /** 记一笔变更：同一 id + 同一种操作只保留最后一个（拖动 100 次也只算一次） */
  function recordOp(op) {
    var id = String((op.item && op.item.id) || op.id || '');
    if (!id) return;
    draft.ops = draft.ops.filter(function (o) {
      var oid = String((o.item && o.item.id) || o.id || '');
      return !(oid === id && o.k === op.k);
    });
    draft.ops.push(op);
    saveDraft();
    updateSubmitBtn();
  }

  function saveDraft() {
    // 本机模式没有"未提交"这个概念：改动直接写进本机库，刷新/关页面都不丢
    if (isLocalLike()) { persistLocal(); return; }
    try { localStorage.setItem(LS_DRAFT_KEY, JSON.stringify(draft)); } catch (e) { /* ignore */ }
  }
  /** 读草稿；rev 对不上云端时仍保留 op（提交时会报冲突，由用户决定） */
  function loadDraft() {
    draft = { rev: cloud.rev || 0, ops: [] };
    if (isLocalLike()) return;                 // 本机模式不存草稿
    var raw = null;
    try { raw = localStorage.getItem(LS_DRAFT_KEY); } catch (e) { raw = null; }
    if (!raw) return;
    try {
      var p = JSON.parse(raw);
      if (p && Array.isArray(p.ops)) draft.ops = p.ops;
      draft.rev = (p && typeof p.rev === 'number') ? p.rev : (cloud.rev || 0);
    } catch (e) { /* ignore */ }
  }
  function clearDraft() {
    draft = { rev: cloud.rev || 0, ops: [] };
    try { localStorage.removeItem(LS_DRAFT_KEY); } catch (e) { /* ignore */ }
    updateSubmitBtn();
  }
  function pendingCount() { return draft.ops.length; }

  /** 把草稿里的变更回放到内存（刷新后仍能看到自己没提交的改动） */
  function applyDraft() {
    if (!draft.ops.length) return;
    var idx = {};
    data.markers.forEach(function (m, i) { if (m && m.id) idx[m.id] = i; });
    draft.ops.forEach(function (o) {
      if (!o) return;
      if (o.k === 'pub' && o.item && o.item.id) {
        pubIds[o.item.id] = (o.item.deleted !== true);
        if (o.item.deleted === true) {
          // 逻辑删除的墓碑：不要把它摆回地图上
          if (idx[o.item.id] !== undefined) {
            data.markers.splice(idx[o.item.id], 1);
            idx = {};
            data.markers.forEach(function (m, i) { if (m && m.id) idx[m.id] = i; });
          }
        } else if (idx[o.item.id] !== undefined) {
          data.markers[idx[o.item.id]] = o.item;
        } else {
          idx[o.item.id] = data.markers.length;
          data.markers.push(o.item);
        }
      } else if (o.k === 'pubdel' && o.id) {
        pubIds[o.id] = false;
        if (idx[o.id] !== undefined) {
          data.markers.splice(idx[o.id], 1);
          idx = {};
          data.markers.forEach(function (m, i) { if (m && m.id) idx[m.id] = i; });
        }
      } else if (o.k === 'priv' && o.id) {
        privBlobs[o.id] = o.blob;
        if (privOrder.indexOf(o.id) === -1) privOrder.push(o.id);
      } else if (o.k === 'privdel' && o.id) {
        delete privBlobs[o.id];
        privOrder = privOrder.filter(function (x) { return x !== o.id; });
      } else if (o.k === 'meta' && o.meta) {
        if (Array.isArray(o.meta.categories)) data.categories = o.meta.categories;
        if (o.meta.config && typeof o.meta.config === 'object') data.config = o.meta.config;
      }
    });
  }


  /** 当前内存中的私密点位（未解锁时为空） */
  function privateMarkers() {
    if (!data || !Array.isArray(data.markers)) return [];
    return data.markers.filter(function (m) { return m.isPrivate === true; });
  }

  /** 该点位是否为"当前应隐藏的私密点位"（私密 且 未解锁） */
  function isPrivateHidden(m) {
    return !!(m && m.isPrivate === true && !privateUnlocked);
  }

  /**
   * 落盘 / 导出专用序列化：**剥离私密明文**，也绝不带上任何密文块。
   * 任何写 localStorage、生成降级快照或导出文件的路径都必须走这里。
   */
  function serializeForStorage(d) {
    return {
      config: d.config,
      categories: d.categories,
      markers: (d.markers || []).filter(function (m) { return m.isPrivate !== true; })
    };
  }

  /** 判断一个 marker 在当前筛选状态下是否可见 */
  function isVisibleByFilter(markerData) {
    if (isPrivateHidden(markerData)) return false;
    var fk = filterKeyOf(markerData.category, markerData.visited);
    if (filterState[fk] === false) return false;
    if (!timeOk(markerData)) return false;
    return true;
  }

  /** 显示通知条 */
  function showNotice(text, duration) {
    var notices = document.getElementById('notices');
    var div = document.createElement('div');
    div.className = 'notice';
    div.innerHTML = '<span>' + text + '</span><button class="close">✕</button>';
    var closeBtn = div.querySelector('.close');
    closeBtn.addEventListener('click', function () { div.remove(); });
    notices.appendChild(div);
    if (duration) {
      setTimeout(function () { if (div.parentNode) div.remove(); }, duration);
    }
    return div;
  }

  /* =========================================================
   * 云端提交
   * ========================================================= */
  /** 按字节数 + op 数双重切批（网关限 100 KB，后端限 500 op） */
  function chunkOps(ops, maxBytes) {
    var out = [], cur = [], bytes = 0;
    ops.forEach(function (o) {
      var n = JSON.stringify(o).length + 1;
      if (cur.length && (bytes + n > maxBytes || cur.length >= MAX_SUBMIT_OPS)) {
        out.push(cur); cur = []; bytes = 0;
      }
      cur.push(o); bytes += n;
    });
    if (cur.length) out.push(cur);
    return out;
  }

  /** 同步「☁️ 提交」按钮：本机模式没有云端可提交，整颗隐藏；云模式未解锁也不给入口 */
  function updateSubmitBtn() {
    var btn = document.getElementById('btnSubmit');
    if (!btn) return;
    if (isLocalLike()) { btn.style.display = 'none'; return; }
    if (!privateUnlocked) { btn.style.display = 'none'; return; }
    btn.style.display = '';
    var n = pendingCount();
    var txt = btn.querySelector('.btn-text');
    var badge = btn.querySelector('.badge');
    if (txt) txt.textContent = n ? ('提交 ' + n) : '提交';
    if (badge) { badge.style.display = n ? 'inline' : 'none'; badge.textContent = n; }
    btn.classList.toggle('has-pending', n > 0);
    btn.title = n ? ('把本机 ' + n + ' 处改动提交到云端') : '没有待提交的改动';
  }

  /** 提交草稿到云端（分批串行，带 rev 乐观锁） */
  function doSubmit() {
    if (isLocalLike()) {
      persistLocal();
      showNotice('💾 已保存到本机（共 ' + data.markers.length + ' 个点位）', 3000);
      return;
    }
    var A = auth();
    if (!privateUnlocked) { showNotice('请先解锁（工具栏「🔒 私密」）再提交', 4000); return; }
    if (!A) { showNotice('⚠️ 鉴权组件未加载', 4000); return; }
    if (!cloud.ok) { showNotice('⚠️ 云端不可达，暂时无法提交。数据仍在本地草稿里，稍后再试。', 6000); return; }
    if (!draft.ops.length) { showNotice('没有需要提交的改动', 3000); return; }

    var batches = chunkOps(draft.ops.slice(), SUBMIT_BATCH_BYTES);
    var total = draft.ops.length;
    var rev = draft.rev;
    var btn = document.getElementById('btnSubmit');
    if (btn) btn.disabled = true;
    var tip = showNotice('☁️ 正在提交…（0/' + batches.length + ' 批）', 0);
    var tipSpan = tip ? tip.querySelector('span') : null;

    function step(i) {
      if (i >= batches.length) {
        cloud.rev = rev;
        draft = { rev: rev, ops: [] };
        try { localStorage.removeItem(LS_DRAFT_KEY); } catch (e) { /* ignore */ }
        updateSubmitBtn();
        if (btn) btn.disabled = false;
        if (tip && tip.parentNode) tip.remove();
        showNotice('✅ 已提交 ' + total + ' 处改动到云端', 4000);
        return;
      }
      A.request('/map/ops', { method: 'POST', body: { rev: rev, ops: batches[i], kdf: KDF } })
        .then(function (j) {
          if (!j || !j.ok) {
            var err = new Error((j && j.msg) || '云端拒绝写入');
            err.code = j && j.code;
            err.serverRev = j && j.serverRev;
            throw err;
          }
          rev = j.rev;
          if (tipSpan) tipSpan.textContent = '☁️ 正在提交…（' + (i + 1) + '/' + batches.length + ' 批）';
          step(i + 1);
        })
        .catch(function (e) {
          if (btn) btn.disabled = false;
          if (tip && tip.parentNode) tip.remove();
          if (e && e.code === 'REV_MISMATCH') {
            draft.rev = Number(e.serverRev) || 0;
            saveDraft();
            showNotice('⚠️ 云端数据已变化（云端 rev ' + e.serverRev + '）。你的改动仍留在这台机器的草稿里，' +
              '点「🔄 重置」拉取最新数据后再改一次即可。', 0);
            return;
          }
          showNotice('⚠️ 提交失败：' + (e && e.message ? e.message : e) + '（改动仍在本机草稿里）', 0);
        });
    }
    step(0);
  }

  /** 校验导入的数据结构 */
  function validateData(d) {
    if (!d || typeof d !== 'object') return false;
    if (!d.config || !d.categories || !d.markers) return false;
    if (!Array.isArray(d.categories) || !Array.isArray(d.markers)) return false;
    if (!Array.isArray(d.config.defaultCenter) || d.config.defaultCenter.length !== 2) return false;
    return true;
  }

  /** 数据迁移：旧版 marker 用 title 字段，统一转为 name（title 视为较新的编辑值，优先） */
  function migrateData(d) {
    if (!d || !Array.isArray(d.markers)) return d;
    d.markers.forEach(function (m) {
      if (m.title !== undefined) {
        m.name = m.title;
        delete m.title;
      }
      if (m.time !== undefined) m.time = normalizeTime(m.time);
    });
    return d;
  }

  /** 时间格式化：input datetime-local -> "YYYY-MM-DD HH:mm" */
  function toLocalString(v) {
    if (!v) return '';
    var s = (typeof v === 'string') ? v.trim() : v;
    // date-only 补齐时分，避免被当 UTC 解析导致跨时区偏移一天
    if (typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)) s = s + 'T00:00';
    var d = new Date(s);
    if (isNaN(d.getTime())) return (typeof v === 'string') ? v : ''; // 已是字符串则原样
    var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' +
           pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  /** "YYYY-MM-DD HH:mm" 或 "YYYY-MM-DD" -> datetime-local 值（date-only 自动补 00:00） */
  function fromLocalString(s) {
    if (!s) return '';
    s = s.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) s = s + 'T00:00';
    return s.replace(' ', 'T');
  }

  /** 归一化 time：date-only "2018-01-01" 统一补全为 "2018-01-01 00:00" */
  function normalizeTime(s) {
    if (!s || typeof s !== 'string') return s;
    s = s.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s + ' 00:00';
    return s;
  }

  /* =========================================================
   * 数据加载
   * ========================================================= */

  /**
   * 内置默认数据 = seed.js 的 window.__FP_SEED__（首次打开看到的示例足迹）。
   * 换初始数据只改 seed.js，不用动这里。
   */
  var FALLBACK_CATEGORIES = [
    { key: 'journey', name: '路程', icon: 'red-dot', inRoute: true },
    { key: 'food', name: '🍜 好吃的', icon: 'orange-fork', inRoute: false },
    { key: 'drink', name: '🍵 好喝的', icon: 'brown-cup', inRoute: false },
    { key: 'fun', name: '🎮 好玩的', icon: 'green-star', inRoute: false },
    { key: 'sight', name: '🏞️ 风景', icon: 'blue-mountain', inRoute: false },
    { key: 'wishlist', name: '💡 兴趣点', icon: 'yellow-bulb', inRoute: false }
  ];

  var DEFAULT_DATA = (function () {
    var s = FP ? FP.seed() : null;
    if (s) return s;
    return {
      config: { defaultCenter: [35.0, 105.0], defaultZoom: 5, title: '我的足迹地图' },
      categories: FALLBACK_CATEGORIES.slice(),
      markers: []
    };
  })();

  /** 初始数据的深拷贝（避免后续修改污染 seed 对象本身） */
  function fallbackData() {
    return JSON.parse(JSON.stringify(DEFAULT_DATA));
  }

  /* =========================================================
   * 本机持久化（local / static 模式共用）
   * ========================================================= */

  /**
   * 未解锁时内存里**没有**私密点（loadLocalDB 会把它们滤掉，避免明文白躺在内存里）。
   * 所以写库时不能直接拿 data.markers 覆盖 —— 那会把库里的私密点抹掉。
   * 这里按 id 把库里原有的私密点补回来。
   */
  function persistLocal() {
    if (!FP) return;
    var prev = FP.localDB.get() || { markers: [] };
    var merged;
    if (privateUnlocked) {
      merged = data.markers.slice();
    } else {
      var seen = {};
      data.markers.forEach(function (m) { if (m && m.id) seen[m.id] = true; });
      merged = data.markers.concat((prev.markers || []).filter(function (m) {
        return m && m.isPrivate === true && !seen[m.id];
      }));
    }
    try {
      FP.localDB.set({ config: data.config, categories: data.categories, markers: merged });
    } catch (e) {
      showNotice('⚠️ 保存到本机失败：' + (e && e.message ? e.message : e), 10000);
    }
  }

  /**
   * 读本机库；没有就回到初始示例数据。
   * 未解锁时滤掉私密点 —— 不只是不渲染，而是根本不进内存。
   */
  function loadLocalDB() {
    var db = FP ? FP.localDB.get() : null;
    var base = db ? normalize(db) : normalize(fallbackData());
    if (!privateUnlocked) {
      base.markers = (base.markers || []).filter(function (m) { return m.isPrivate !== true; });
    }
    return Promise.resolve(base);
  }

  /** 归一化：缺 config/categories 时用内置默认兜底（首次上云时云端文档还是空的） */
  function normalize(d) {
    d = d || {};
    return {
      config: (d.config && typeof d.config === 'object' && Array.isArray(d.config.defaultCenter))
        ? d.config : JSON.parse(JSON.stringify(DEFAULT_DATA.config)),
      categories: (Array.isArray(d.categories) && d.categories.length)
        ? d.categories : JSON.parse(JSON.stringify(DEFAULT_DATA.categories)),
      markers: Array.isArray(d.markers) ? d.markers : []
    };
  }

  /**
   * 把加载好的数据接到全局状态上（补默认、跑旧字段迁移、定底图）。
   * 注意：这里**不动** draft / privBlobs —— 它们由 loadCloudOrStatic / loadDraft 各自维护。
   */
  function applyLoadedData(d) {
    data = d;
    if (!data.config) data.config = { defaultCenter: [35, 105], defaultZoom: 5, title: '我的足迹地图' };
    if (!data.config.title) data.config.title = '我的足迹地图';
    migrateData(data);   // 旧数据迁移：marker 的 title 字段统一转为 name
    // 默认底图：优先 config.defaultLayer，其次文件顶部 DEFAULT_LAYER_TYPE。
    // 只在还没建图时生效，避免"解锁后重拉数据"把用户当场选的底图顶掉。
    if (!map) {
      var dl = data.config.defaultLayer || DEFAULT_LAYER_TYPE;
      // 默认底图需要 key 但用户没填 → 退回不需要 key 的那张，避免首屏一片灰
      if (TILE_LAYERS[dl] && TILE_LAYERS[dl].needsKey && !tiandituTk()) dl = DEFAULT_LAYER_TYPE;
      if (TILE_LAYERS[dl]) currentLayerType = dl;
    }
    return data;
  }

  /** 决定数据来源：本机模式直接用本机库；云端模式走「云 → data.json → 初始数据」三级回退 */
  function loadCloudOrStatic() {
    // 本地 / 静态托管模式：不发任何网络请求，数据全在本机（file:// 下也能正常工作）
    if (isLocalLike()) return loadLocalDB();

    var A = auth();
    if (!A) return loadFromStatic('鉴权组件未加载');

    return A.request('/map/list').then(function (j) {
      if (!j || !j.ok) throw new Error((j && j.msg) || '云端返回异常');
      cloud.ok = true;
      cloud.exists = !!j.exists;
      cloud.rev = Number(j.rev) || 0;
      cloud.privCount = Number(j.privCount) || 0;   // 条数即使未登录后端也会给（可公开）
      privBlobs = {};
      privOrder = [];
      // 未登录时后端不下发 priv（这是刻意的：密文可被离线爆破，不给访客最干净）
      (j.priv || []).forEach(function (p) {
        if (p && p.id && p.blob) { privBlobs[p.id] = p.blob; privOrder.push(p.id); }
      });
      if (!j.exists) {
        // 云端还没有地图数据集（首次上云之前）：拿仓库里的 data.json 当初始内容。
        // cloud.ok 保持 true、rev 保持 0 —— 解锁后点「☁️ 提交」就能创建云端文档。
        showNotice('ℹ️ 云端暂无地图数据集，已载入仓库快照作为初始内容。解锁后点「☁️ 提交」即可完成首次上云。', 10000);
        return loadFromStatic('首次上云', true);
      }
      var items = (j.items || []).filter(function (x) { return x && x.deleted !== true; });
      pubIds = {};
      items.forEach(function (x) { if (x && x.id) pubIds[x.id] = true; });
      return normalize({ config: j.config, categories: j.categories, markers: items });
    }).catch(function (e) {
      cloud.ok = false;
      return loadFromStatic(e && e.message ? e.message : e);
    });
  }

  /**
   * 静态快照回退：读 data.json（**只含公开点位**）。
   * 加时间戳防 HTTP 缓存 —— 服务器未下发 Cache-Control 头。
   * @param quiet true 时不弹"云端不可达"的告警（用于"云端尚无数据集"这种正常情形）
   */
  function loadFromStatic(reason, quiet) {
    return fetch('./data.json?t=' + Date.now())
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (d) {
        if (!validateData(d)) throw new Error('data.json 结构不认识');
        if (!quiet) {
          showNotice('⚠️ 云端不可达（' + (reason || '未知原因') + '），已回退到静态快照。' +
            '此时改动无法提交，等云端恢复后再操作。', 0);
        }
        pubIds = {};
        (d.markers || []).forEach(function (x) { if (x && x.id) pubIds[x.id] = true; });
        return normalize({ config: d.config, categories: d.categories, markers: d.markers });
      })
      .catch(function (err) {
        console.warn('静态快照加载失败:', err);
        showNotice('⚠️ 云端与静态快照都不可用，已使用初始示例数据。', 0);
        return normalize(fallbackData());
      });
  }

  /* =========================================================
   * 地图初始化
   * ========================================================= */

  function initMap() {
    var center = data.config.defaultCenter || [35, 105];
    var zoom = data.config.defaultZoom || 5;

    map = L.map('map', {
      center: center,
      zoom: zoom,
      minZoom: 3,
      maxZoom: 18,
      zoomControl: true
    });

    addTileLayer(currentLayerType);
    document.getElementById('layerSelect').value = currentLayerType;

    // 状态栏更新
    map.on('move', updateStatusbar);
    map.on('zoomend', function () {
      updateStatusbar();
      refreshAllIcons();   // 图标三级降级
    });

    // 双击添加（PC）
    map.on('dblclick', function (e) {
      openAddForm(e.latlng);
    });

    // 移动端长按添加
    setupLongPress();

    // 点击地图空白处隐藏搜索下拉与分组面板
    map.on('click', function () {
      hideSearchResults();
      hideFilterPanel();
    });

    // 初始化完成后立即刷新状态栏（避免显示 "—"）
    updateStatusbar();
    initTimeFilterUI();   // 绑定时间区间筛选面板事件
  }

  /** 添加底图图层 */
  /** 当前底图是否为 WGS-84 坐标系（国际底图 Esri/OSM/Carto） */
  function isWgs84Layer(type) {
    return !!(TILE_LAYERS[type] && TILE_LAYERS[type].crs === 'wgs84');
  }

  /** 数据(GCJ-02) -> 当前底图显示坐标：WGS-84 底图需反算 */
  function getDisplayLatLng(m) {
    if (!m) return [0, 0];
    if (isWgs84Layer(currentLayerType)) {
      var w = GCJ.gcj2wgs(m.lat, m.lng);
      return [w[0], w[1]];
    }
    return [m.lat, m.lng];
  }

  /** 切换底图后，按新坐标系重定位所有点位 */
  function repositionAllMarkers() {
    Object.keys(markers).forEach(function (id) {
      var m = getMarkerData(id);
      if (!m || !markers[id]) return;
      markers[id].setLatLng(getDisplayLatLng(m));
    });
  }

  /** 天地图 tk：从设置里读，不内置任何 key（源码公开后内置 key 会被白嫖配额） */
  function tiandituTk() {
    try { return (FP && FP.settings && FP.settings().tiandituTk) || ''; } catch (e) { return ''; }
  }

  /** 把 url 里的 {tk} 占位换成真实 key */
  function resolveTileUrl(u) {
    if (!u || u.indexOf('{tk}') < 0) return u;
    return u.replace('{tk}', encodeURIComponent(tiandituTk()));
  }

  function addTileLayer(type) {
    if (layerControl) {
      map.removeLayer(layerControl);
      layerControl = null;
    }
    if (layerOverlay) {
      map.removeLayer(layerOverlay);
      layerOverlay = null;
    }
    var t = TILE_LAYERS[type];
    layerControl = L.tileLayer(resolveTileUrl(t.url), t.options);
    layerControl.addTo(map);
    if (t.overlay) {
      layerOverlay = L.tileLayer(resolveTileUrl(t.overlay.url), t.overlay.options);
      layerOverlay.addTo(map);
    }
  }

  /** 切换底图（下拉选择） */
  function setLayer(type) {
    if (!TILE_LAYERS[type]) return;
    // 需要 key 而没填：不切，直接告诉用户去哪填
    if (TILE_LAYERS[type].needsKey && !tiandituTk()) {
      showNotice('🗝️ 天地图需要你自己的 key：点品牌名 → 底图 → 填 key（免费申请，1 分钟）。', 7000);
      document.getElementById('layerSelect').value = currentLayerType;
      return;
    }
    currentLayerType = type;
    addTileLayer(type);
    document.getElementById('layerSelect').value = type;
    repositionAllMarkers();                          // 按新底图坐标系重定位点位
    if (routeMode) { clearRoute(); drawRoute(); }    // 路线同步重绘
  }

  /** 状态栏 */
  function updateStatusbar() {
    var c = map.getCenter();
    document.getElementById('statCoord').textContent =
      '坐标: ' + c.lat.toFixed(4) + ', ' + c.lng.toFixed(4);
    document.getElementById('statZoom').textContent = '缩放: ' + map.getZoom();
  }

  /** 移动端长按 600ms 添加标记 */
  function setupLongPress() {
    var mapEl = map.getContainer();
    var timer = null;
    var startLatLng = null;

    function clearTimer() {
      if (timer) { clearTimeout(timer); timer = null; }
    }

    mapEl.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1) { clearTimer(); return; }
      startLatLng = map.mouseEventToLatLng(e.touches[0]);
      clearTimer();
      timer = setTimeout(function () {
        timer = null;
        if (navigator.vibrate) { try { navigator.vibrate(50); } catch (err) {} }
        openAddForm(startLatLng);
      }, 600);
    }, { passive: true });

    mapEl.addEventListener('touchmove', function () {
      clearTimer();
    }, { passive: true });

    mapEl.addEventListener('touchend', function () {
      clearTimer();
    }, { passive: true });
  }

  /* =========================================================
   * 分类 / 分组筛选
   * ========================================================= */

  /** 初始化筛选状态（含 localStorage 恢复） */
  function initFilterState() {
    filterState = {};
    timeFilter = { enabled: false, start: '', end: '', preset: 'all', endTouched: false };
    data.categories.forEach(function (cat) {
      if (cat.key === 'journey') {
        filterState['journey_visited'] = true;
        filterState['journey_unvisited'] = true;
      } else if (cat.key === 'food') {
        filterState['food_visited'] = true;
        filterState['food_want'] = true;
      } else {
        filterState[cat.key] = true;
      }
    });

    // 恢复上次筛选状态（分类 bool + 时间区间）
    try {
      var saved = localStorage.getItem(LS_FILTER_KEY);
      if (saved) {
        var parsed = JSON.parse(saved);
        Object.keys(parsed).forEach(function (k) {
          if (k in filterState) filterState[k] = !!parsed[k];
        });
        if (parsed.timeEnabled !== undefined) timeFilter.enabled = !!parsed.timeEnabled;
        if (parsed.timeStart !== undefined) timeFilter.start = parsed.timeStart;
        if (parsed.timeEnd !== undefined) timeFilter.end = parsed.timeEnd;
        if (parsed.timePreset !== undefined) timeFilter.preset = parsed.timePreset;
        if (parsed.timeEndTouched !== undefined) timeFilter.endTouched = !!parsed.timeEndTouched;
      }
    } catch (e) { /* ignore */ }
  }

  /** 保存筛选状态（含时间区间） */
  function saveFilterState() {
    try {
      var out = Object.assign({}, filterState, {
        timeEnabled: timeFilter.enabled,
        timeStart: timeFilter.start,
        timeEnd: timeFilter.end,
        timePreset: timeFilter.preset,
        timeEndTouched: timeFilter.endTouched
      });
      localStorage.setItem(LS_FILTER_KEY, JSON.stringify(out));
    } catch (e) { /* ignore */ }
    updateFilterBadge();
  }

  /** 构建分组筛选面板 */
  function renderFilterPanel() {
    var list = document.getElementById('filterList');
    list.innerHTML = '';

    function addItem(label, fk, count, locked) {
      var div = document.createElement('div');
      div.className = 'filter-item' + (locked ? ' disabled' : '');
      div.innerHTML =
        '<input type="checkbox" ' + (filterState[fk] ? 'checked' : '') + (locked ? ' disabled' : '') + '>' +
        '<span>' + label + '</span>' +
        '<span class="count">' + count + '</span>';
      if (!locked) {
        var cb = div.querySelector('input');
        cb.addEventListener('change', function () {
          filterState[fk] = cb.checked;
          refreshAll();
          saveFilterState();
        });
      }
      list.appendChild(div);
    }

    data.categories.forEach(function (cat) {
      var isJourney = cat.key === 'journey';
      var isFood = cat.key === 'food';
      var locked = routeMode && isJourney;

      if (isJourney) {
        var vCount = data.markers.filter(function (m) { return !isPrivateHidden(m) && m.category === 'journey' && m.visited === true; }).length;
        var uCount = data.markers.filter(function (m) { return !isPrivateHidden(m) && m.category === 'journey' && m.visited !== true; }).length;
        addItem('路程（已去过）', 'journey_visited', vCount, locked);
        addItem('路程（未去）', 'journey_unvisited', uCount, locked);
      } else if (isFood) {
        var fvCount = data.markers.filter(function (m) { return !isPrivateHidden(m) && m.category === 'food' && m.visited === true; }).length;
        var fuCount = data.markers.filter(function (m) { return !isPrivateHidden(m) && m.category === 'food' && m.visited !== true; }).length;
        addItem('美食（吃过了）', 'food_visited', fvCount, false);
        addItem('美食（想吃的）', 'food_want', fuCount, false);
      } else {
        var count = data.markers.filter(function (m) { return !isPrivateHidden(m) && m.category === cat.key; }).length;
        addItem(cat.name, cat.key, count, false);
      }
    });
    syncTimePanel();
  }

  /** 应用筛选：控制各 layerGroup */
  function applyFilter() {
    data.categories.forEach(function (cat) {
      var fks;
      if (cat.key === 'journey') fks = ['journey_visited', 'journey_unvisited'];
      else if (cat.key === 'food') fks = ['food_visited', 'food_want'];
      else fks = [cat.key];
      fks.forEach(function (fk) {
        var g = layerGroups[fk];
        if (!g) return;
        if (filterState[fk] && !map.hasLayer(g)) map.addLayer(g);
        if (!filterState[fk] && map.hasLayer(g)) map.removeLayer(g);
      });
    });
    updateFilterBadge();
  }

  /** 筛选徽标（有隐藏的分类时显示） */
  function updateFilterBadge() {
    var hidden = Object.keys(filterState || {}).filter(function (k) { return filterState[k] === false; });
    var badge = document.getElementById('filterBadge');
    if (hidden.length) {
      badge.style.display = 'inline';
      badge.textContent = hidden.length;
    } else {
      badge.style.display = 'none';
    }
  }

  /* ============ 时间区间筛选 ============ */
  // 统一为 "YYYY-MM-DD HH:mm" 再比较（datetime-local 用 T 分隔）
  function normCmp(t) { return (t || '').replace('T', ' '); }

  /** 点位时间是否落在当前筛选区间内（timeFilter 关闭则恒真） */
  function inRange(time) {
    if (!timeFilter.enabled) return true;
    var t = normCmp(time);
    if (!t) return false;                       // 空 time 点不在任何区间内
    var s = normCmp(timeFilter.start);
    var e = normCmp(timeFilter.end);
    if (!s && !e) return true;
    var lo = (s && e) ? (s <= e ? s : e) : (s || e);
    var hi = (s && e) ? (s <= e ? e : s) : (s || e);
    return t >= lo && t <= hi;
  }

  /** 时间筛选对该点位是否生效
   *  公共收藏点（poi:true，来自 _tools/poi-build.js 批量导入的景点/美食）
   *  记录的是"这个地方存在"，不是"我什么时候去的"，没有到访时间可比，
   *  所以不参与时间区间裁剪——否则一开筛选它们会全部消失。 */
  function timeOk(m) {
    if (!timeFilter.enabled) return true;
    if (m && m.poi === true) return true;
    return inRange(m.time);
  }

  /** 分类是否勾选可见 */
  function catIsVisible(m) {
    if (m.category === 'journey') return !!filterState[m.visited ? 'journey_visited' : 'journey_unvisited'];
    if (m.category === 'food') return !!filterState[m.visited ? 'food_visited' : 'food_want'];
    return filterState[m.category] !== false;
  }

  /** 单点可见性：时间区间 与 私密锁 同时满足才显示 */
  function isPointVisible(m) {
    return timeOk(m) && !isPrivateHidden(m);
  }

  /** 时间/私密裁剪：在所属 layerGroup 内部增删 marker，与分类显隐（layerGroup↔地图）正交、互不覆盖 */
  function applyTimeFilter() {
    data.markers.forEach(function (m) {
      var mk = markers[m.id];
      if (!mk) return;
      var fk = filterKeyOf(m.category, m.visited);
      var g = layerGroups[fk];
      if (!g) return;
      if (!isPointVisible(m)) {
        if (g.hasLayer(mk)) g.removeLayer(mk);
      } else if (!g.hasLayer(mk)) {
        g.addLayer(mk);
      }
    });
  }

  /** 分类 + 时间串联刷新（最终以时间裁剪为准） */
  function refreshAll() {
    applyFilter();
    applyTimeFilter();
  }

  /** datetime-local 值 + n 年（同月同日同时分） */
  function addYears(dtStr, n) {
    if (!dtStr) return '';
    var d = new Date(dtStr.replace(' ', 'T'));
    if (isNaN(d.getTime())) return '';
    d.setFullYear(d.getFullYear() + n);
    var pad = function (x) { return (x < 10 ? '0' : '') + x; };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
           'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  /** 同步时间面板控件状态 */
  function syncTimePanel() {
    var en = document.getElementById('timeEnable');
    var range = document.getElementById('timeRange');
    var sEl = document.getElementById('timeStart');
    var eEl = document.getElementById('timeEnd');
    if (!en) return;
    en.checked = timeFilter.enabled;
    range.style.display = timeFilter.enabled ? 'block' : 'none';
    sEl.value = timeFilter.start ? timeFilter.start.replace(' ', 'T') : '';
    eEl.value = timeFilter.end ? timeFilter.end.replace(' ', 'T') : '';
    var btns = document.querySelectorAll('.time-preset');
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle('active', btns[i].getAttribute('data-preset') === timeFilter.preset);
    }
  }

  /** 触发 UI 同步 + 重绘（点位 + 路线） */
  function applyTimeUI() {
    saveFilterState();
    syncTimePanel();
    refreshAll();
    if (routeMode) { clearRoute(); drawRoute(); }
  }

  /** 一次性绑定时间面板事件 */
  function initTimeFilterUI() {
    var en = document.getElementById('timeEnable');
    var sEl = document.getElementById('timeStart');
    var eEl = document.getElementById('timeEnd');
    if (!en) return;

    en.addEventListener('change', function () {
      timeFilter.enabled = en.checked;
      if (timeFilter.enabled && timeFilter.preset === 'all') timeFilter.preset = 'custom';
      if (!timeFilter.enabled) timeFilter.preset = 'all';
      applyTimeUI();
    });

    sEl.addEventListener('change', function () {
      timeFilter.start = sEl.value ? sEl.value.replace('T', ' ') : '';
      if (!timeFilter.endTouched) timeFilter.end = addYears(timeFilter.start, 1);  // 默认 +1 年
      timeFilter.preset = 'custom';
      applyTimeUI();
    });

    eEl.addEventListener('change', function () {
      timeFilter.end = eEl.value ? eEl.value.replace('T', ' ') : '';
      timeFilter.endTouched = true;
      timeFilter.preset = 'custom';
      applyTimeUI();
    });

    var btns = document.querySelectorAll('.time-preset');
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener('click', function () {
        var p = this.getAttribute('data-preset');
        timeFilter.preset = p;
        var now = new Date();
        var pad = function (x) { return (x < 10 ? '0' : '') + x; };
        var nowStr = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()) +
                     'T' + pad(now.getHours()) + ':' + pad(now.getMinutes());
        if (p === 'all') {
          timeFilter.enabled = false; timeFilter.start = ''; timeFilter.end = ''; timeFilter.endTouched = false;
        } else if (p === 'year') {
          timeFilter.enabled = true; timeFilter.start = addYears(nowStr, -1); timeFilter.end = nowStr; timeFilter.endTouched = true;
        } else if (p === '3year') {
          timeFilter.enabled = true; timeFilter.start = addYears(nowStr, -3); timeFilter.end = nowStr; timeFilter.endTouched = true;
        } else if (p === 'custom') {
          timeFilter.enabled = true;   // 保留现有 start/end，等待用户填写
        }
        applyTimeUI();
      });
    }
  }

  function toggleFilterPanel() {
    var panel = document.getElementById('filterPanel');
    var isShow = panel.classList.toggle('show');
    if (isShow) renderFilterPanel();
  }

  function hideFilterPanel() {
    document.getElementById('filterPanel').classList.remove('show');
  }

  /* =========================================================
   * 图标策略
   * ========================================================= */

  /** 获取分类默认 SVG（food 未标记"吃过了"时用灰色叉勺，与橙色的已吃过区分） */
  function catIconSvg(catKey, visited) {
    if (catKey === 'food' && visited !== true) return ICONS['gray-fork'];
    var cat = data.categories.filter(function (c) { return c.key === catKey; })[0];
    if (cat && ICONS[cat.icon]) return ICONS[cat.icon];
    return ICONS['red-dot'];
  }

  /**
   * 根据缩放级别与标记数据生成 L.divIcon
   * 规则：zoom >= 12 且 iconUrl 非空 -> 自定义图标；否则分类默认 SVG
   */
  function buildIcon(m) {
    var zoom = map.getZoom();
    var useCustom = zoom >= 12 && m.iconUrl && m.iconUrl.trim() !== '';
    var html;
    if (useCustom) {
      html = '<img src="' + m.iconUrl + '" style="width:26px;height:26px;object-fit:contain;" ' +
             'onerror="this.onerror=null;this.outerHTML=document.getElementById(\'iconFallback_' + m.id + '\').innerHTML;">' +
             '<div id="iconFallback_' + m.id + '" style="display:none">' + catIconSvg(m.category, m.visited) + '</div>';
    } else {
      html = catIconSvg(m.category, m.visited);
    }
    return L.divIcon({
      html: html,
      className: 'custom-marker',
      iconSize: [26, 26],
      iconAnchor: [13, 13],
      popupAnchor: [0, -14],
      interactive: true   // 必须：否则 Leaflet 不响应点击，无法打开弹窗
    });
  }

  /** zoomend 时刷新所有标记图标 */
  function refreshAllIcons() {
    Object.keys(markers).forEach(function (id) {
      var mk = markers[id];
      if (!mk) return;
      var m = getMarkerData(id);
      if (!m) return;
      mk.setIcon(buildIcon(m));
    });
  }

  /* =========================================================
   * 标记渲染
   * ========================================================= */

  /** 按 id 获取 marker 数据 */
  function getMarkerData(id) {
    for (var i = 0; i < data.markers.length; i++) {
      if (data.markers[i].id === id) return data.markers[i];
    }
    return null;
  }

  /** 渲染单个标记 */
  function renderMarker(m) {
    var mk = L.marker(getDisplayLatLng(m), {
      icon: buildIcon(m),
      draggable: true,
      autoClose: false
    });

    // 拖拽松手 → 只落本地草稿（点「☁️ 提交」才上云）
    mk.on('dragend', function (e) {
      var pos = e.target.getLatLng();   // 当前底图显示坐标
      var md = getMarkerData(m.id);
      if (md) {
        var store = [pos.lat, pos.lng];
        if (isWgs84Layer(currentLayerType)) {
          store = GCJ.wgs2gcj(pos.lat, pos.lng); // 显示坐标是 WGS-84，转回 GCJ-02 存储
        }
        md.lat = +store[0].toFixed(6);
        md.lng = +store[1].toFixed(6);
        commitMarker(md);
      }
    });

    // 点击打开弹窗
    mk.on('click', function () {
      openPopup(m.id);
    });

    markers[m.id] = mk;

    // 私密点位未解锁时：只注册不上图，避免初次渲染/新增/编辑后短暂露出
    if (isPrivateHidden(m)) return;

    // 归属到对应 layerGroup
    var fk = filterKeyOf(m.category, m.visited);
    if (layerGroups[fk]) {
      mk.addTo(layerGroups[fk]);
    } else {
      mk.addTo(map);
    }
  }

  /** 移除单个标记 */
  function removeMarker(id) {
    var mk = markers[id];
    if (mk) {
      var p = mk.getPopup();
      if (p && p.isOpen()) map.removeLayer(p);
      mk.remove();
      delete markers[id];
    }
  }

  /** 重新渲染单个标记（编辑/分类变化后） */
  function rerenderMarker(id) {
    var m = getMarkerData(id);
    if (!m) return;
    // 移除旧标记（连带弹窗）
    removeMarker(id);
    // 如果路线模式开着，先清理路线再重建
    if (routeMode) clearRoute();
    renderMarker(m);
    if (routeMode) drawRoute();
  }

  /** 渲染所有标记 */
  function renderAllMarkers() {
    data.markers.forEach(renderMarker);
  }

  /* =========================================================
   * 弹窗系统
   * ========================================================= */

  /** 打开 marker 弹窗（查看模式） */
  function openPopup(id) {
    var mk = markers[id];
    if (!mk) return;
    var m = getMarkerData(id);
    if (!m) return;

    // 修复：移除 Leaflet bindPopup 时注册的内部 click toggle 处理器。
    // 它的逻辑是「弹窗已打开时再次点击 → closePopup」，会和我们自己的 openPopup 冲突，
    // 导致「关闭后再次点击」时弹窗刚打开就被它关掉。
    mk.off('click', mk._openPopup);
    mk.off('keypress', mk._onKeyPress);
    // 若该点位已有打开/残留的弹窗，先彻底从 map 移除，避免重复弹窗与 _layers 累积
    var p0 = mk.getPopup();
    if (p0 && map.hasLayer(p0)) map.removeLayer(p0);

    var cat = getCategory(m.category);
    var catName = cat ? cat.name : m.category;
    var catIcon = cat && ICONS[cat.icon] ? cat.icon : 'red-dot';

    var html = '';
    html += '<div class="popup-title">📍 ' + escapeHtml(m.name) +
            '<button class="popup-close" onclick="window.__mapClosePopup(\'' + id + '\')">✕</button></div>';
    html += '<div class="popup-body">';
    html += '<div class="popup-meta">';
    html += '<span class="cat-badge">' + ICONS[catIcon] + ' ' + escapeHtml(catName) + '</span>';
    if (m.isPrivate === true) {
      html += '<span class="private-badge">🔒 私密</span>';
    }
    if (m.category === 'journey') {
      html += m.visited === true
        ? '<span class="visited-badge">✅ 已去过</span>'
        : '<span class="visited-badge" style="color:#95a5a6">⬜ 未去</span>';
      if (m.visited === true && m.time) {
        html += '<span class="time-badge">🕐 ' + escapeHtml(m.time) + '</span>';
      }
    } else if (m.category === 'food') {
      html += m.visited === true
        ? '<span class="visited-badge">✅ 吃过了</span>'
        : '<span class="visited-badge" style="color:#95a5a6">💭 想吃的</span>';
    }
    html += '</div>';
    html += '<div class="popup-content">' + marked.parse(m.content || '') + '</div>';
    html += '</div>';
    html += '<div class="popup-actions">' +
            '<button class="btn btn-primary" onclick="window.__mapEdit(\'' + id + '\')">✏️ 编辑</button>' +
            '<button class="btn btn-danger" onclick="window.__mapDelete(\'' + id + '\')">🗑️ 删除</button>' +
            '</div>';

    mk.bindPopup(html, {
      className: 'marker-popup',
      autoClose: false,
      closeOnClick: false,
      closeButton: false,
      maxWidth: 380
    });
    mk.openPopup();
  }

  /** 获取分类对象 */
  function getCategory(key) {
    for (var i = 0; i < data.categories.length; i++) {
      if (data.categories[i].key === key) return data.categories[i];
    }
    return null;
  }

  /** HTML 转义 */
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /** 弹窗内编辑模式 */
  function openEditInPopup(id) {
    var mk = markers[id];
    if (!mk) return;
    var m = getMarkerData(id);
    if (!m) return;
    editingId = id;

    // 移除已打开的查看弹窗（与 openPopup 相同的清理逻辑），避免编辑表单打开后旧弹窗残留成孤儿
    mk.off('click', mk._openPopup);
    mk.off('keypress', mk._onKeyPress);
    var p0 = mk.getPopup();
    if (p0 && map.hasLayer(p0)) map.removeLayer(p0);

    var catOptions = '';
    data.categories.forEach(function (cat) {
      var sel = cat.key === m.category ? 'selected' : '';
      catOptions += '<option value="' + cat.key + '" ' + sel + '>' + escapeHtml(cat.name) + '</option>';
    });

    var html = '';
    html += '<div class="popup-title">✏️ 编辑地点' +
            '<button class="popup-close" onclick="window.__mapClosePopup(\'' + id + '\')">✕</button></div>';
    html += '<div class="popup-body popup-edit">';
    html += '<div class="form-row"><label>名称</label><input type="text" id="peName" value="' + escapeHtml(m.name) + '"></div>';
    html += '<div class="form-row"><label>分类</label><select id="peCat" style="width:100%;padding:7px 10px;border:1px solid #e0e0e0;border-radius:6px;font-size:13px;">' + catOptions + '</select></div>';

    // journey / food 才显示"已去过（吃过）"；时间仅 journey 有
    var isJourney = m.category === 'journey';
    var showVisited = isJourney || m.category === 'food';
    var isFood = m.category === 'food';
    var visitedChecked = m.visited === true ? 'checked' : '';
    var timeDisabled = !(isJourney && m.visited === true) ? 'disabled' : '';
    var timeVal = fromLocalString(m.time || '');

    html += '<div class="form-row" id="peVisitedRow" style="' + (showVisited ? '' : 'display:none') + '">' +
            '<label class="check-row"><input type="checkbox" id="peVisited" ' + visitedChecked + '>' +
            (isFood ? ' 已吃过了' : ' 已去过') + '</label></div>';
    html += '<div class="form-row" id="peTimeRow" style="' + (isJourney && m.visited === true ? '' : 'display:none') + '">' +
            '<label>时间</label><input type="datetime-local" id="peTime" ' + timeDisabled + ' value="' + timeVal + '"></div>';
    // v19：未解锁时禁止改动私密标记（没有密钥就无法把改动加密保存）
    var pDisabled = privateUnlocked ? '' : ' disabled';
    var pLabel = privateUnlocked
      ? ' 🔒 私密点位（默认不显示，需解锁后查看）'
      : ' 🔒 私密点位（需先点右上角解锁）';
    html += '<div class="form-row">' +
            '<label class="check-row"' + (privateUnlocked ? '' : ' title="需先解锁私密点位（右上角 🔒）"') + '>' +
            '<input type="checkbox" id="pePrivate" ' + (m.isPrivate === true ? 'checked' : '') + pDisabled + '>' + pLabel + '</label></div>';

    html += '<div class="form-row"><label>图标 URL</label><input type="url" id="peIconUrl" value="' + escapeHtml(m.iconUrl || '') + '" placeholder="留空使用分类默认"></div>';
    html += '<div class="form-row"><label>内容（Markdown）</label><textarea id="peContent" placeholder="支持 Markdown">' + escapeHtml(m.content || '') + '</textarea></div>';
    html += '<div id="pePreview" style="display:none;border:1px dashed #e0e0e0;border-radius:6px;padding:10px;background:#fafbfc;font-size:13px;line-height:1.7;max-height:200px;overflow-y:auto;"></div>';
    html += '<div class="f-actions">' +
            '<button class="btn btn-default" onclick="window.__mapTogglePreview()">👁️ 预览</button>' +
            '<button class="btn btn-default" onclick="window.__mapCancelEdit()">取消</button>' +
            '<button class="btn btn-primary" onclick="window.__mapSaveEdit()">💾 保存</button>' +
            '</div>';
    html += '</div>';

    mk.bindPopup(html, {
      className: 'marker-popup',
      autoClose: false,
      closeOnClick: false,
      closeButton: false,
      maxWidth: 380
    });
    mk.openPopup();

    // 分类切换联动
    var peCat = document.getElementById('peCat');
    var peVisited = document.getElementById('peVisited');
    var peVisitedRow = document.getElementById('peVisitedRow');
    var peTimeRow = document.getElementById('peTimeRow');
    var peTime = document.getElementById('peTime');

    function syncFields() {
      var isJ = peCat.value === 'journey';
      var showV = isJ || peCat.value === 'food';
      peVisitedRow.style.display = showV ? '' : 'none';
      if (!isJ) {
        peTimeRow.style.display = 'none';
        peTime.disabled = true;
        peTime.value = '';
        return;
      }
      var v = peVisited.checked;
      peTimeRow.style.display = v ? '' : 'none';
      peTime.disabled = !v;
      if (!v) peTime.value = '';
    }

    if (peCat) peCat.addEventListener('change', syncFields);
    if (peVisited) peVisited.addEventListener('change', syncFields);
  }

  /* =========================================================
   * 添加表单（模态框）
   * ========================================================= */

  var addFormLatLng = null;   // 添加时的坐标
  var previewMode = false;    // 预览/编辑切换

  function openAddForm(latlng) {
    addFormLatLng = latlng;
    editingId = null;
    previewMode = false;

    document.getElementById('formTitle').textContent = '📍 添加地点';
    document.getElementById('fName').value = '';
    document.getElementById('fIconUrl').value = '';
    document.getElementById('fContent').value = '';
    document.getElementById('fVisited').checked = false;
    // v19：未解锁时禁止勾选「私密点位」（没有密钥就无法把新点位加密保存）
    var fPriv = document.getElementById('fPrivate');
    fPriv.checked = false;
    fPriv.disabled = !privateUnlocked;
    var fPrivRow = fPriv.closest('.form-row');
    if (fPrivRow) {
      fPrivRow.title = privateUnlocked ? '' : '需先解锁私密点位（右上角 🔒）';
    }
    document.getElementById('fTime').value = '';
    document.getElementById('fTime').disabled = true;
    document.getElementById('fTimeRow').style.display = 'none';
    document.getElementById('fVisitedRow').style.display = 'none';
    document.getElementById('mdPreview').style.display = 'none';
    document.getElementById('fPreview').textContent = '👁️ 预览';
    previewMode = false;

    // 分类单选按钮
    var catsWrap = document.getElementById('fCats');
    catsWrap.innerHTML = '';
    data.categories.forEach(function (cat) {
      var label = document.createElement('label');
      label.className = 'cat-radio';
      label.innerHTML = '<input type="radio" name="fCat" value="' + cat.key + '">' +
                        ICONS[cat.icon] + ' ' + escapeHtml(cat.name);
      label.addEventListener('click', function () {
        catsWrap.querySelectorAll('.cat-radio').forEach(function (el) { el.classList.remove('selected'); });
        label.classList.add('selected');
        // 分类联动：journey / food 显示"已去过（吃过了）"，其他隐藏
        var isJ = cat.key === 'journey';
        var showV = isJ || cat.key === 'food';
        document.getElementById('fVisitedRow').style.display = showV ? '' : 'none';
        document.getElementById('fVisitedText').textContent = cat.key === 'food' ? ' 已吃过了' : ' 已去过';
        if (!isJ) {
          document.getElementById('fVisited').checked = false;
          document.getElementById('fTimeRow').style.display = 'none';
          document.getElementById('fTime').disabled = true;
          document.getElementById('fTime').value = '';
        } else {
          var v = document.getElementById('fVisited').checked;
          document.getElementById('fTimeRow').style.display = v ? '' : 'none';
          document.getElementById('fTime').disabled = !v;
        }
      });
      catsWrap.appendChild(label);
    });

    document.getElementById('formModal').classList.add('show');
  }

  /** 获取当前选中分类 */
  function getSelectedCat() {
    var checked = document.querySelector('#fCats input[name="fCat"]:checked');
    return checked ? checked.value : null;
  }

  /** 关闭表单 */
  function closeForm() {
    document.getElementById('formModal').classList.remove('show');
    editingId = null;
  }

  /* =========================================================
   * 路线模式
   * ========================================================= */

  function toggleRoute() {
    routeMode = !routeMode;
    document.getElementById('btnRoute').classList.toggle('active', routeMode);
    if (routeMode) {
      drawRoute();
    } else {
      clearRoute();
    }
    // 路线模式影响分组面板 journey 锁定状态
    var panel = document.getElementById('filterPanel');
    if (panel.classList.contains('show')) renderFilterPanel();
    refreshAll();
  }

  /** 获取路线数据：journey + visited + time 非空，按时间升序（叠加时间区间裁剪）
   *  私密点位未解锁时剔除：否则连线会指向某个空处，等于间接暴露位置 */
  function getRouteMarkers() {
    var list = data.markers.filter(function (m) {
      return !isPrivateHidden(m) && m.category === 'journey' && m.visited === true && m.time && m.time !== '';
    });
    if (timeFilter.enabled) {
      list = list.filter(function (m) { return inRange(m.time); });
    }
    return list.sort(function (a, b) { return a.time.localeCompare(b.time); });
  }

  /** 按时间升序重排 data.markers（空 time 沉底），使导出 JSON 也是时间序 */
  function sortMarkersByTime() {
    if (!data || !Array.isArray(data.markers)) return;
    data.markers.sort(function (a, b) {
      var ta = a.time || '';
      var tb = b.time || '';
      if (ta === tb) return 0;
      if (ta === '') return 1;
      if (tb === '') return -1;
      return ta.localeCompare(tb);
    });
  }

  /** 绘制路线 */
  function drawRoute() {
    clearRoute();
    var routeMarkers = getRouteMarkers();

    // 时间冲突检测
    for (var i = 1; i < routeMarkers.length; i++) {
      if (routeMarkers[i].time === routeMarkers[i - 1].time) {
        showNotice('⚠️ 时间冲突：「' + routeMarkers[i - 1].name + '」和「' + routeMarkers[i].name + '」的时间均为 ' + routeMarkers[i].time + '，请修改其中一个。', 8000);
      }
    }

    if (routeMarkers.length < 2) {
      if (routeMarkers.length === 1) {
        // 只有一个点也显示序号，不画线
      }
    }

    // 画折线（红色虚线，marker pane 之下）
    var latlngs = routeMarkers.map(function (m) { return getDisplayLatLng(m); });
    if (latlngs.length >= 2) {
      routeLine = L.polyline(latlngs, {
        color: '#e74c3c',
        dashArray: '8,8',
        weight: 3,
        opacity: 0.8
      });
      routeLine.addTo(map);
    }

    // 序号圆圈
    routeMarkers.forEach(function (m, idx) {
      var numMarker = L.marker(getDisplayLatLng(m), {
        icon: L.divIcon({
          html: '<div class="route-num" onclick="window.__mapOpenById(\'' + m.id + '\')">' + (idx + 1) + '</div>',
          className: 'route-num-wrap',
          iconSize: [24, 24],
          iconAnchor: [12, 12]
        }),
        interactive: true,
        zIndexOffset: 1000
      });
      numMarker.addTo(map);
      routeNumMarkers.push(numMarker);
    });
  }

  /** 清除路线 */
  function clearRoute() {
    if (routeLine) {
      map.removeLayer(routeLine);
      routeLine = null;
    }
    routeNumMarkers.forEach(function (m) { map.removeLayer(m); });
    routeNumMarkers = [];
  }

  /* =========================================================
   * 搜索
   * ========================================================= */

  var searchResults = document.getElementById('searchResults');

  function setupSearch() {
    // 把下拉框移到 body 下，避免被 toolbar 的 overflow 裁剪或地图遮挡
    if (searchResults.parentNode !== document.body) {
      document.body.appendChild(searchResults);
    }

    var input = document.getElementById('searchInput');
    input.addEventListener('input', function () {
      var q = this.value.trim().toLowerCase();
      if (!q) { hideSearchResults(); return; }
      var matches = data.markers
        .filter(function (m) { return !isPrivateHidden(m) && m.name.toLowerCase().indexOf(q) !== -1; })
        .slice(0, 10);
      renderSearchResults(matches, q);
    });
    input.addEventListener('focus', function () {
      if (this.value.trim()) this.dispatchEvent(new Event('input'));
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        var first = searchResults.querySelector('.item');
        if (first) { first.click(); }
      }
    });
    document.addEventListener('click', function (e) {
      if (!e.target.closest('#searchWrap') && !e.target.closest('#searchResults')) hideSearchResults();
    });
    window.addEventListener('resize', updateSearchResultsPosition);
    window.addEventListener('scroll', updateSearchResultsPosition, true);
  }

  function updateSearchResultsPosition() {
    if (searchResults.style.display === 'none') return;
    var input = document.getElementById('searchInput');
    if (!input) return;
    var r = input.getBoundingClientRect();
    searchResults.style.top = (r.bottom + 4) + 'px';
    searchResults.style.left = r.left + 'px';
    searchResults.style.width = r.width + 'px';
  }

  function renderSearchResults(matches, q) {
    if (!matches.length) {
      var msg = data.markers.length === 0
        ? '暂无地点数据，先双击地图添加地点吧'
        : '无匹配结果';
      searchResults.innerHTML = '<div class="empty">' + msg + '</div>';
      searchResults.style.display = 'block';
      updateSearchResultsPosition();
      return;
    }
    var html = '';
    matches.forEach(function (m) {
      var cat = getCategory(m.category);
      var catName = cat ? cat.name : m.category;
      html += '<div class="item" data-id="' + m.id + '">' +
              '<span class="cat-tag">' + escapeHtml(catName) + '</span>' +
              '<span>' + highlight(m.name, q) + '</span></div>';
    });
    searchResults.innerHTML = html;
    searchResults.style.display = 'block';
    updateSearchResultsPosition();

    Array.prototype.forEach.call(searchResults.querySelectorAll('.item'), function (el) {
      el.addEventListener('click', function () {
        var id = this.getAttribute('data-id');
        hideSearchResults();
        flyToMarker(id);
      });
    });
  }

  /** 关键词高亮 */
  function highlight(text, q) {
    var esc = escapeHtml(text);
    if (!q) return esc;
    var idx = esc.toLowerCase().indexOf(q);
    if (idx === -1) return esc;
    return esc.substring(0, idx) + '<mark>' + esc.substring(idx, idx + q.length) + '</mark>' + esc.substring(idx + q.length);
  }

  function hideSearchResults() {
    searchResults.style.display = 'none';
  }

  /** 飞往标记并打开弹窗 */
  function flyToMarker(id) {
    var m = getMarkerData(id);
    if (!m) return;
    if (isPrivateHidden(m)) {
      showNotice('🔒 该点位为私密点位，请先解锁查看', 3000);
      openLockModal();
      return;
    }
    var mk = markers[id];
    // 确保该分类被筛选显示
    var fk = filterKeyOf(m.category, m.visited);
    if (filterState[fk] === false) {
      filterState[fk] = true;
      saveFilterState();
    }
    refreshAll();
    if (mk && !timeOk(m)) {
      var fk2 = filterKeyOf(m.category, m.visited);
      var g2 = layerGroups[fk2];
      if (g2 && !g2.hasLayer(mk)) g2.addLayer(mk);
    }
    map.flyTo([m.lat, m.lng], Math.max(map.getZoom(), 13), { duration: 1 });
    setTimeout(function () { openPopup(id); }, 900);
  }

  /* =========================================================
   * 导出 / 导入
   * ========================================================= */

  /** 触发浏览器下载（file:// 下同样可用） */
  function downloadJson(payload, filename) {
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // 立刻 revoke 在部分浏览器会让下载中断，延后释放
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  function timeStamp() {
    var d = new Date();
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes());
  }

  /**
   * 导出 JSON（云模式）：
   * - 未解锁：只含公开点位（本来也拿不到密文）
   * - 已解锁：附带 priv 密文块 = **完整备份**，可在别处重新导入
   * 任何情况下都不含私密明文。
   * ⚠️ 已解锁导出的文件带密文，**不要放进任何静态目录** —— 那是公开可下载的。
   */
  function exportData() {
    if (isLocalLike()) return exportLocal();
    var prep;
    if (privateUnlocked && privateKey) {
      prep = Promise.all(privateMarkers().map(function (m) {
        return sealItem(m).then(function (blob) {
          privBlobs[m.id] = blob;
          return { id: m.id, blob: blob };
        });
      })).then(function (arr) {
        var payload = serializeForStorage(data);
        payload.priv = arr;
        return payload;
      });
    } else {
      prep = Promise.resolve(serializeForStorage(data));
    }

    prep.then(function (payload) {
      downloadJson(payload, 'footprint-map-' + timeStamp() + '.json');
      var nPriv = (payload.priv || []).length;
      showNotice(privateUnlocked
        ? '💾 已导出：' + payload.markers.length + ' 个公开点 + ' + nPriv + ' 个私密点（密文，完整备份）'
        : '💾 已导出：' + payload.markers.length + ' 个公开点（未解锁，不含私密数据）', 5000);
    }).catch(function (err) {
      console.warn('导出失败:', err);
      alert('导出失败：' + (err && err.message ? err.message : err));
    });
  }

  /**
   * 导出 JSON（本机模式）。
   * 已解锁 → 私密点以**明文**导出（本机模式本来就没有密文可言），这是完整备份，
   *           分享给别人前务必确认里面没有不想公开的东西。
   * 未解锁 → 只导出公开点，可直接拿去分享。
   */
  function exportLocal() {
    var full = privateUnlocked;
    var payload = full
      ? { config: data.config, categories: data.categories, markers: data.markers.slice() }
      : serializeForStorage(data);
    payload._fp = { app: 'footprint-map', mode: 'local', full: full, exportedAt: new Date().toISOString() };

    downloadJson(payload, 'footprint-map-' + timeStamp() + (full ? '-full' : '') + '.json');
    var nPriv = full ? privateMarkers().length : 0;
    showNotice('💾 已导出：' + payload.markers.length + ' 个点位'
      + (full ? '（含 ' + nPriv + ' 个私密点，**明文**，分享前请确认）' : '（不含私密点）'), full ? 8000 : 5000);
  }

  /**
   * 导入 JSON。与媒体库同规则：**追加合并**、按 id 判重、撞车给新 id。
   * 导入的条目一律先当**公开**条目（要私密请导入后在弹窗里勾选）。
   * 结果只落本地草稿，点「☁️ 提交」才上云 —— 导入本身绝不碰云端。
   */
  function importData(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var parsed;
      try { parsed = JSON.parse(reader.result); }
      catch (e) { alert('文件格式错误：不是合法的 JSON'); return; }

      var src = Array.isArray(parsed.markers) ? parsed.markers
              : (Array.isArray(parsed.items) ? parsed.items : null);
      if (!src) { alert('文件格式错误：找不到 markers 数组'); return; }
      if (parsed.private) {
        showNotice('⚠️ 该文件含旧格式（整块）密文，已忽略 —— 私密数据请用 _tools/map-migrate.js 上云。', 8000);
      }

      var existing = {};
      data.markers.forEach(function (m) { if (m && m.id) existing[m.id] = true; });

      var incoming = [], renamed = 0, skipped = 0;
      src.forEach(function (m) {
        if (!m || typeof m !== 'object') { skipped++; return; }
        if (m.name === undefined && m.title !== undefined) m.name = m.title;
        if (!m.name || typeof m.lat !== 'number' || typeof m.lng !== 'number') { skipped++; return; }
        var it = Object.assign({}, m);
        // 云模式：导入条目一律先当公开条目（要私密请导入后在弹窗里勾选）
        // 本机模式：本机库存的就是明文，私密标记可以原样保留，换机迁移才不丢
        if (!isLocalLike() || it.isPrivate !== true) delete it.isPrivate;
        delete it.deleted;
        if (!it.id) it.id = genId();
        if (existing[it.id]) { it.id = genId(); renamed++; }   // id 撞车且可能是不同地点 → 重新编号
        existing[it.id] = true;
        incoming.push(it);
      });

      if (!incoming.length) {
        alert('没有可导入的点位（共 ' + src.length + ' 条，全部跳过）');
        return;
      }

      incoming.forEach(function (it) {
        data.markers.push(it);
        pubIds[it.id] = true;
        recordOp({ k: 'pub', item: it });
      });

      // 文件若附带密文块（本页导出的完整备份），按 id 合并，不覆盖已有的
      var nBlob = 0;
      if (Array.isArray(parsed.priv)) {
        parsed.priv.forEach(function (p) {
          if (p && p.id && p.blob && privBlobs[p.id] === undefined) {
            privBlobs[p.id] = p.blob;
            privOrder.push(p.id);
            recordOp({ k: 'priv', id: p.id, blob: p.blob });
            nBlob++;
          }
        });
      }

      sortMarkersByTime();
      resetAllAndRender();
      showNotice('导入完成：新增 ' + incoming.length + ' 条'
        + (renamed ? '（' + renamed + ' 条 id 撞车已重新编号）' : '')
        + (skipped ? '，跳过 ' + skipped + ' 条' : '')
        + (nBlob ? '，附带 ' + nBlob + ' 个私密密文块' : '')
        + (isLocalLike() ? '。已保存到本机。' : '。仍在本地草稿里，点「☁️ 提交」才同步到云端。'), 8000);
    };
    reader.onerror = function () { alert('读取文件失败'); };
    reader.readAsText(file);
  }

  /** 全量重建地图（导入/初始化后调用） */
  function resetAllAndRender() {
    // 清空旧标记
    Object.keys(markers).forEach(removeMarker);
    markers = {};
    layerGroups = {};
    if (routeLine) { map.removeLayer(routeLine); routeLine = null; }
    routeNumMarkers.forEach(function (m) { map.removeLayer(m); });
    routeNumMarkers = [];
    routeMode = false;
    document.getElementById('btnRoute').classList.remove('active');

    // 重建筛选状态与图层组
    initFilterState();

    data.categories.forEach(function (cat) {
      if (cat.key === 'journey') {
        layerGroups['journey_visited'] = L.layerGroup().addTo(map);
        layerGroups['journey_unvisited'] = L.layerGroup().addTo(map);
      } else if (cat.key === 'food') {
        layerGroups['food_visited'] = L.layerGroup().addTo(map);
        layerGroups['food_want'] = L.layerGroup().addTo(map);
      } else {
        layerGroups[cat.key] = L.layerGroup().addTo(map);
      }
    });

    renderAllMarkers();
    refreshAll();
    document.getElementById('brandTitle').textContent = '📍 ' + (data.config.title || '足迹地图');
    document.title = data.config.title || '我的足迹地图';
  }

  /* =========================================================
   * 批量弹窗
   * ========================================================= */

  function expandAllPopups() {
    // 仅展开当前浏览器窗口范围内（视口内）的标记
    var bounds = map.getBounds();
    var visibleIds = data.markers
      .filter(function (m) {
        if (!isVisibleByFilter(m)) return false;          // 筛选隐藏的不展开
        var ll = L.latLng(m.lat, m.lng);
        if (!bounds.contains(ll)) return false;           // 视口外的不展开
        var mk = markers[m.id];
        return !(mk && mk.isPopupOpen());                 // 已打开的跳过
      })
      .map(function (m) { return m.id; });

    if (!visibleIds.length) {
      showNotice('当前视野内没有可展开的点位，请先移动地图到目标区域。', 3000);
      return;
    }
    if (visibleIds.length > 50) {
      showNotice('标记过多，仅展开前 50 个。');
      visibleIds = visibleIds.slice(0, 50);
    }
    visibleIds.forEach(function (id) { openPopup(id); });
    showNotice('已展开 ' + visibleIds.length + ' 个点位弹窗（仅视野内）。', 2500);
  }

  function closeAllPopups() {
    // 关闭全部弹窗（包括视口外），作为"清理屏幕"动作
    // 注意：用 map.removeLayer 彻底移除，不能用 mk.closePopup()（它只置 _map=null，
    // 弹窗仍残留在 map._layers，会导致下次点击无法正常重开）
    var n = 0;
    Object.keys(markers).forEach(function (id) {
      var mk = markers[id];
      if (!mk) return;
      var p = mk.getPopup();
      if (p && p.isOpen()) { map.removeLayer(p); n++; }
    });
    if (n) showNotice('已关闭 ' + n + ' 个弹窗。', 2000);
  }

  /* =========================================================
   * 全局函数（供内联 onclick 调用）
   * ========================================================= */
  window.__mapClosePopup = function (id) {
    var mk = markers[id];
    if (!mk) return;
    var p = mk.getPopup();
    if (p && p.isOpen()) map.removeLayer(p);
  };

  window.__mapOpenById = function (id) {
    openPopup(id);
  };

  window.__mapEdit = function (id) {
    openEditInPopup(id);
  };

  window.__mapDelete = function (id) {
    var m = getMarkerData(id);
    if (!m) return;
    if (m.isPrivate === true && !privateUnlocked) {
      showNotice('🔒 未解锁，无法删除私密点位', 3500);
      return;
    }
    if (!confirm('确认删除「' + m.name + '」？\n删除先记在本机草稿里，点「☁️ 提交」才同步到云端。')) return;

    if (m.isPrivate === true) {
      // 私密点：只撤掉密文，**绝不写公开明文墓碑**（否则等于把私密内容公开上云）
      delete privBlobs[id];
      privOrder = privOrder.filter(function (x) { return x !== id; });
      recordOp({ k: 'privdel', id: id });
    } else {
      // 公开点：逻辑删除 —— 云端保留一条 deleted 标记的记录（不物理删，留个后悔余地），
      // 页面侧直接不再显示。loadCloudOrStatic 会过滤掉 deleted 条目。
      recordOp({ k: 'pub', item: Object.assign({}, m, {
        deleted: true, deletedAt: new Date().toISOString()
      }) });
      pubIds[id] = false;
    }

    data.markers = data.markers.filter(function (x) { return x.id !== id; });
    removeMarker(id);
    if (routeMode) { clearRoute(); drawRoute(); }
    // 刷新分组计数
    var panel = document.getElementById('filterPanel');
    if (panel.classList.contains('show')) renderFilterPanel();
  };

  window.__mapSaveEdit = function () {
    if (!editingId) return;
    var m = getMarkerData(editingId);
    if (!m) return;

    var name = document.getElementById('peName').value.trim();
    var cat = document.getElementById('peCat').value;
    var iconUrl = document.getElementById('peIconUrl').value.trim();
    var content = document.getElementById('peContent').value;

    if (!name) { alert('地点名称不能为空'); return; }
    if (!cat) { alert('请选择分类'); return; }

    // 时间校验
    var timeVal = '';
    var visited = false;
    if (cat === 'journey' || cat === 'food') {
      visited = document.getElementById('peVisited').checked;
      if (cat === 'journey' && visited) {
        timeVal = toLocalString(document.getElementById('peTime').value);
      }
    }

    // 私密标记（未解锁时不允许改动，否则明文私密点无法加密保存）
    var pePrivateEl = document.getElementById('pePrivate');
    var isPrivate = !!(pePrivateEl && pePrivateEl.checked);
    if (isPrivate !== (m.isPrivate === true) && !privateUnlocked) {
      alert('请先解锁私密点位（右上角 🔒 按钮）后再修改「私密」标记。');
      return;
    }

    m.name = name;
    m.category = cat;
    m.iconUrl = iconUrl;
    m.content = content;
    if (isPrivate) { m.isPrivate = true; } else { delete m.isPrivate; }

    // 按联动规则清理字段
    if (cat === 'journey') {
      m.visited = visited;
      if (visited && timeVal) {
        m.time = timeVal;
      } else {
        m.time = '';
      }
    } else if (cat === 'food') {
      m.visited = visited;
      delete m.time;
    } else {
      delete m.visited;
      delete m.time;
    }

    // 按时间升序重排，使导出 JSON 也是时间序（空 time 沉底）
    sortMarkersByTime();
    commitMarker(m);
    rerenderMarker(m.id);
    if (isPrivateHidden(m)) {
      // 刚被设为私密且未解锁：点已从地图移除，不再打开弹窗
      showNotice('🔒 已设为私密点位，解锁后可查看', 3000);
    } else {
      // 重新打开弹窗：新数据立即可见，且弹窗与新 marker 重新绑定（否则关闭按钮失效）
      openPopup(m.id);
    }
    editingId = null;
    // 刷新分组面板计数
    var panel = document.getElementById('filterPanel');
    if (panel.classList.contains('show')) renderFilterPanel();
  };

  window.__mapCancelEdit = function () {
    if (!editingId) return;
    var id = editingId;
    editingId = null;
    openPopup(id); // 回到查看模式
  };

  window.__mapTogglePreview = function () {
    var preview = document.getElementById('pePreview');
    var btn = document.querySelector('.popup-edit .f-actions .btn');
    if (preview.style.display === 'none') {
      preview.style.display = 'block';
      preview.innerHTML = marked.parse(document.getElementById('peContent').value || '');
      btn.textContent = '✏️ 继续编辑';
    } else {
      preview.style.display = 'none';
      btn.textContent = '👁️ 预览';
    }
  };

  /* =========================================================
   * 表单事件（添加模态框）
   * ========================================================= */

  function setupFormEvents() {
    document.getElementById('formClose').addEventListener('click', closeForm);
    document.getElementById('fCancel').addEventListener('click', closeForm);
    document.getElementById('formModal').addEventListener('click', function (e) {
      if (e.target === this) closeForm();
    });

    // 已去过 -> 时间启用
    document.getElementById('fVisited').addEventListener('change', function () {
      var v = this.checked;
      document.getElementById('fTimeRow').style.display = v ? '' : 'none';
      document.getElementById('fTime').disabled = !v;
      if (!v) document.getElementById('fTime').value = '';
    });

    // 预览
    document.getElementById('fPreview').addEventListener('click', function () {
      var pv = document.getElementById('mdPreview');
      if (previewMode) {
        pv.style.display = 'none';
        this.textContent = '👁️ 预览';
        previewMode = false;
      } else {
        pv.style.display = 'block';
        pv.innerHTML = marked.parse(document.getElementById('fContent').value || '');
        this.textContent = '✏️ 继续编辑';
        previewMode = true;
      }
    });

    // 保存
    document.getElementById('fSave').addEventListener('click', function () {
      var name = document.getElementById('fName').value.trim();
      var cat = getSelectedCat();
      var iconUrl = document.getElementById('fIconUrl').value.trim();
      var content = document.getElementById('fContent').value;

      if (!name) { alert('地点名称不能为空'); return; }
      if (!cat) { alert('请选择分类'); return; }

      var addCoord = [addFormLatLng.lat, addFormLatLng.lng];
      if (isWgs84Layer(currentLayerType)) {
        addCoord = GCJ.wgs2gcj(addFormLatLng.lat, addFormLatLng.lng); // 显示为 WGS-84，转回 GCJ-02 存储
      }
      var marker = {
        id: genId(),
        lat: +addCoord[0].toFixed(6),
        lng: +addCoord[1].toFixed(6),
        name: name,
        iconUrl: iconUrl,
        category: cat,
        content: content
      };

      if (document.getElementById('fPrivate').checked) {
        if (!privateUnlocked) {
          alert('请先解锁私密点位（右上角 🔒 按钮）后再新增私密点位。');
          return;
        }
        marker.isPrivate = true;
      }

      if (cat === 'journey' || cat === 'food') {
        var visited = document.getElementById('fVisited').checked;
        marker.visited = visited;
        if (cat === 'journey') {
          marker.time = visited ? toLocalString(document.getElementById('fTime').value) : '';
        }
      }

      data.markers.push(marker);
      commitMarker(marker);

      // 渲染到对应分组
      var fk = filterKeyOf(cat, marker.visited);
      if (!layerGroups[fk]) {
        layerGroups[fk] = L.layerGroup().addTo(map);
      }
      renderMarker(marker);
      if (routeMode && cat === 'journey' && marker.visited === true) {
        clearRoute(); drawRoute();
      }

      closeForm();
      if (isPrivateHidden(marker)) {
        showNotice('🔒 已添加私密点位，解锁后可查看', 3000);
      } else {
        openPopup(marker.id);
      }

      var panel = document.getElementById('filterPanel');
      if (panel.classList.contains('show')) renderFilterPanel();
    });
  }

  /* =========================================================
   * 工具栏事件
   * ========================================================= */

  function setupToolbar() {
    document.getElementById('layerSelect').addEventListener('change', function () {
      setLayer(this.value);
    });
    document.getElementById('btnRoute').addEventListener('click', toggleRoute);
    document.getElementById('btnExpandAll').addEventListener('click', expandAllPopups);
    document.getElementById('btnCloseAll').addEventListener('click', closeAllPopups);
    document.getElementById('btnFilter').addEventListener('click', function (e) {
      e.stopPropagation();
      toggleFilterPanel();
    });
    document.getElementById('btnExport').addEventListener('click', exportData);
    document.getElementById('btnImport').addEventListener('click', function () {
      document.getElementById('importFile').click();
    });
    document.getElementById('importFile').addEventListener('change', function () {
      if (this.files && this.files[0]) importData(this.files[0]);
      this.value = '';
    });
    // 重置：本机模式 = 清空本机库回到初始示例；云模式 = 丢弃本机草稿并从云端重拉
    document.getElementById('btnReset').addEventListener('click', function () {
      if (isLocalLike()) {
        if (!confirm('确定重置吗？\n将清空本机保存的全部点位，回到初始示例数据（口令也会一并清除）。\n'
          + '建议先「💾 导出」备份。')) return;
        if (FP) {
          FP.localDB.clear();
          FP.pwd.clear();
          FP.session.clearUnlocked();
        }
        privateUnlocked = false;
        privateKey = null;
        privBlobs = {};
        privOrder = [];
        var tl = showNotice('🔄 正在清空本机数据并载入初始示例…', 0);
        loadLocalDB().then(function (d) {
          applyLoadedData(d);
          if (tl && tl.parentNode) tl.remove();
          resetAllAndRender();
          updateLockBtn();
          updateSubmitBtn();
          showNotice('✅ 已回到初始示例数据', 4000);
        }).catch(function (e) {
          if (tl && tl.parentNode) tl.remove();
          showNotice('⚠️ 重置失败：' + (e && e.message ? e.message : e), 6000);
        });
        return;
      }
      var n = pendingCount();
      if (!confirm('确定要重置吗？\n将丢弃本机未提交的 ' + n + ' 处改动，并从云端重新拉取数据。\n'
        + '（已经「☁️ 提交」到云端的内容不受影响；建议先「💾 导出」备份。）')) return;
      clearDraft();
      privBlobs = {};
      privOrder = [];
      cloud.ok = false; cloud.rev = 0; cloud.exists = false;
      var tip = showNotice('🔄 已重置本机改动，正在从云端重新拉取…', 0);
      loadCloudOrStatic().then(function (d) {
        applyLoadedData(d);
        applyDraft();                        // 草稿已清空，这里只是让流程一致
        return decryptAllPrivate();          // 有 token 时云端会下发 priv，重新解密
      }).then(function (n2) {
        if (tip && tip.parentNode) tip.remove();
        resetAllAndRender();
        updateLockBtn();
        updateSubmitBtn();
        showNotice('✅ 已从云端重新载入' + (n2 ? '（含 ' + n2 + ' 个私密点位）' : ''), 4000);
      }).catch(function (e) {
        if (tip && tip.parentNode) tip.remove();
        showNotice('⚠️ 重新拉取失败：' + (e && e.message ? e.message : e), 6000);
      });
    });

    // 提交到云端（只在解锁后可见，见 updateSubmitBtn）
    var submitBtn = document.getElementById('btnSubmit');
    if (submitBtn) submitBtn.addEventListener('click', doSubmit);

    // 私密点位：锁按钮 / 解锁弹窗事件
    document.getElementById('btnLock').addEventListener('click', function (e) {
      e.stopPropagation();
      if (privateUnlocked) { lockAgain(); } else { openLockModal(); }
    });
    document.getElementById('lockBtn').addEventListener('click', attemptUnlock);
    document.getElementById('lockClose').addEventListener('click', closeLockModal);
    document.getElementById('lockPwd').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') attemptUnlock();
    });
    document.getElementById('lockScreen').addEventListener('click', function (e) {
      if (e.target === this) closeLockModal();   // 点遮罩空白处关闭
    });
  }

  /* =========================================================
   * 设置面板 / 模式徽章
   * ========================================================= */
  var MODE_LABEL = { local: '本机', static: '在线', cloud: '云同步' };
  var MODE_DESC = {
    local: '数据存在这台设备的浏览器里。双击 HTML 文件也能用，刷新、关页面都不丢。',
    static: '数据存在这台设备的浏览器里，页面来自网页服务器。别人打开看到的是他自己的数据。',
    cloud: '数据同步到你自己配置的接口。多设备共用一份，需要填 API 地址和解锁密码。'
  };

  function updateModeTag() {
    var tag = document.getElementById('modeTag');
    if (!tag || !FP) return;
    var m = FP.effectiveMode();
    tag.textContent = MODE_LABEL[m] || m;
    tag.className = 'mode-tag mode-' + m;
    tag.title = MODE_DESC[m] || '';
  }

  function fmtSize(n) {
    if (!n) return '0';
    return n > 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + ' MB' : (n / 1024).toFixed(1) + ' KB';
  }

  function openSettings() {
    if (!FP) return;
    var m = FP.effectiveMode();
    var radios = document.querySelectorAll('input[name="fpMode"]');
    for (var i = 0; i < radios.length; i++) radios[i].checked = (radios[i].value === m);

    var api = document.getElementById('apiBase');
    if (api) api.value = (FP.settings().apiBase || '');
    var apiRow = document.getElementById('apiRow');
    if (apiRow) apiRow.style.display = (m === 'cloud') ? '' : 'none';

    var mh = document.getElementById('modeHint');
    if (mh) {
      mh.textContent = MODE_DESC[m] + (isFileMode()
        ? ' 当前是 file:// 直开，云端同步与加密都不可用。' : '');
    }
    var sh = document.getElementById('storageHint');
    if (sh) {
      sh.textContent = '当前 ' + data.markers.length + ' 个点位'
        + (isLocalLike() ? ' · 本机占用 ' + fmtSize(FP.localDB.bytes()) : ' · 已提交到云端');
    }
    var ph = document.getElementById('pwdHint');
    if (ph) {
      ph.textContent = FP.pwd.has()
        ? '已设置口令。忘记口令不会丢点位，但私密点会看不到 —— 可以先解锁再导出取回。'
        : '还没设口令。点工具栏「🔒 私密」，第一次输入的口令就是设置。';
    }
    var tk = document.getElementById('tdtTk');
    if (tk) tk.value = tiandituTk();
    var tdtHint = document.getElementById('tdtHint');
    if (tdtHint) {
      tdtHint.innerHTML = tiandituTk()
        ? '已配置。天地图卫星底图可用。'
        : '本项目不内置任何 key —— 源码是公开的，内置等于把配额送人。'
          + '需要的话去 console.tianditu.gov.cn 免费申请一个粘进来。';
    }
    var s = document.getElementById('settingsScreen');
    if (s) s.classList.remove('hide');
  }

  function closeSettings() {
    var s = document.getElementById('settingsScreen');
    if (s) s.classList.add('hide');
  }

  /** 清空当前全部点位（本机模式直接落库；云模式生成删除 op） */
  function clearAllMarkers() {
    if (!data.markers.length) { showNotice('本来就是空的', 2500); return; }
    if (!confirm('清空全部 ' + data.markers.length + ' 个点位？\n此操作不可撤销，建议先导出备份。')) return;

    if (isLocalLike()) {
      data.markers = [];
      pubIds = {};
      privBlobs = {};
      privOrder = [];
      try { FP.localDB.set({ config: data.config, categories: data.categories, markers: [] }); }
      catch (e) { showNotice('⚠️ 保存失败：' + (e && e.message ? e.message : e), 8000); }
    } else {
      data.markers.forEach(function (mk) {
        if (mk.isPrivate === true) recordOp({ k: 'privdel', id: mk.id });
        else recordOp({ k: 'pubdel', id: mk.id });
      });
      data.markers = [];
      pubIds = {};
      privBlobs = {};
      privOrder = [];
    }
    closeSettings();
    resetAllAndRender();
    showNotice('⬜ 已清空。双击地图就能开始记录第一个地点。', 5000);
  }

  /** 恢复成 seed.js 的示例数据 */
  function restoreSeed() {
    if (!confirm('恢复示例数据？当前点位会被替换（建议先导出备份）。')) return;
    var fresh = normalize(JSON.parse(JSON.stringify(DEFAULT_DATA)));
    if (isLocalLike()) {
      try {
        FP.localDB.set({ config: fresh.config, categories: fresh.categories, markers: fresh.markers });
      } catch (e) { showNotice('⚠️ 保存失败：' + (e && e.message ? e.message : e), 8000); }
    }
    applyLoadedData(fresh);
    pubIds = {};
    data.markers.forEach(function (mk) { if (mk && mk.id) pubIds[mk.id] = true; });
    privBlobs = {};
    privOrder = [];
    privateUnlocked = false;
    privateKey = null;
    if (isLocalLike()) { if (FP) FP.session.clearUnlocked(); }
    closeSettings();
    resetAllAndRender();
    updateLockBtn();
    updateSubmitBtn();
    showNotice('✨ 已恢复示例数据（' + data.markers.length + ' 个点位）', 4000);
  }

  function setupSettings() {
    var open = document.getElementById('btnSettings');
    if (open) open.addEventListener('click', function (e) { e.stopPropagation(); openSettings(); });
    var brand = document.getElementById('brandTitle');
    if (brand) brand.addEventListener('click', function (e) { e.stopPropagation(); openSettings(); });
    var close = document.getElementById('settingsClose');
    if (close) close.addEventListener('click', closeSettings);
    var scr = document.getElementById('settingsScreen');
    if (scr) scr.addEventListener('click', function (e) { if (e.target === scr) closeSettings(); });

    // 模式切换
    var radios = document.querySelectorAll('input[name="fpMode"]');
    for (var i = 0; i < radios.length; i++) {
      radios[i].addEventListener('change', function () {
        if (!this.checked || !FP) return;
        FP.saveSettings({ mode: this.value });
        var apiRow = document.getElementById('apiRow');
        if (apiRow) apiRow.style.display = (this.value === 'cloud') ? '' : 'none';
        if (this.value === 'cloud') {
          var api = document.getElementById('apiBase');
          if (api && !api.value) api.focus();
          showNotice('填好 API 地址并保存后，页面会自动重载', 6000);
        } else {
          // 切到本机/静态：数据改从本机读，直接重载最干净
          if (confirm('切换后页面会重新载入，本机未导出的内容仍在本机库里，不会丢。现在切换？')) {
            location.reload();
          }
        }
      });
    }

    var apiSave = document.getElementById('apiSave');
    if (apiSave) apiSave.addEventListener('click', function () {
      var v = (document.getElementById('apiBase') || {}).value || '';
      v = v.trim().replace(/\/+$/, '');
      if (v && !/^https?:\/\//i.test(v)) { alert('API 地址要以 http:// 或 https:// 开头'); return; }
      FP.saveSettings({ apiBase: v, mode: v ? 'cloud' : 'local' });
      if (confirm('已保存。现在重新载入页面？')) location.reload();
    });

    // 天地图 key：存本机设置，存完立即重建底图（不用刷新）
    var tdtSave = document.getElementById('tdtSave');
    if (tdtSave) tdtSave.addEventListener('click', function () {
      var v = ((document.getElementById('tdtTk') || {}).value || '').trim();
      FP.saveSettings({ tiandituTk: v });
      var h = document.getElementById('tdtHint');
      if (h) {
        h.innerHTML = v
          ? '已保存。现在可以切到「天地图卫星」了。'
          : '已清空。天地图底图会变为不可用，需要时再填。';
      }
      if (currentLayerType === 'tianditu') {
        if (v) addTileLayer('tianditu');
        else setLayer(DEFAULT_LAYER_TYPE);
      }
      showNotice(v ? '🗝️ 天地图 key 已保存' : '天地图 key 已清空', 3000);
    });

    var e1 = document.getElementById('setExport');
    if (e1) e1.addEventListener('click', function () { closeSettings(); exportData(); });
    var i1 = document.getElementById('setImport');
    if (i1) i1.addEventListener('click', function () {
      closeSettings();
      document.getElementById('importFile').click();
    });
    var b1 = document.getElementById('setBlank');
    if (b1) b1.addEventListener('click', clearAllMarkers);
    var s1 = document.getElementById('setSeed');
    if (s1) s1.addEventListener('click', restoreSeed);

    var p1 = document.getElementById('setPwdReset');
    if (p1) p1.addEventListener('click', function () {
      if (!FP.pwd.has()) { showNotice('还没设置过口令：点工具栏「🔒 私密」输入第一次口令即可', 5000); return; }
      if (!confirm('重设口令？\n旧口令会立刻失效，之前标记为私密的点位不会丢，\n但重设后要重新标记（本机模式不带加密，只决定显不显示）。')) return;
      FP.pwd.clear();
      privateUnlocked = false;
      if (FP) FP.session.clearUnlocked();
      showNotice('🔑 旧口令已清除。点「🔒 私密」输入新口令即可重设', 6000);
      closeSettings();
      updateLockBtn();
    });
  }

  /* =========================================================
   * 初始化入口
   * ========================================================= */

  /* =========================================================
   * 私密点位解锁（v20 云端版）
   * 公开点照常显示；私密点在云端是**逐条独立密文**，访客（无 token）根本拿不到。
   * 点右上角「🔒 私密」输入主密码 -> 服务端校验（auth.js login）-> PBKDF2 派生密钥
   * -> AES-256-GCM 逐条解密 -> 显示，工具栏随之出现「☁️ 提交」。
   *
   * 两套存储，别记混：
   *   登录态 token  -> localStorage.misakaToken    （180 天有效，刷新和关标签页都不丢）
   *   解密密钥      -> sessionStorage.misakaKey:main（只在本标签页，关标签页即失效）
   * 所以刷新页面不用重输密码（restoreKey 会拿缓存密钥），关掉标签页才要重新解锁。
   * ========================================================= */
  var LEGACY_UNLOCK_KEY = 'map_unlocked'; // v15 遗留键：早已不持久化解锁态，启动时清理一次
  var lockBusy = false;                   // 防重复提交

  function showLockScreen() {
    var s = document.getElementById('lockScreen');
    if (s) s.classList.remove('hide');
  }
  function hideLockScreen() {
    var s = document.getElementById('lockScreen');
    if (s) s.classList.add('hide');
  }

  /** 是否已有有效登录态（服务端 token 仍在 localStorage 里） */
  function hasToken() { return auth() ? auth().isLoggedIn() : false; }

  /** 刷新后恢复解锁态：本机模式看 sessionStorage，云模式看标签页级密钥缓存 */
  function restoreKey() {
    if (isLocalLike()) {
      if (FP && FP.session.unlocked()) { privateUnlocked = true; return Promise.resolve(true); }
      return Promise.resolve(false);
    }
    var A = auth();
    if (!A || !secrets() || !hasToken()) return Promise.resolve(false);
    return A.cachedKey(MODULE, KDF.salt, KDF.iterations).then(function (key) {
      if (!key) return false;
      privateKey = key;
      privateUnlocked = true;
      return true;
    }).catch(function () { return false; });
  }

  /** 打开解锁弹窗 */
  function openLockModal() {
    var pwd = document.getElementById('lockPwd');
    var msg = document.getElementById('lockMsg');
    if (pwd) pwd.value = '';
    if (msg) msg.className = '';

    if (isLocalLike()) {
      // 本机模式：口令只决定"私密点要不要显示"。要做真加密得靠 WebCrypto，
      // 而 file:// 下浏览器不提供，所以这里如实说清，不假装是加密。
      var t = document.querySelector('#lockScreen .lock-title');
      var h = document.querySelector('#lockScreen .lock-hint');
      var hasPwd = FP && FP.pwd.has();
      if (t) t.textContent = hasPwd ? '私密点位' : '设置私密口令';
      if (h) h.textContent = hasPwd
        ? '输入口令后显示私密点位'
        : '第一次使用：设一个口令，以后查看私密点位需要它';
      if (msg) {
        msg.textContent = hasPwd
          ? '本机模式下的私密 = 界面上隐藏（数据在本机，未加密）'
          : '口令只用于隐藏私密点位，不等同于加密';
      }
    } else if (msg) {
      if (!hasWebCrypto()) {
        msg.textContent = '⚠️ 当前环境不支持浏览器加密接口，请改用 https 访问本页面';
      } else if (!cloud.ok) {
        msg.textContent = '⚠️ 云端不可达，此时解锁也无法取到云端私密数据';
      } else if (cloud.privCount > 0) {
        msg.textContent = '共 ' + cloud.privCount + ' 个私密点位，输入主密码后显示';
      } else {
        msg.textContent = '当前没有私密点位';
      }
    }
    showLockScreen();
    if (pwd) pwd.focus();
  }

  /** 关闭解锁弹窗（不影响已解锁状态） */
  function closeLockModal() {
    hideLockScreen();
  }

  /**
   * 解锁：主密码先交服务端校验（auth.js login），通过后本地派生解密密钥，
   * 再**带 token 重拉一次云端数据**（只有登录后云端才下发 priv），最后逐条解密。
   * 登录失败 = 密码错；解密失败 = 密文不是这把钥匙加的（理论上不该发生，因为全站共用同一口令）。
   */
  function attemptUnlock() {
    if (isLocalLike()) return attemptUnlockLocal();   // 本机模式走口令校验（无加密）
    if (lockBusy) return;
    var box = document.getElementById('lockBox');
    var pwd = document.getElementById('lockPwd');
    var msg = document.getElementById('lockMsg');
    var A = auth();
    var v = pwd.value;

    function fail(text) {
      lockBusy = false;
      pwd.value = '';
      pwd.focus();
      msg.textContent = text;
      msg.className = '';
      if (box) {
        box.classList.remove('shake');
        void box.offsetWidth;   // 重启动画
        box.classList.add('shake');
      }
    }

    if (!v) { fail('请输入密码'); return; }
    if (!hasWebCrypto()) { fail('⚠️ 浏览器加密接口不可用，请改用 https 访问本页面'); return; }
    if (!A || !secrets()) { fail('⚠️ 鉴权组件未加载（auth.js / secrets.js），请刷新页面重试'); return; }
    if (!cloud.ok) { fail('⚠️ 云端不可达，暂时无法解锁（私密数据只在云端）'); return; }

    lockBusy = true;
    msg.textContent = '验证中…';
    msg.className = '';

    A.login(v)
      .then(function () { return A.unlock(MODULE, v, KDF.salt, KDF.iterations); })
      .then(function (key) {
        privateKey = key;
        privateUnlocked = true;
        // 关键：登录后云端才会下发 priv，必须重拉一次（本机未提交的改动由 applyDraft 回放）
        return loadCloudOrStatic();
      })
      .then(function (d) {
        applyLoadedData(d);
        applyDraft();
        return decryptAllPrivate();
      })
      .then(function (n) {
        lockBusy = false;
        hideLockScreen();
        updateLockBtn();
        updateSubmitBtn();
        // 私密点此前从未渲染过，必须整体重建（refreshAll 只切换已存在标记的显隐）
        resetAllAndRender();
        showNotice(n
          ? '🔓 已解锁，显示 ' + n + ' 个私密点位（关闭标签页即失效）'
          : '🔓 已解锁。当前没有私密点位 —— 勾选「🔒 私密点位」新增，再用「☁️ 提交」上云。', 5000);
      })
      .catch(function (err) {
        lockBusy = false;
        // auth.js 的 login 失败统一挂 code='login'（status 里带后端 HTTP 码）
        if (err && (err.code === 'login' || err.status === 401
                    || err.code === 'auth' || err.code === 'AUTH_FAILED')) {
          fail('密码错误，请重试');
          return;
        }
        if (err && err.status === 429) { fail('尝试次数过多，请稍后再试'); return; }
        // 服务端通过但本地解不开：多半是云端密文用了别的口令加密的
        if (err && (err.name === 'OperationError' || err.name === 'DataError')) {
          fail('密码能登录，但私密数据解不开（密文可能是另一把口令加密的）');
          return;
        }
        console.warn('解锁失败:', err);
        fail('解锁失败：' + (err && err.message ? err.message : err));
      });
  }

  /**
   * 本机模式的解锁：第一次输入口令 = 设置口令；之后输入 = 校验。
   * 通过后把私密点从本机库读回内存并重绘（未解锁时它们根本不进内存）。
   * ⚠️ 这里没有加密：本机模式没有 WebCrypto，数据在 localStorage 里是明文，
   *    口令只挡界面。要真加密，得用云模式（那条路径是 AES-256-GCM）。
   */
  function attemptUnlockLocal() {
    if (lockBusy) return;
    var box = document.getElementById('lockBox');
    var pwd = document.getElementById('lockPwd');
    var msg = document.getElementById('lockMsg');
    var v = pwd ? pwd.value : '';

    function fail(text) {
      lockBusy = false;
      if (pwd) { pwd.value = ''; pwd.focus(); }
      if (msg) { msg.textContent = text; msg.className = ''; }
      if (box) {
        box.classList.remove('shake');
        void box.offsetWidth;
        box.classList.add('shake');
      }
    }

    if (!v) { fail('请输入口令'); return; }
    var firstTime = !(FP && FP.pwd.has());
    if (firstTime) {
      if (v.length < 4) { fail('口令至少 4 位'); return; }
      FP.pwd.set(v);
    } else if (!FP.pwd.check(v)) {
      fail('口令不对，请重试');
      return;
    }

    lockBusy = true;
    if (msg) { msg.textContent = '载入中…'; msg.className = ''; }
    privateUnlocked = true;
    FP.session.markUnlocked();

    loadLocalDB().then(function (d) {
      applyLoadedData(d);
      lockBusy = false;
      hideLockScreen();
      updateLockBtn();
      updateSubmitBtn();
      resetAllAndRender();
      var n = privateMarkers().length;
      showNotice((firstTime ? '🔓 口令已设置并解锁' : '🔓 已解锁')
        + (n ? '，显示 ' + n + ' 个私密点位' : '。勾选「🔒 私密点位」新增后自动保存'), 5000);
    }).catch(function (e) {
      lockBusy = false;
      privateUnlocked = false;
      if (FP) FP.session.clearUnlocked();
      fail('载入失败：' + (e && e.message ? e.message : e));
    });
  }

  /** 重新锁定：清掉内存里的密钥与私密点（本机数据与云端数据都不受影响） */
  function lockAgain() {
    privateUnlocked = false;
    privateKey = null;
    if (isLocalLike()) {
      if (FP) FP.session.clearUnlocked();
    } else if (auth()) {
      auth().forgetKey(MODULE);
    }
    stripPrivateFromMemory();
    updateLockBtn();
    updateSubmitBtn();     // 未解锁 -> 提交按钮整个隐藏
    closeAllPopups();
    // 私密点已从数据里移除，需整体重建才能把标记从地图上摘掉
    resetAllAndRender();
    showNotice('🔒 已重新锁定私密点位（本机草稿与云端数据都还在）', 2500);
  }

  /** 同步锁按钮外观（未解锁 🔒 / 已解锁 🔓） */
  function updateLockBtn() {
    var btn = document.getElementById('btnLock');
    if (!btn) return;
    var icon = btn.childNodes[0];
    if (icon && icon.nodeType === 3) icon.nodeValue = privateUnlocked ? '🔓 ' : '🔒 ';
    var txt = btn.querySelector('.btn-text');
    if (txt) txt.textContent = privateUnlocked ? '已解锁' : '私密';
    if (privateUnlocked) btn.classList.add('unlocked');
    else btn.classList.remove('unlocked');
    if (privateUnlocked) {
      btn.title = '私密点位已解锁（' + privateMarkers().length + ' 个，点击重新锁定）';
    } else if (!cloud.ok) {
      btn.title = '云端不可达';
    } else if (cloud.privCount > 0) {
      btn.title = '显示私密点位（共 ' + cloud.privCount + ' 个，点击输入主密码解锁）';
    } else {
      btn.title = '显示私密点位（当前没有私密点位，点击可解锁以便新增）';
    }
  }

  /** 启动：清掉 v15 遗留键与 v19 的整份快照键；解锁态由 restoreKey() 从 sessionStorage 恢复 */
  function initPrivateState() {
    privateUnlocked = false;
    privateKey = null;
    try { sessionStorage.removeItem(LEGACY_UNLOCK_KEY); } catch (e) { /* ignore */ }
    try { localStorage.removeItem(LS_LEGACY_DATA_KEY); } catch (e) { /* ignore */ }
    hideLockScreen();
    updateLockBtn();
    updateSubmitBtn();
  }

  /** 应用启动：绑定工具栏/搜索/表单事件，确认依赖库就绪后进入 startApp */
  function bootApp() {
    setupToolbar();
    setupSearch();
    setupFormEvents();
    setupSettings();
    updateModeTag();

    if (typeof L === 'undefined' || typeof marked === 'undefined') {
      showNotice('⚠️ 地图资源加载失败，正在尝试本地资源...', 5000);
      // 若 CDN 失败且本地 fallback 也未生效，给出提示
      var retry = 0;
      var timer = setInterval(function () {
        retry++;
        if (typeof L !== 'undefined' && typeof marked !== 'undefined') {
          clearInterval(timer);
          startApp();
          return;
        }
        if (retry > 30) {
          clearInterval(timer);
          showNotice('⚠️ 地图库加载失败，请检查网络后刷新页面。', 0);
        }
      }, 200);
      return;
    }
    startApp();
  }

  /** 页面入口：v15 起不再整页拦截，私密点位按需解锁 */
  function init() {
    initPrivateState();
    bootApp();
  }

  function startApp() {
    // 本机模式：解锁态在 sessionStorage 里，必须在读数据**之前**恢复，
    // 否则私密点会在 loadLocalDB 里被当成"未解锁"直接滤掉
    if (isLocalLike() && FP && FP.session.unlocked()) privateUnlocked = true;
    return loadCloudOrStatic()
      .then(function (d) {
        applyLoadedData(d);
        initMap();
        return restoreKey();          // 刷新后从 sessionStorage 恢复密钥（关标签页即失效）
      })
      .then(function () {
        return decryptAllPrivate();   // 有密钥才解密，否则原样返回 0
      })
      .then(function () {
        loadDraft();
        applyDraft();                 // 把本机未提交的改动回放到内存，刷新后仍看得到
        resetAllAndRender();
        updateLockBtn();
        updateSubmitBtn();
        updateModeTag();

        // 首次打开：说清"这是示例数据"，别让人误以为进错了地方
        var firstRunKey = 'fp_seen_v1';
        var seen = null;
        try { seen = localStorage.getItem(firstRunKey); } catch (e) { /* ignore */ }
        if (FP && FP.env && FP.env.storage === false) {
          // 存不下就别假装能存：明确告诉用户，免得记了一堆点白丢
          showNotice('⚠️ 这个环境禁用了浏览器本地存储，新增的点位<b>关掉页面就会丢</b>。'
            + '请改用普通窗口打开，或每次记完点「💾 导出」存一份。', 0);
        } else if (!seen) {
          try { localStorage.setItem(firstRunKey, '1'); } catch (e) { /* ignore */ }
          showNotice('👋 这是<b>示例足迹</b>，随便点点看。换成自己的：双击地图添加，或用「📂 导入」载入 JSON。', 12000);
        } else if (isLocalLike() && !data.markers.length) {
          showNotice('双击地图任意位置添加第一个地点；手机上长按 600ms。', 8000);
        }

        // 数据里带了标题就用它（换机导入自己的数据时能保留名字）
        var bt = document.getElementById('brandTitle');
        if (bt && data.config.title && data.config.title !== '我的足迹地图') {
          bt.textContent = '📍 ' + data.config.title;
        }
      })
      .catch(function (e) {
        console.error('启动失败:', e);
        showNotice('⚠️ 启动出错：' + (e && e.message ? e.message : e), 0);
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
