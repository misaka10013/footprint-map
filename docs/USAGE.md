# 详细用法与配置

面向「想改成自己用的」读者。README 讲它是什么，这份讲**怎么动它**。

---

## 一、先搞清一件事：你的数据到底存在哪

这是最容易误会的点 —— **数据不在文件里，在浏览器的 localStorage 里**。

| 键名 | 存什么 | 什么时候清 |
|---|---|---|
| `fp_db_v1` | 你的全部点位 + `config` + `categories` | 「清空为空白」会把它写成空库；浏览器「清除站点数据」会整条删掉 |
| `fp_settings_v1` | 运行设置：`mode` / `apiBase` / `tiandituTk` | 设置面板改动时写入 |
| `fp_pwd_v1` | 口令指纹（不是口令本身） | 设置面板「重设口令」 |
| `fp_unlocked_v1`（sessionStorage） | 本标签页已解锁标记，关标签页即失效 | 自动 |

所以：

- **加完点、刷新、关掉浏览器再双击 `index.html`，数据都还在** —— 不需要重新导入。
- 换了浏览器、换了电脑、清过缓存、用无痕窗口 → 数据不在了，这时才需要导入。
- ⚠️ 数据只在浏览器里，**没有第二份**。定期点「💾 导出备份」是唯一的保险。

> `file://` 下 localStorage 归属于哪个来源，由浏览器自己决定（Chrome/Edge 通常把本地 html
> 视作同一来源，但换路径、换浏览器可能就读不到）。这一点各浏览器行为不一致，**重要数据
> 一律以导出的 JSON 为准**。

---

## 二、导出 / 导入到底怎么用

| 场景 | 做法 |
|---|---|
| 日常使用 | **什么都不用做**。数据已经在浏览器里，直接打开就看得见 |
| 备份 / 防丢 | 设置 →「💾 导出备份」，得到一个 `footprint-map-日期.json` |
| 换电脑 / 换浏览器 | 在新环境打开页面 →「📂 导入 JSON」→ 选那个文件 |
| 换掉这个项目、迁到别处 | 导出的 JSON 就是全部数据，格式见 README「数据格式」一节 |

**导出文件放哪里？** 放哪都行，它是备份不是配置。放在 `index.html` 旁边**不会**被自动读取
（下面这条要特别注意）。

**导入是合并，不是覆盖。** 按 `id` 比对：**同 id 不会被覆盖** —— 它会重新编号后作为新条目加入
（所以重复导入同一个备份，会出现两份看起来一样的地点，这不是 bug，是「绝不静默丢数据」的代价）。
想清干净再来一次：先「⬜ 清空为空白」再导入。

> ⚠️ 常见误解：以为把导出的 JSON 改名成 `data.json` 放进目录，打开就能看到。
> **本机模式和静态托管模式都不会读它** —— 这两种模式的数据源只有两个：localStorage、
> 或者没有 localStorage 时的 `seed.js`。`data.json` 只在**云端模式**下、且云端不可达时
> 作为回退快照被读取（见 `app.js` 的 `loadFromStatic()`）。

---

## 三、想让「所有人打开就看到我的数据」：改 seed.js

静态托管时，访客首次打开看到的是 `seed.js`，不是你的导出文件。要把自己的数据变成
「初始内容」，唯一正确做法是**把导出内容包成 seed.js**：

```js
window.__FP_SEED__ = {
  "config": { "defaultCenter": [30.533, 105.573], "defaultZoom": 11, "defaultLayer": "satellite", "title": "我的足迹地图" },
  "categories": [ ... ],
  "markers": [ ... ]
};
```

步骤：

1. 先在本地把点位整理好 →「💾 导出备份」
2. 打开导出文件，把里面的 `config` / `categories` / `markers` 三个字段**原样搬进**
   上面那个骨架（`_fp` 这样的元信息字段丢掉）
3. 覆盖 `seed.js`，`git push`
4. 访客清一下缓存或换无痕窗口验证

注意导出文件里的 `_fp.full` / `priv` 是备份元信息，不属于 seed 结构，不要搬进去。

---

## 四、改地图打开时的默认位置、层级、底图

改 `seed.js` 里的 `config`：

```json
"config": {
  "defaultCenter": [30.533, 105.573],
  "defaultZoom": 11,
  "defaultLayer": "satellite",
  "title": "我的足迹地图"
}
```

| 字段 | 含义 | 注意 |
|---|---|---|
| `defaultCenter` | 打开时地图中心 `[纬度, 经度]` —— 顺序是 **`[lat, lng]`**，别写反 | 坐标是 **GCJ-02（火星坐标）**，直接去高德坐标拾取器取数即可；用 WGS-84（GPS 原始值）会有几百米偏移 |
| `defaultZoom` | 初始缩放，3–18 | 越小看得越广。城市级 10–12，省域 6–8，全国 5 |
| `defaultLayer` | 初始底图 | 可选 `normal` / `satellite` / `osm` / `carto` / `esri` / `tianditu`（天地图需先在设置里填 key，否则自动退回 `satellite`） |
| `title` | **预留字段，当前不生效** | 页面上不渲染它，改标题要动 `index.html`（见下一节） |

### ⚠️ 改了 seed.js 却没生效？

因为**本机已经有数据库了，打开时用的是库里的 `config`，不是 seed 的**（`loadLocalDB()`：
有 `fp_db_v1` 就用它，没有才用 seed）。

让它生效的三条路，按推荐顺序：

1. 设置 →「✨ 恢复示例数据」→ 会用新 seed 整体替换（**会覆盖当前点位，先导出**）
2. 浏览器开发者工具 → Application → Local Storage → 删掉 `fp_db_v1` → 刷新
3. 清空站点数据（等于连设置和口令一起重置）

**注意**：点「⬜ 清空为空白」**不会**应用新 seed 的 `config` —— 它是把当前 `config` 配 0 个点位写回库。

---

## 五、改页面上显示的名字

`title` 配置不生效，品牌名是写死在 `index.html` 里的两处：

```html
<title>我的足迹地图</title>              <!-- 浏览器标签页 -->
<span class="brand" id="brandTitle">📍 足迹地图</span>   <!-- 左上角 -->
```

---

## 六、`config.js` 是什么，要不要改

**不要改。** 它不是配置文件，是运行时的数据层（`window.FP` 命名空间），负责：
模式判定、localStorage 读写、口令指纹、环境探测、导出 seed。

你想调的东西都不在这里：

| 你想改的 | 实际位置 |
|---|---|
| 默认中心 / 缩放 / 底图 | `seed.js` → `config` |
| 显示名称 | `index.html` |
| 数据存哪、接哪个后端 | 页面里「⚙️ 设置」面板（存 `fp_settings_v1`） |
| 天地图 key | 设置面板「底图 · 天地图 key」 |
| 分类的增删改名 | `seed.js` → `categories`（`key` 必须是 `journey` 那一条才会连路线，见文末说明） |

`config.js` 对外暴露的接口（想二次开发时有用）：

| 接口 | 作用 |
|---|---|
| `FP.settings()` / `FP.saveSettings({...})` | 读写 `fp_settings_v1` |
| `FP.effectiveMode()` | 返回 `local` / `static` / `cloud` |
| `FP.localDB.get()` / `.set(data)` / `.bytes()` / `.clear()` | 本机数据库 |
| `FP.pwd.set(p)` / `.check(p)` / `.has()` / `.clear()` | 口令指纹 |
| `FP.seed()` | 取 `seed.js` 的内容 |

---

## 七、其他常见问题

**手机上能用吗？** 能。长按地图 600ms 加点。手机浏览器打开同一个 URL，各自存各自的数据。

**点位里的图片怎么放？** `content` 是 Markdown，图片走外链（`![](https://...)`）。
不要塞 base64，localStorage 只有 5MB 左右，几张图就满了。

**能存多少条？** 纯文字点位几千条没问题，瓶颈是 localStorage 的 ~5MB。

**路线怎么连？** 连线条件是写死的三个「且」：`category === 'journey'`（分类 key 必须正好是
`journey`，改名这个 key 会直接断掉连线）、`visited: true`、`time` 非空，然后按时间排序连线。

> 已知小坑：`categories` 里的 `inRoute` 字段目前**没有生效** —— 代码里是直接判 `category === 'journey'`。
> 想支持「自定义哪些分类连进路线」，需要把 `getRouteMarkers()` 里的硬判断改成读 `inRoute`。
