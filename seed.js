/**
 * footprint-map · 示例数据（第一次打开时展示用的「别人的足迹」）
 * =========================================================
 * 这是一份虚构的旅行记录，点位坐标为公开景点信息，文案为示例。
 * 你的真实数据不会进这里：想换成自己的，用工具栏「导入」载入导出的 JSON，
 * 或用「重置」→「清空全部」从空白开始。
 */
window.__FP_SEED__ = {
  "config": {
    "defaultCenter": [
      29.6,
      102.4
    ],
    "defaultZoom": 6,
    "defaultLayer": "satellite",
    "title": "我的足迹地图"
  },
  "categories": [
    {
      "key": "journey",
      "name": "路程",
      "icon": "red-dot",
      "inRoute": true
    },
    {
      "key": "food",
      "name": "🍜 好吃的",
      "icon": "orange-fork",
      "inRoute": false
    },
    {
      "key": "drink",
      "name": "🍵 好喝的",
      "icon": "brown-cup",
      "inRoute": false
    },
    {
      "key": "fun",
      "name": "🎮 好玩的",
      "icon": "green-star",
      "inRoute": false
    },
    {
      "key": "sight",
      "name": "🏞️ 风景",
      "icon": "blue-mountain",
      "inRoute": false
    },
    {
      "key": "wishlist",
      "name": "💡 兴趣点",
      "icon": "yellow-bulb",
      "inRoute": false
    }
  ],
  "markers": [
    {
      "id": "m_demo_001",
      "lat": 30.654952,
      "lng": 104.081417,
      "name": "春熙路·太古里",
      "iconUrl": "",
      "category": "journey",
      "visited": true,
      "time": "2024-10-02 15:20",
      "content": "### 出发\n环线的起点。出发前在太古里买了防晒和一瓶水，事实证明这两样是全程最值的东西。\n\n> 小贴士：川西环线 10 月昼夜温差能有 15℃，冲锋衣别嫌占地方。"
    },
    {
      "id": "m_demo_002",
      "lat": 31.000851,
      "lng": 103.611322,
      "name": "都江堰",
      "iconUrl": "",
      "category": "journey",
      "visited": true,
      "time": "2024-10-03 09:40",
      "content": "### 两千多年还在用的水利工程\n站在鱼嘴看岷江被劈成内外两江，第一次觉得「古人智慧」这四个字不是场面话。\n\n- 门票 80 元\n- 建议 3 小时，从南桥进、离堆公园出"
    },
    {
      "id": "m_demo_003",
      "lat": 30.907891,
      "lng": 103.559815,
      "name": "青城山",
      "iconUrl": "",
      "category": "journey",
      "visited": true,
      "time": "2024-10-03 15:00",
      "content": "### 青城天下幽\n前山道观多、台阶少，后山是纯徒步。这趟只走了前山，天师洞往上雾气很重。"
    },
    {
      "id": "m_demo_004",
      "lat": 30.993079,
      "lng": 102.832468,
      "name": "四姑娘山",
      "iconUrl": "",
      "category": "journey",
      "visited": true,
      "time": "2024-10-05 08:30",
      "content": "### 双桥沟\n观光车一路到红杉林，海拔 3840m，走快了会喘。幺妹峰那天没露脸，云太厚。"
    },
    {
      "id": "m_demo_005",
      "lat": 30.940488,
      "lng": 101.865601,
      "name": "丹巴甲居藏寨",
      "iconUrl": "",
      "category": "journey",
      "visited": true,
      "time": "2024-10-06 16:10",
      "content": "### 藏寨的黄昏\n整个山坡上的白色房子，太阳斜下来的时候屋顶全是金色。住在寨子里的民宿，晚上能看见整条银河。"
    },
    {
      "id": "m_demo_006",
      "lat": 30.044018,
      "lng": 101.493546,
      "name": "新都桥",
      "iconUrl": "",
      "category": "journey",
      "visited": true,
      "time": "2024-10-07 11:20",
      "content": "### 摄影天堂\n名不虚传，但更难忘的是路边一段无人的杨树林。\n\n> 高原反应提示：这里海拔 3460m，前一天别喝酒。"
    },
    {
      "id": "m_demo_007",
      "lat": 28.405385,
      "lng": 100.388799,
      "name": "稻城亚丁",
      "iconUrl": "",
      "category": "journey",
      "visited": true,
      "time": "2024-10-09 07:00",
      "content": "### 牛奶海\n从洛绒牛场徒步 5 小时来回，最后 1 公里几乎是挪上去的。海拔 4600m，风大到站不稳。\n\n**值不值？** 看到海子的那一瞬间，值。"
    },
    {
      "id": "m_demo_008",
      "lat": 27.702886,
      "lng": 100.790904,
      "name": "泸沽湖",
      "iconUrl": "",
      "category": "journey",
      "visited": true,
      "time": "2024-10-12 10:15",
      "content": "### 一半四川，一半云南\n环湖公路骑了一整天，里格半岛的日落是全程最好看的一次。"
    },
    {
      "id": "m_demo_009",
      "lat": 26.870356,
      "lng": 100.236407,
      "name": "丽江古城",
      "iconUrl": "",
      "category": "journey",
      "visited": true,
      "time": "2024-10-14 19:40",
      "content": "### 人比想象中多\n早上七点的古城才是古城，九点之后就变成商业街了。"
    },
    {
      "id": "m_demo_010",
      "lat": 25.695295,
      "lng": 100.163701,
      "name": "大理古城",
      "iconUrl": "",
      "category": "journey",
      "visited": true,
      "time": "2024-10-17 14:00",
      "content": "### 苍山洱海之间\n在才村码头坐了一下午，看云从苍山上翻过来。"
    },
    {
      "id": "m_demo_011",
      "lat": 27.826488,
      "lng": 102.313737,
      "name": "西昌邛海",
      "iconUrl": "",
      "category": "journey",
      "visited": true,
      "time": "2024-10-20 16:30",
      "content": "### 回程路上的意外\n本来只打算过一晚，结果为了邛海的日落多住了两天。烧烤一条街必须去。"
    },
    {
      "id": "m_demo_012",
      "lat": 29.520008,
      "lng": 103.339025,
      "name": "峨眉山",
      "iconUrl": "",
      "category": "journey",
      "visited": true,
      "time": "2025-04-05 06:30",
      "content": "### 金顶看日出\n凌晨三点从雷洞坪开始爬，到金顶刚好赶上。零下五度，手冻得拍不了照。\n\n- 门票 160 元 + 观光车 90 元\n- 索道往返 120 元（体力有限强烈建议坐）"
    },
    {
      "id": "m_demo_013",
      "lat": 29.544156,
      "lng": 103.77152,
      "name": "乐山大佛",
      "iconUrl": "",
      "category": "journey",
      "visited": true,
      "time": "2025-04-07 10:00",
      "content": "### 排队两小时，看佛十分钟\n九曲栈道排队的队伍绕了三圈。下次会选坐船看，从江上看更完整。"
    },
    {
      "id": "m_demo_014",
      "lat": 29.56219,
      "lng": 106.579032,
      "name": "洪崖洞",
      "iconUrl": "",
      "category": "journey",
      "visited": true,
      "time": "2025-06-14 20:30",
      "content": "### 千与千寻\n吊脚楼的灯一亮，确实像动画里。但人流量也是真的夸张，晚上八点以后基本是被人流推着走。"
    },
    {
      "id": "m_demo_015",
      "lat": 26.598021,
      "lng": 106.694088,
      "name": "贵阳黔灵山公园",
      "iconUrl": "",
      "category": "journey",
      "visited": true,
      "time": "2025-08-09 09:00",
      "content": "### 满山猴子\n黔灵山的猕猴是真抢东西，包拉链要拉好。山顶的弘福寺很安静。"
    },
    {
      "id": "m_demo_016",
      "lat": 25.989091,
      "lng": 105.669501,
      "name": "黄果树瀑布",
      "iconUrl": "",
      "category": "journey",
      "visited": true,
      "time": "2025-08-11 10:40",
      "content": "### 水雾十米\n还没走近衣服就湿了。水帘洞能从瀑布里面穿过去，这个体验别处没有。"
    },
    {
      "id": "m_demo_017",
      "lat": 25.260352,
      "lng": 107.715577,
      "name": "荔波小七孔",
      "iconUrl": "",
      "category": "journey",
      "visited": true,
      "time": "2025-08-13 08:20",
      "content": "### 一路都是水\n68 级跌水瀑布、翠谷瀑布、卧龙潭——手机相册直接爆掉。夏天来最舒服。"
    },
    {
      "id": "m_demo_018",
      "lat": 33.11621,
      "lng": 103.886073,
      "name": "九寨沟",
      "iconUrl": "",
      "category": "journey",
      "visited": true,
      "time": "2026-05-02 08:00",
      "content": "### 补上的那一站\n去年环线时封路没进来，这次专门补上。五花海的颜色不像真的。"
    },
    {
      "id": "m_demo_019",
      "lat": 33.477917,
      "lng": 102.470518,
      "name": "若尔盖·黄河九曲第一湾",
      "iconUrl": "",
      "category": "journey",
      "visited": true,
      "time": "2026-05-05 18:00",
      "content": "### 等一场落日\n观景台爬上去要 40 分钟，海拔 3400m。日落时整条河曲变成金色，值得等。"
    },
    {
      "id": "m_demo_020",
      "lat": 30.66375,
      "lng": 104.053283,
      "name": "宽窄巷子",
      "iconUrl": "",
      "category": "food",
      "visited": true,
      "time": "2024-10-02 12:00",
      "content": "### 🍜 第一顿\n担担面、钟水饺、三大炮。游客多但小吃集中，适合刚到成都的人。\n\n人均 60 元"
    },
    {
      "id": "m_demo_021",
      "lat": 30.629531,
      "lng": 104.062555,
      "name": "玉林路小酒馆",
      "iconUrl": "",
      "category": "food",
      "visited": true,
      "time": "2024-10-02 21:00",
      "content": "### 🍜 走到玉林路的尽头\n因为一首歌来的，结果发现整条玉林街都是吃的。串串香比酒馆更值得。\n\n人均 80 元"
    },
    {
      "id": "m_demo_022",
      "lat": 30.646251,
      "lng": 104.049855,
      "name": "锦里",
      "iconUrl": "",
      "category": "food",
      "visited": true,
      "time": "2025-04-06 19:00",
      "content": "### 🍜 夜里最热闹\n和武侯祠连在一起，晚上灯笼全亮。糖油果子现炸的最好吃。\n\n人均 50 元"
    },
    {
      "id": "m_demo_023",
      "lat": 29.580775,
      "lng": 106.450637,
      "name": "磁器口古镇",
      "iconUrl": "",
      "category": "food",
      "visited": true,
      "time": "2025-06-15 11:00",
      "content": "### 🍜 陈麻花排队\n古镇本身一般，但麻花和鸡杂是真的香。建议从后街进，人少一半。\n\n人均 70 元"
    },
    {
      "id": "m_demo_024",
      "lat": 26.557467,
      "lng": 106.707315,
      "name": "贵阳二七路小吃街",
      "iconUrl": "",
      "category": "food",
      "visited": true,
      "time": "2025-08-09 18:30",
      "content": "### 🍜 贵阳人的深夜食堂\n丝娃娃、肠旺面、烤脑花。一条街走完能吃十样。\n\n人均 60 元"
    },
    {
      "id": "m_demo_025",
      "lat": 30.740846,
      "lng": 104.135457,
      "name": "成都大熊猫基地",
      "iconUrl": "",
      "category": "sight",
      "content": "### 一直没排上\n听说要早上 7 点就去，不然熊猫都回屋睡觉了。下次专门为它来一趟。"
    },
    {
      "id": "m_demo_026",
      "lat": 30.314869,
      "lng": 103.971233,
      "name": "黄龙溪古镇",
      "iconUrl": "",
      "category": "sight",
      "content": "### 适合周末的那种地方\n离成都近，玩水、喝茶、吃豆花。人不多的时候很舒服。"
    },
    {
      "id": "m_demo_027",
      "lat": 26.013855,
      "lng": 100.037688,
      "name": "大理西湖水上运动中心",
      "iconUrl": "",
      "category": "wishlist",
      "content": "### 💡 想试试桨板\n在大理时路过，看到有人在湖上划。下次带装备来。"
    },
    {
      "id": "m_demo_028",
      "lat": 27.007795,
      "lng": 100.262599,
      "name": "丽江东巴谷汽车旅游营地",
      "iconUrl": "",
      "category": "wishlist",
      "content": "### 💡 自驾露营备选\n有水电、有卫生间，适合房车和自驾过夜。已记在下次路线的清单里。"
    }
  ]
};
