(function () {
  "use strict";

  var GROUPS = {

    classic: [
      "蒙学经典", "寓言故事", "神话传说", "人物故事",
      "志人逸事", "治学勤读", "山水游记", "诸子论道"
    ],

    tangshi: [
      "卷一 五言古诗", "卷二 七言古诗", "卷三 五言乐府", "卷四 七言乐府",
      "卷五 五言律诗", "卷六 七言律诗", "卷七 五言绝句", "卷八 七言绝句"
    ],

    gushi: window.GUSHI_GROUP_ORDER || null,

    yuefu: window.YUEFU_GROUP_ORDER || null,

    songci: window.SONGCI_GROUP_ORDER || null,

    guwen: [
      "卷一 周文", "卷二 周文", "卷三 周文", "卷四 秦文",
      "卷五 汉文", "卷六 汉文", "卷七 六朝唐文", "卷八 唐文",
      "卷九 唐宋文", "卷十 宋文", "卷十一 宋文", "卷十二 明文"
    ],

    zhaoming: window.ZHAOMING_GROUP_ORDER || null,

    yuefu: window.YUEFU_GROUP_ORDER || null,

    yuanqu: window.YUANQU_GROUP_ORDER || null,

    jinxiandai: window.JINXIANDAI_GROUP_ORDER || null,

    chengyu: window.CHENGYU_GROUP_ORDER || null,

    changshi: window.CHANGSHI_GROUP_ORDER || null,

    mingshu: window.MINGSHU_GROUP_ORDER || null,

    mingren: window.MINGREN_GROUP_ORDER || null,
    "mingren-waiguo": window.MINGREN_GROUP_ORDER || null,

    dwang: window.DWANG_GROUP_ORDER || null,
    "dwang-waiguo": window.DWANG_WAIGUO_GROUP_ORDER || null
  };

  window.GROUP_ORDER = GROUPS;

  window.groupOrderOf = function (bookId) {
    var v = GROUPS[bookId];
    return Array.isArray(v) ? v.slice() : [];
  };
})();
