(function () {
  "use strict";

  var BOOKS = (typeof window !== "undefined" && window.SITE_BOOKS_DEF) || [];
  if (!BOOKS.length) throw new Error("data/site-books.js 必须先于 data/site-index.js 加载");

  function buildSiteIndex(extra) {
    var opt = extra || {};
    var out = [];

    BOOKS.forEach(function (b) {
      var list = opt[b.id] || (typeof window !== "undefined" ? window[b.varName] : null);
      if (!list || !list.length) return;
      list.forEach(function (raw) {

        var p = (typeof window.masterTextOf === "function")
          ? window.masterTextOf(raw, b.id) : raw;

        var NEED_TRANS = ["guwen", "yuanqu", "zhaoming", "yuefu", "jinxiandai", "chengyu", "gushi"];
        if (NEED_TRANS.indexOf(b.id) >= 0 && (!p.text || !p.translation)) return;
                if ((b.id === "changshi" || b.id === "mingshu" || b.id === "mingren" || b.id === "mingren-waiguo" ||
                     b.id === "dwang" || b.id === "dwang-waiguo") && !p.text) return;
        out.push({
          /* Issue #399：历代名家拆两部 —— 两卷是两部集子（book 不同），
             但同属「历代名家」这一族，台账 id 前缀共用 `mingren`
             （`refPrefix` 显式给；不给就用自己的 id）。 */
          id: (b.refPrefix || b.id) + "-" + p.id,
          originId: p.id,
          title: p.title,
          author: p.author || "",

          authorName: p.authorName || "",
          dynasty: p.dynasty || "",
          source: p.source || "",

          selection: p.selection || "",
          meaning: p.meaning || "",
          gloss: p.gloss || "",
          grade: p.grade,
          term: p.term,
          gradeGroup: p.gradeGroup || "",
          /* 题名异写（「又名 xxxx」）：只有少数篇目有，阅读器标题底下取用。
             没有就是 undefined，判定处一律用真值判断，不设空数组。 */
          aliases: p.aliases || null,
          text: p.text || "",
          translation: p.translation || "",
          translationSource: p.translationSource,
          book: b.id,
          bookName: b.name,
          page: b.page
        });
      });

      out.push({
        id: b.id + "-__book__",
        title: b.name,
        author: "",
        dynasty: "",
        source: b.name + "（共 " + list.length + " " + b.unit + "）",
        text: "",
        translation: "",
        book: b.id,
        bookName: b.name,
        page: b.page,
        isBook: true
      });
    });

    return out;
  }

  window.buildSiteIndex = buildSiteIndex;

  window.SITE_INDEX = buildSiteIndex();
})();
