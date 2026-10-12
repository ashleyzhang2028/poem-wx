(function () {
  "use strict";

  var WHY = {
    device: "设备偏好：字号 / 对齐 / 注音档 / 连读档说的是「这台设备长什么样」，" +
            "不是「这个账号学到哪」。手机上调小字、平板调大字本来就是两回事，同步过去反而要每次重调。",
    account: "会话与层级：它们**本来就是服务端下发**的（/api/me），本机那一份是缓存，" +
             "不是数据源。缓存上云等于把「服务端的答案」再送回服务端一次。",
    sync: "同步层自己的状态（开关、游标、记账、合并前的后悔药）：" +
          "它们是「这台设备同步到哪了」，跨设备同步过去没有意义，还会互相打架。",
    trans: "一次操作的临时态（搜索框里那个词）：换设备接着搜同一句的期望很弱，" +
           "而它随时会被下一次输入覆盖。",
    server: "**服务端本来就是权威那一份**（报告台账 public.reports）：本机这一把只是" +
            "断网 / 未登录时的回执缓存，服务端那一份读得到时以它为准。" +
            "缓存上云等于把「服务端的答案」再送回服务端一次（与 WHY.account 同源）。"
  };

  var ROWS = [
    {
      key: "poem_recite_progress_v1", sync: true, row: "每篇一行（poem_id = 篇 id）",
      merge: "谁最后改谁赢（updatedAt 大的胜）",
      cap: "每篇约 120 B；history 尾部 200 条封顶",
      why: "背到哪一步了 —— 换设备接着背，这个最不能少。"
    },
    {
      key: "poem_recite_settings_v1", sync: true, row: "settings:v1",
      merge: "谁最后改谁赢",
      cap: "约 1 KB；**只带账号域那五个字段**（FIELDS.settings = 年级 / 学期 / 范围 / 每日数量 / 算法）",
      why: "账号域的设置（学段 / 年级 / 学期 / 范围 / 每日数量 / 算法）是「这个账号怎么背」。" +
           "⚠️ 这一把键是**混装**的：`helper`（阅读辅助总开关）历史上也住在这里，" +
           "但它说的是「这台设备长什么样」，所以它**不跟着上云** —— " +
           "`FIELDS.device = [\"helper\"]` 把它划到设备域，" +
           "`ProgressStore.helper()` 读到之后会当场搬到 `poem_device_prefs_v1`。" +
           "口径一句话：**同一把键里，账号域的走 settings:v1，设备域的留在本机**。"
    },
    {
      key: "poem_profile_v1", sync: true, row: "family:v1（放在名册里，不单独一行）",
      merge: "名册整体",
      cap: "≤ 200 人",
      why: "昵称与头像地址是「你是谁」，与学段设置同属账号域。"
    },
    {
      key: "poem_family_v1", sync: true, row: "family:v1",
      merge: "名册整体（本地更新则本机胜，见 applyRemoteFamily）",
      cap: "≤ 200 人",
      why: "一个家长几个孩子，换台设备得还认得出来。"
    },
    {
      key: "poem_recite_collections_v1", sync: true, row: "collections:v1",
      merge: "谁最后改谁赢；**首次合并要用户裁决**（两端结构不同，按篇并会得到一份谁也不认识的东西）",
      cap: "集合 ≤ 5000、每集合 ≤ 500 篇、每篇快照正文各截 20000 字",
      why: "「我要背的」是长期清单 —— Issue #243 本次补上（原先漏在表外）。"
    },
    {
      key: "poem_poems_read_v1", sync: true, row: "reads:poem_poems_read_v1",
      merge: "**并集**（读过就是读过，哪一端都不该被抹掉）",
      cap: "每行 ≤ 2000 篇；只带读过的（稀疏）",
      why: "课内目录的已读标记 —— Issue #243 本次补上。"
    },
    {
      key: "poem_classic_read_v1", sync: true, row: "reads:poem_classic_read_v1",
      merge: "并集", cap: "每行 ≤ 2000 篇",
      why: "小古文已读 —— Issue #243 本次补上。"
    },
    {
      key: "poem_tangshi_read_v1", sync: true, row: "reads:poem_tangshi_read_v1",
      merge: "并集", cap: "每行 ≤ 2000 篇",
      why: "唐诗已读 —— Issue #243 本次补上（Issue #461 改名）。"
    },
    {
      key: "poem_gushi_read_v1", sync: true, row: "reads:poem_gushi_read_v1",
      merge: "并集", cap: "每行 ≤ 2000 篇",
      why: "古诗「非唐代」已读 —— Issue #461 新增集子。"
    },
    {
      key: "poem_songci_read_v1", sync: true, row: "reads:poem_songci_read_v1",
      merge: "并集", cap: "每行 ≤ 2000 篇",
      why: "词已读 —— Issue #243 本次补上（Issue #461 改名并扩口径）。"
    },
    {
      key: "poem_guwen_read_v1", sync: true, row: "reads:poem_guwen_read_v1",
      merge: "并集", cap: "每行 ≤ 2000 篇",
      why: "古文观止已读 —— Issue #243 本次补上。"
    },
    {
      key: "poem_zhaoming_read_v1", sync: true, row: "reads:poem_zhaoming_read_v1",
      merge: "并集", cap: "每行 ≤ 2000 篇",
      why: "昭明文选已读 —— Issue #243 本次补上。"
    },
    {
      key: "poem_yuanqu_read_v1", sync: true, row: "reads:poem_yuanqu_read_v1",
      merge: "并集", cap: "每行 ≤ 2000 篇",
      why: "曲已读 —— 与其余各部同一族（Issue #243 本次补上整族；Issue #461 改名）。"
    },
    {
      key: "poem_yuefu_read_v1", sync: true, row: "reads:poem_yuefu_read_v1",
      merge: "并集", cap: "每行 ≤ 2000 篇",
      why: "乐府集已读 —— 与其余各部同一族（Issue #244 新增集子，同轮补上）。"
    },
    {
      key: "poem_authors_read_v1", sync: true, row: "reads:poem_authors_read_v1",
      merge: "并集", cap: "每行 ≤ 2000 篇",
      /* ⚠️ 这一把键有它自己的坑：作者索引页**每换一位作者就换一炉 items**，
         但 readStore 是同一个（`poem_authors_read_v1`）—— 这是要的：已读
         跟的是**篇**不是作者，在李白那儿点「已读」的《静夜思》，翻到杜甫
         那一段时仍该是已读的（那是同一篇）。所以键按页不按作者。 */
      why: "作者索引已读 —— 与其余各部同一族；键按**页**不按作者（Issue #480）。"
    },
    {
      key: "poem_jinxiandai_read_v1", sync: true, row: "reads:poem_jinxiandai_read_v1",
      merge: "并集", cap: "每行 ≤ 2000 篇",
      why: "近现代诗词已读 —— 与其余各部同一族（2026-09-19 新增第九部）。"
    },
    {
      key: "poem_chengyu_read_v1", sync: true, row: "reads:poem_chengyu_read_v1",
      merge: "并集", cap: "每行 ≤ 2000 篇",
      why: "中华成语故事已读 —— 与其余各部同一族（2026-09-25 新增第十部）。"
    },
    {
      key: "poem_changshi_read_v1", sync: true, row: "reads:poem_changshi_read_v1",
      merge: "并集", cap: "每行 ≤ 2000 篇",
      why: "文学常识已读 —— 与其余各部同一族（Issue #342 新增第十一部）。"
    },
    {
      key: "poem_mingshu_read_v1", sync: true, row: "reads:poem_mingshu_read_v1",
      merge: "并集", cap: "每行 ≤ 2000 篇",
      why: "名著导读已读 —— 与其余各部同一族（Issue #381 新增第十二部）。"
    },
    /* Issue #399：历代名家拆两部 —— 老键留一份（迁移用，见 js/mingren.js 的
       migrateReadStore），两卷各自一把新键。三把都是「已读」那一族。 */
    {
      key: "poem_mingren_read_v1", sync: true, row: "reads:poem_mingren_read_v1",
      merge: "并集", cap: "每行 ≤ 2000 篇",
      why: "历代名家已读（老键）—— 拆两部之前的那一把，现在只作迁移源。"
    },
    {
      key: "poem_mingren_cn_read_v1", sync: true, row: "reads:poem_mingren_cn_read_v1",
      merge: "并集", cap: "每行 ≤ 2000 篇",
      why: "名家「中国」已读 —— Issue #399 拆两部后的中国卷。"
    },
    {
      key: "poem_mingren_foreign_read_v1", sync: true, row: "reads:poem_mingren_foreign_read_v1",
      merge: "并集", cap: "每行 ≤ 2000 篇",
      why: "名家「外国」已读 —— Issue #399 拆两部后的外国卷。"
    },
    /* Issue #407：帝王两卷 —— 与历代名家同一族，各有一把「已读」键。 */
    {
      key: "poem_dwang_cn_read_v1", sync: true, row: "reads:poem_dwang_cn_read_v1",
      merge: "并集", cap: "每行 ≤ 2000 篇",
      why: "帝王「中国」已读 —— Issue #407 新开的两卷之一。"
    },
    {
      key: "poem_dwang_foreign_read_v1", sync: true, row: "reads:poem_dwang_foreign_read_v1",
      merge: "并集", cap: "每行 ≤ 2000 篇",
      why: "帝王「外国」已读 —— Issue #407 新开的两卷之一。"
    },
    {
      key: "poem_pinyin_fix_v1", sync: true, row: "pinyin_fix:v1",
      merge: "谁最后改谁赢（整份一份表，按条并会得到一份「一半是本机编的」的表）",
      cap: "≤ 500 条、每句 ≤ 120 字；**只有条目，不存正文** —— 体积天然很小",
      why: "注音勘误（Issue #243）：某篇某句某字读什么。它必须上云 —— " +
           "用户在「滕王阁序」里改对的那一处，换台设备、换个浏览器也该是对的。"
    },
    {
      key: "poem_daily_extra_v1", sync: true, row: "daily_extra:v1",
      merge: "**按天并集**（日期相同才并；日期不同听本机的）",
      cap: "≤ 20 篇、每篇快照正文各截 20000 字",
      why: "今天临时多背的那几首 —— 2026-09-19 用户当面改的口径（§4.32）。"
    },
    {
      key: "poem_recite_defer_v1", sync: true, row: "defer:v1",
      merge: "**并集**（作品号 + 档位为一条，两端各点各的，谁也不该被抹掉）",
      cap: "≤ 400 条、每条只存「作品号 + 点它的那一天 + 搁到哪天 + 搁多少天」—— 体积天然很小",
      why: "「明日再背」/「月后再背」点过的那几首（Issue #481）：在手机上说「明天再背」的那一首，" +
           "平板打开时不该又冒出来，「我的」页那两个名单也得认得全。按作品存（同一份作品的" +
           "课内本 / 集子本算同一首），两档是同一个「哪天之前不排」（`until`），只是日子" +
           "长短不同（`span` 1 天 / 30 天）—— 两头都得上云，不然「手机上点过、平板上照旧上榜」。"
    },
    {
      key: "poem_avatar_local_v1", sync: true, row: "avatar:v1（**字节不进 payload**，走 Storage 桶）",
      merge: "谁最后改谁赢（上传成功即写账号域的公开地址）",
      cap: "≤ 1 MB（AVATAR_MAX_BYTES），且**这是唯一一处「体积太大」**：",
      why: "头像图片的字节 —— 一张 400 KB 的 data URL 塞进 progress 会撑爆 jsonb，" +
           "所以走已有的 Storage 通路，不走同步载荷。断网 / 未登录时它仍然只在本机（这是事实）。" +
           "⚠️ 它**按子用户分家**（Issue #320 起：键名是 `poem_avatar_local_v1::<子用户 id>`）——" +
           "「这个孩子长什么样」与昵称同属「你是谁」，混成一份的症状就是" +
           "「切了子用户，昵称换了、头像还是上一个孩子那张脸」。"
    },
    {
      key: "poem_reports_v1", sync: false, row: "", merge: "", cap: WHY.server,
      why: "用户报过的错（回执）。**报告本身在服务端的 reports 表里**——" +
           "它是写给管理员看的台账，不是「这个账号学到哪」：" +
           "① 与孩子无关（不分区）；② 单向（用户→服务端→管理员），" +
           "参与同步的下场是「本机那份被云端覆盖，刚报的错跟着回到旧状态」；" +
           "③ 管理端要按状态检索与回写，而 progress 的载荷是黑盒 jsonb。" +
           "本机这一把只是没登录 / 断网时的兜底（Issue #243 第四轮）。"
    },
    {
      key: "poem_pinyin_global_v1", sync: false, row: "", merge: "", cap: WHY.server,
      why: "全站生效的注音勘误（Issue #348）：只读缓存 GET /api/pinyin-fixes 的应答。" +
           "权威答案在服务端 public.pinyin_proposals（status=approved），这里只是" +
           "「省一次请求」的本机副本，几小时后台自动刷新一次；参与同步的下场是" +
           "「一台设备批准的东西，靠同步（而不是服务端审核）就传到了别的设备」——" +
           "绕开了审核这道闸。个人预览（poem_pinyin_fix_v1）与它是两回事：" +
           "前者只对做勘误的那个账号生效，这一把才是所有人都读到的那份。"
    },
    {
      key: "poem_font_v1", sync: false, row: "", merge: "", cap: WHY.device,
      why: "首页正文的字号档。"
    },
    {
      key: "poem_align_v1", sync: false, row: "", merge: "", cap: WHY.device,
      why: "首页正文的对齐档。"
    },
    {
      key: "poem_classic_font_v1", sync: false, row: "", merge: "", cap: WHY.device,
      why: "集子阅读器的字号档。"
    },
    {
      key: "poem_classic_align_v1", sync: false, row: "", merge: "", cap: WHY.device,
      why: "集子阅读器的对齐档。"
    },
    {
      key: "poem_helper_pinyin_v1", sync: false, row: "", merge: "", cap: WHY.device,
      why: "注音档（关 / 生字 / 全文）。"
    },
    {
      key: "poem_play_mode_v1", sync: false, row: "", merge: "", cap: WHY.device,
      why: "连读方式档（原文 / 白话 / 随机那五档）。"
    },
    {
      key: "poem_device_prefs_v1", sync: false, row: "", merge: "", cap: WHY.device,
      why: "设备域的收纳盒（`helper` 住这里）——「阅读辅助」总开关。" +
           "它原先混在 `poem_recite_settings_v1` 里，被 `settings:v1` 那一行整份推上云；" +
           "**现在只有这一把键说了算**，且不上云（手机开了阅读辅助、平板没开，是两回事）。"
    },
    {
      key: "poem_search_kw_v1", sync: false, row: "", merge: "", cap: WHY.trans,
      why: "搜索框里最后那个词。"
    },
    {
      key: "poem_sync_pref_v1", sync: false, row: "", merge: "", cap: WHY.sync,
      why: "同步开关（出厂关着）。"
    },
    {
      key: "poem_sync_seen_v1", sync: false, row: "", merge: "", cap: WHY.sync,
      why: "记账表（每个云端行号同步到哪了）+ 已读那一族的时间戳也借住在这里。"
    },
    {
      key: "poem_pre_merge_backup_v1", sync: false, row: "", merge: "", cap: WHY.sync,
      why: "合并冲突前留的快照 —— 「保住本机那一份」用的后悔药。"
    },
    {
      key: "poem_exam_v1", sync: false, row: "", merge: "", cap: WHY.device,
      why: "考试层的练习记录（卷面得分，本机一份）。**明确不上云**（§4.66 ⑥）：" +
           "它是「这台设备自测过几次」，不是「这个账号学到哪」；" +
           "答错也不回流到每日复习计划 —— 批改权只能归 js/scheduler.js，" +
           "游戏层不许自己写等级（§4.15 ④）。"
    },
    {
      key: "poem_sound_v1", sync: false, row: "", merge: "", cap: WHY.device,
      why: "答题音效开关（飞花令 / 考试类题型），跟设备走，不跟账号走 —— " +
           "同一个人换一台没插耳机的设备，不该被迫继承「静音」这条偏好。"
    },
    {
      key: "poem_plan_", sync: false, row: "", merge: "", cap: WHY.trans,
      why: "今日计划在 **sessionStorage** 里的缓存（`poem_plan_<日期>_<年级>…`）：" +
           "它是一份**算出来的**结果，不是数据 —— 换台设备重算一次就有，推上去纯属浪费。" +
           "本机内容变了就删掉重算（键里带着年级 / 范围 / 数量 / 集合 / 算法那几个维度）。"
    },
    {
      key: "poem_classic_words_", sync: false, row: "", merge: "", cap: WHY.device,
      why: "集子「生词表」的版本号（`poem_classic_words_<版本>` = \"1\"）：" +
           "它记的是「这台设备看过哪一版生词表」，属于设备缓存，与学到哪无关。"
    },
    {
      key: "poem_auth_v1", sync: false, row: "", merge: "", cap: WHY.account,
      why: "本机会话（服务端签发，本机只存一份凭据）。"
    },
    {
      key: "poem_plan_v1", sync: false, row: "", merge: "", cap: WHY.account,
      why: "本机会话里的层级 / 角色缓存 —— 权威答案在 /api/me（数据库里那两列）。"
    },
    {
      key: "poem_plan_seen_v1", sync: false, row: "", merge: "", cap: WHY.account,
      why: "上面那一份答案的**水位线**（`uid::until`，Issue #274）：回答「这一份" +
           "是不是本机刚问来的」。它按**浏览器**记、不按账号记，跟着那份答案一起" +
           "写一起清 —— 上云的话就是把「这台机器问过谁」传出去了，既没意义也越界。"
    },
    {
      key: "poem_plan_notice_v1", sync: false, row: "", merge: "", cap: WHY.account,
      why: "待显示的「账号已升级」提醒（本机上一份服务端答案比这一份低时留下，看过即删）。" +
           "按设备记：每台设备各提醒一次，上云反而会让一台看过、别的设备都不再提醒。"
    },
    {
      key: "poem_reports_seen_v1", sync: false, row: "", merge: "", cap: WHY.account,
      why: "「我的报告」有进展提醒的水位线（时间戳，同 poem_plan_seen_v1 一种做法）：" +
           "打开那一页即视为看过。按设备记，不上云——上云会让一台看过、别的设备都不再提醒。"
    },
    {
      key: "poem_feedback_seen_v1", sync: false, row: "", merge: "", cap: WHY.account,
      why: "「意见反馈」有回复提醒的水位线，与上面那把键同一条理由。"
    }
  ];

  function table() { return ROWS.slice(); }

  function row(key) {
    var k = String(key == null ? "" : key);
    for (var i = 0; i < ROWS.length; i++) {
      if (ROWS[i].key === k) return ROWS[i];
    }
    return null;
  }

  function known(key) { return !!row(key); }

  function synced(key) {
    var r = row(key);
    return !!(r && r.sync);
  }

  function syncedKeys() {
    return ROWS.filter(function (r) { return r.sync; }).map(function (r) { return r.key; });
  }

  function localKeys() {
    return ROWS.filter(function (r) { return !r.sync; }).map(function (r) { return r.key; });
  }

  window.SyncCoverage = {
    WHY: WHY,
    rows: table,
    row: row,
    known: known,
    synced: synced,
    syncedKeys: syncedKeys,
    localKeys: localKeys
  };
})();

if (typeof module === "object" && module.exports) module.exports = (typeof window !== "undefined" ? window.SyncCoverage : null);
