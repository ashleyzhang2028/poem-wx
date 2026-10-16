const corpus = require("../../utils/corpus");
const store = require("../../utils/store");
const S = require("../../utils/scheduler");
const sync = require("../../utils/sync");
const gate = require("../../utils/gate");
const tabbar = require("../../utils/tabbar");
const theme = require("../../utils/theme");
const tabPage = require("../../utils/tab-page");

const REASON_TEXT = { review: "复习", new: "新学", extra: "补充", pinned: "今日加背" };

const REASON_CLS = { review: "theme", new: "theme", pinned: "theme" };

function reasonCls(key) {
  return REASON_CLS[key] || "ghost";
}

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

const CN_NUM = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];

function cnDay(n) {
  if (n <= 10) return CN_NUM[n];
  if (n < 20) return "十" + (n % 10 ? CN_NUM[n % 10] : "");
  return CN_NUM[Math.floor(n / 10)] + "十" + (n % 10 ? CN_NUM[n % 10] : "");
}

function todayLabel() {
  const d = new Date();
  return CN_NUM[d.getMonth() + 1] + "月" + cnDay(d.getDate()) + "日 · " + WEEKDAYS[d.getDay()];
}

function scopeList(all, view, scope) {
  return S.poolForScope({
    grade: view.grade,
    term: view.term,
    scope: view.scope,
    allPoems: all
  }).slice().sort((a, b) => (a.gr - b.gr) || (a.tm - b.tm));
}

function scopeLabel(scope) {
  return scope.scopeName + "全部诗词";
}

function rowsOfScope(list, scope) {
  const records = store.progress();
  return list.map((p, i) => {
    const rec = records[p.id] || null;
    return {
      id: p.id,
      seq: i + 1,
      title: p.t,
      author: p.a,
      dynasty: p.d,
      place: scope.random ? S.gradeName(p.gr) + S.termName(p.tm) : "",
      stage: S.isLearned(rec) ? S.stageName(rec) : "未学过"
    };
  });
}

function guestCatalog() {
  const all = corpus.course().filter((p) => p.gr === gate.GUEST_GRADE);
  const catalog = all.map((p, i) => ({
    id: p.id,
    title: p.t,
    author: p.a,
    dynasty: p.d,
    seq: i + 1
  }));
  return {
    logged: false,
    guest: true,
    gradeName: S.gradeName(gate.GUEST_GRADE),
    termName: "",
    scopeName: "一年级上下册",
    plan: [],
    total: 0,
    doneCount: 0,
    percent: 0,
    catalog,
    catalogCount: catalog.length,
    catalogLead: catalog.length ? "" : "这一版没带上语料",
    catalogMiss: catalog.length
      ? ""
      : "语料是本仓库的一部分。在项目目录跑 npm run build:data，"
        + "再在开发者工具里点「编译」（不是「刷新」）",
    stats: { today: 0, done: 0, left: 0 },
    loading: false
  };
}

Page({
  data: {

    themeStyle: "",

    logged: false,
    guest: false,
    gradeName: "",
    termName: "",
    scopeName: "",
    plan: [],
    doneCount: 0,
    total: 0,
    percent: 0,

    catalog: [],
    catalogCount: 0,
    catalogLead: "",
    catalogMiss: "",

    allRows: [],
    allCount: 0,
    allLabel: "",
    allOpen: false,

    sheetRows: [],

    todayLabel: "",

    stats: { today: 0, done: 0, left: 0 },

    loading: true
  },

  onShow() {
    theme.apply(this);

    tabbar.sync(this, 0);
    this.setData({ todayLabel: todayLabel() });
    this.refresh();

    if (gate.logged()) sync.now().catch(() => {});
  },

  refresh() {
    if (!gate.logged()) {
      this.setData(guestCatalog());
      return;
    }

    const settings = store.settings();
    const all = corpus.course();

    const view = { grade: settings.grade, term: settings.term, scope: settings.scope };
    const scope = S.scopeOf(view.scope);

    const plan = S.generateDailyPlan({
      grade: view.grade,
      term: view.term,
      count: settings.dailyCount,
      scope: view.scope,
      allPoems: all,

      extraPoems: store.dailyExtraPoems(),
      getRecord: store.getRecord
    });

    const allList = scopeList(all, view, scope);
    const allMode = this.data.allOpen || this.sheetSource === "all";
    const allRows = allMode ? rowsOfScope(allList, scope) : [];

    const reads = {};
    const readOf = (id) => {
      const meta = corpus.indexById(id);
      const book = (meta && meta.b) || "poems";
      if (!reads[book]) reads[book] = store.reads(book);
      return !!reads[book][id];
    };

    let done = 0;
    const rows = plan.map((it, i) => {
      const rec = store.getRecord(it.poem.id);
      const read = readOf(it.poem.id);
      if (read) done += 1;
      return {
        id: it.poem.id,
        seq: i + 1,
        title: it.poem.t,
        author: it.poem.a,
        dynasty: it.poem.d,
        reason: REASON_TEXT[it.reason] || "",
        reasonKey: it.reason,
        tagCls: reasonCls(it.reason),

        stage: S.stageName(rec) === REASON_TEXT[it.reason] ? "" : S.stageName(rec),
        mastery: S.mastery(rec),
        read
      };
    });

    const total = rows.length;
    this.setData({
      logged: true,
      guest: false,
      gradeName: S.gradeName(settings.grade) + S.termName(settings.term),
      termName: S.termName(settings.term),
      scopeName: S.scopeOf(settings.scope).scopeName,
      plan: rows,
      doneCount: done,
      total,
      percent: total ? Math.round((done / total) * 100) : 0,
      stats: { today: total, done, left: Math.max(0, total - done) },
      allCount: allList.length,
      allLabel: scopeLabel(scope),
      allRows: this.data.allOpen ? allRows : [],
      sheetRows: this.sheetSource === "all" ? allRows : rows,
      loading: false
    });
  },

  scopeRows() {
    const settings = store.settings();
    const view = { grade: settings.grade, term: settings.term, scope: settings.scope };
    const scope = S.scopeOf(view.scope);
    return rowsOfScope(scopeList(corpus.course(), view, scope), scope);
  },

  onOpen(e) {
    this.openSheet(e.currentTarget.dataset.id, "plan");
  },

  onOpenAll(e) {
    this.openSheet(e.currentTarget.dataset.id, "all");
  },

  openSheet(id, source) {
    gate.guard("背诵", () => {
      const sheet = this.selectComponent("#sheet");
      if (!sheet) return;
      this.sheetSource = source;
      const rows = source === "all" ? this.scopeRows() : this.data.plan;
      const patch = { sheetRows: rows };
      if (source === "all") patch.allRows = rows;
      this.setData(patch);
      sheet.open(rows, id);
    });
  },

  onToggleAll() {
    const open = !this.data.allOpen;
    this.setData({ allOpen: open, allRows: open ? this.scopeRows() : [] });
  },

  onSheetOpen() {
    this.refresh();
  },

  onExtraChange() {
    this.refresh();
  },

  onExtraInput(e) {
    const box = this.selectComponent("#extra");
    if (box) box.onInput(e);

    this.setData({
      extraKeyword: (e && e.detail && e.detail.value) || "",
      extraRows: (box && box.data && box.data.rows) || []
    });
  },

  onSheetFinish() {
    this.refresh();
  },

  onSettings() {
    if (!gate.guard("背诵设置")) return;
    wx.navigateTo({ url: "/packages/settings/recite/recite" });
  },

  onLogin() {
    tabPage.mine();
  },

  onPullDownRefresh() {
    this.refresh();
    setTimeout(() => wx.stopPullDownRefresh(), 320);
  },

  onShareAppMessage() {

    return { title: "跬步 · 每天背一首古诗文", path: "/pages/home/home" };
  },

  onShareTimeline() {
    return { title: "跬步 · 每天背一首古诗文" };
  }
});
