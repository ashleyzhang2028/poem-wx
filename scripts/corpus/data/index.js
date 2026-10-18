(function () {
  const groups = [
    window.POEMS_1, window.POEMS_2, window.POEMS_3, window.POEMS_4,
    window.POEMS_5, window.POEMS_6, window.POEMS_7, window.POEMS_8,
    window.POEMS_9, window.POEMS_10, window.POEMS_11, window.POEMS_12
  ];
  const all = [];
  groups.forEach(function (g, i) {
    (g || []).forEach(function (raw) {

      var p = (typeof window.masterTextOf === "function")
        ? window.masterTextOf(raw, "poems") : raw;
      p.grade = i + 1;
      all.push(p);
    });
  });
  window.POEMS_ALL = all;

  window.GRADE_NAMES = {
    1: "一年级", 2: "二年级", 3: "三年级", 4: "四年级",
    5: "五年级", 6: "六年级", 7: "七年级", 8: "八年级",
    9: "九年级", 10: "高一", 11: "高二", 12: "高三"
  };

  window.PRIMARY_GRADES = [1, 2, 3, 4, 5, 6];
  window.MIDDLE_GRADES = [7, 8, 9];
  window.HIGH_GRADES = [10, 11, 12];

  window.getPoemsByGradeTerm = function (grade, term) {
    return window.POEMS_ALL.filter(function (p) {
      return p.grade === Number(grade) && p.term === Number(term);
    });
  };

  window.TRANSLATION_SOURCES = {
    "academic": "依据《唐诗鉴赏辞典》《宋词鉴赏辞典》等工具书的通行讲法",
    "school": "依据统编版教材与教师用书课后释义",
    "public-domain": "原文属公有领域，依据公认注本与通行译注",
    "modern": "依据现行通用选本与通行讲法"
  };

  window.translationSourceText = function (p) {
    if (!p) return "";
    return window.TRANSLATION_SOURCES[p.translationSource] || "";
  };
})();
