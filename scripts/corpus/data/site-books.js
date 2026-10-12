(function () {
  "use strict";

  var BOOKS = [
    { id: "poems", name: "课内诗词", page: "/", varName: "POEMS_ALL", unit: "首" },
    { id: "classic", name: "古文", page: "/classic/", varName: "POEMS_CLASSIC", unit: "篇" },
    { id: "yuefu", name: "乐府集", page: "/yuefu/", varName: "POEMS_YUEFU", unit: "首" },
    { id: "tangshi", name: "唐诗", page: "/tangshi/", varName: "POEMS_TANGSHI", unit: "首" },
    /* Issue #461：唐诗集只收唐（317 首 dynasty 全「唐」，保选本原貌）；
       先秦 / 汉魏六朝 / 宋 / 元明清的「非唐古诗」另立一部《古诗「非唐代」》。
       同轮裁决：《唐诗三百首》→《唐诗》、《宋词三百首》→《词》、《元曲三百首》→《曲》，
       id 一律不动（保全站引用与本地进度不断链）。 */
    { id: "gushi", name: "古诗「非唐代」", page: "/gushi/", varName: "POEMS_GUSHI", unit: "首" },
    { id: "songci", name: "词", page: "/songci/", varName: "POEMS_SONGCI", unit: "首" },
    { id: "yuanqu", name: "曲", page: "/yuanqu/", varName: "POEMS_YUANQU", unit: "首" },
    { id: "guwen", name: "古文观止", page: "/guwen/", varName: "POEMS_GUWEN", unit: "篇" },
    { id: "jinxiandai", name: "近现代诗词", page: "/jinxiandai/", varName: "POEMS_JINXIANDAI", unit: "首" },
    { id: "zhaoming", name: "昭明文选", page: "/zhaoming/", varName: "POEMS_ZHAOMING", unit: "篇" },
    { id: "chengyu", name: "中华成语故事", page: "/chengyu/", varName: "POEMS_CHENGYU", unit: "则" },
    { id: "changshi", name: "文学常识", page: "/changshi/", varName: "POEMS_CHANGSHI", unit: "条" },
    { id: "mingshu", name: "名著导读", page: "/mingshu/", varName: "POEMS_MINGSHU", unit: "部" },
    /* Issue #399：历代名家拆两部（中国 / 外国），两部都是独立集子。 */
    { id: "mingren", name: "名家「中国」", page: "/mingren/", varName: "POEMS_MINGREN_CN", unit: "家" },
    { id: "mingren-waiguo", name: "名家「外国」", page: "/mingren-waiguo/", varName: "POEMS_MINGREN_FOREIGN", unit: "家", refPrefix: "mingren", file: "poems-mingren-foreign" },
    /* Issue #407：帝王两卷 —— 中国卷自夏至清末，外国卷覆盖教科书点名的各国君主。 */
    { id: "dwang", name: "帝王「中国」", page: "/dwang/", varName: "POEMS_EMPEROR_CN", unit: "位", file: "poems-emperor-cn" },
    { id: "dwang-waiguo", name: "帝王「外国」", page: "/dwang-waiguo/", varName: "POEMS_EMPEROR_FOREIGN", unit: "位", refPrefix: "dwang", file: "poems-emperor-waiguo" }
  ];

  window.SITE_BOOKS_DEF = BOOKS;
  window.SITE_BOOKS = BOOKS.map(function (b) {
    return { id: b.id, name: b.name, page: b.page, unit: b.unit };
  });
})();
