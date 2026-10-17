const corpus = require("../../utils/corpus");
const store = require("../../utils/store");
const S = require("../../utils/scheduler");
const cols = require("../../utils/collections");
const entitlement = require("../../utils/entitlement");
const sync = require("../../utils/sync");
const gate = require("../../utils/gate");
const tabbar = require("../../utils/tabbar");
const theme = require("../../utils/theme");
const tabPage = require("../../utils/tab-page");
const nav = require("../../utils/nav");
const LUNAR = require("../../utils/lunar");

const REASON_TEXT = { review: "复习", new: "新学", extra: "补充", pinned: "今日加背" };

const REASON_CLS = { review: "theme", new: "theme", pinned: "theme" };

const SOURCE_TEXT = { course: "课内", own: "自选" };

const HERO_RATIO = 916 / 1717;

function windowWidth() {
  const read = (fn) => {
    try {
      return Number(fn().windowWidth) || 0;
    } catch (e) {
      return 0;
    }
  };
  return (wx.getWindowInfo && read(wx.getWindowInfo))
    || read(wx.getSystemInfoSync)
    || 375;
}

function bannerBox() {
  const box = nav.top();
  return {
    statusBarHeight: box.statusBarHeight,
    navHeight: box.navHeight,
    navBottom: box.navBottom,
    bannerHeight: box.statusBarHeight + box.navHeight
      + Math.round(windowWidth() * HERO_RATIO)
  };
}

function reasonCls(key) {
  return REASON_CLS[key] || "ghost";
}

function stateText(recited, read) {
  if (recited) return "已背";
  return read ? "未背" : "未读";
}

function stateCls(recited) {
  return recited ? "on" : "idle";
}

function sourceKey(id) {
  const meta = corpus.indexById(id);
  return meta && meta.b === "poems" ? "course" : "own";
}

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

function pad(n) {
  return n < 10 ? "0" + n : "" + n;
}

function todayLabel() {
  const d = new Date();
  const lunar = LUNAR.label(d);
  const solar = pad(d.getFullYear() % 100) + "年" + pad(d.getMonth() + 1) + "月" + pad(d.getDate()) + "日";
  return [solar].concat(lunar ? [lunar] : [], [WEEKDAYS[d.getDay()]]).join(" · ");
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
  const recs = store.reads();
  const read = {};
  Object.keys(recs).forEach((b) => {
    Object.keys(recs[b] || {}).forEach((id) => { read[id] = true; });
  });
  return list.map((p, i) => {
    const rec = records[p.id] || null;
    return {
      id: p.id,
      seq: i + 1,
      title: p.t,
      author: p.a,
      dynasty: p.d,
      place: scope.random ? S.gradeName(p.gr) + S.termName(p.tm) : "",
      stage: S.isLearned(rec) ? S.stageName(rec) : "未学过",
      read: !!read[p.id],
      recited: S.isLearned(rec),
      source: SOURCE_TEXT[sourceKey(p.id)]
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
    barBelow: true,

    statusBarHeight: 0,
    navHeight: 0,
    navBottom: 0,
    bannerHeight: 0,

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

    collections: [],
    collectionCount: 0,
    collectionHint: "",
    collectionOn: false,

    todayLabel: "",

    stats: { today: 0, done: 0, left: 0 },

    extraKeyword: "",

    loading: true
  },

  onLoad() {
    this.setData(bannerBox());
  },

  onShow() {
    theme.apply(this);

    this.setData({ todayLabel: todayLabel(), barBelow: !tabbar.sync(this, 0) });
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

    const selfOnly = cols.selfOnlyOn();

    const plan = S.generateDailyPlan({
      grade: view.grade,
      term: view.term,
      count: settings.dailyCount,
      scope: view.scope,
      allPoems: all,
      selfOnly: selfOnly,

      extraPoems: store.dailyExtraPoems(),
      getRecord: store.getRecord
    });

    const allList = selfOnly ? [] : scopeList(all, view, scope);
    const allMode = this.data.allOpen || this.sheetSource === "all";
    const allRows = allMode ? rowsOfScope(allList, scope) : [];
    const sheetRows = this.collectionId ? this.collectionSheetRows(this.collectionId) : [];

    const readOf = this.readOf();

    let done = 0;
    const rows = plan.map((it, i) => {
      const rec = store.getRecord(it.poem.id);
      const read = readOf(it.poem.id);
      const recited = S.isLearned(rec);
      if (recited) done += 1;
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
        read,
        recited,
        stateText: stateText(recited, read),
        stateCls: stateCls(recited),
        source: SOURCE_TEXT[sourceKey(it.poem.id)]
      };
    });

    const total = rows.length;
    const colRows = this.collectionRows();
    const selfTotal = colRows.reduce((n, c) => n + c.planned, 0);
    const selfDone = colRows.reduce((n, c) => n + c.done, 0);

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
      stats: {
        today: total + selfTotal,
        done: done + selfDone,
        self: selfTotal,
        selfDone: selfDone,
        left: Math.max(0, total - done)
      },
      allCount: allList.length,
      allLabel: scopeLabel(scope),
      allRows: this.data.allOpen ? allRows : [],
      sheetRows: this.collectionId ? sheetRows : (this.sheetSource === "all" ? allRows : rows),
      selfOnly: selfOnly,
      collections: colRows,
      collectionCount: colRows.length,
      collectionOn: entitlement.can("collections"),
      collectionHint: entitlement.can("collections") ? "" : entitlement.hint("collections"),
      loading: false
    });
  },

  collectionRows() {
    const all = corpus.course();
    return cols.list().map((c) => {
      const plan = S.collectionPlan(c, {
        count: cols.countOf(c),
        allPoems: all,
        getRecord: store.getRecord
      });
      const seen = store.progress();
      let done = 0;
      plan.forEach((it) => {
        if (S.isLearned(seen[it.poem.id])) done += 1;
      });
      return {
        id: c.id,
        title: cols.nameOf(c),
        count: c.items.length,
        planned: plan.length,
        done: done,
        rows: this.collectionCardRows(plan)
      };
    });
  },

  collectionCardRows(plan) {
    const readOf = this.readOf();
    return plan.map((it, i) => this.poemRow(it.poem, i, it.reason, readOf));
  },

  readOf() {
    const reads = {};
    return (id) => {
      const meta = corpus.indexById(id);
      const book = (meta && meta.b) || "poems";
      if (!reads[book]) reads[book] = store.reads(book);
      return !!reads[book][id];
    };
  },

  poemRow(p, i, reason, readOf) {
    const rec = store.getRecord(p.id);
    const stage = S.stageName(rec) || "";
    const read = readOf(p.id);
    const recited = S.isLearned(rec);
    return {
      id: p.id,
      seq: i + 1,
      title: p.t,
      author: p.a,
      dynasty: p.d,
      reason: REASON_TEXT[reason] || "",
      reasonKey: reason || "",
      tagCls: reasonCls(reason),
      stage: stage === REASON_TEXT[reason] ? "" : stage,
      mastery: S.mastery(rec),
      read: read,
      recited: recited,
      stateText: stateText(recited, read),
      stateCls: stateCls(recited),
      source: SOURCE_TEXT[sourceKey(p.id)]
    };
  },

  collectionPlanOf(id) {
    const c = cols.find(id);
    if (!c) return null;
    return S.collectionPlan(c, {
      count: cols.countOf(c),
      allPoems: corpus.course(),
      getRecord: store.getRecord
    });
  },

  collectionSheetRows(id) {
    const plan = this.collectionPlanOf(id);
    if (!plan) return [];
    const reasonOf = {};
    plan.forEach((it) => { reasonOf[it.poem.id] = it.reason; });
    const rest = cols.idsOf(cols.find(id))
      .filter((pid) => !reasonOf[pid])
      .map((pid) => corpus.indexById(pid))
      .filter(Boolean);
    const readOf = this.readOf();
    return plan.map((it) => it.poem).concat(rest)
      .map((p, i) => this.poemRow(p, i, reasonOf[p.id], readOf));
  },

  onOpenCollection(e) {
    const ds = e.currentTarget.dataset;
    gate.guard("自选背诵", () => {
      if (!entitlement.block("collections", { page: this })) return;
      const sheet = this.selectComponent("#sheet");
      if (!sheet) return;
      const rows = this.collectionSheetRows(ds.coll);
      if (!rows.length) {
        wx.showToast({ title: "这个集合还是空的", icon: "none" });
        return;
      }
      this.collectionId = ds.coll;
      this.setData({ sheetRows: rows });
      sheet.open(rows, ds.id);
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
      this.collectionId = "";
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

    const box = this.selectComponent("#extra");
    if (box) this.syncExtraKeyword(box);
  },

  onExtraInput(e) {
    this.searchExtra((e && e.detail && e.detail.value) || "");
  },

  onExtraSearch(e) {
    const typed = e && e.detail && e.detail.value;
    this.searchExtra(typed === undefined ? this.data.extraKeyword : typed, true);
  },

  onExtraClear() {
    this.searchExtra("", true);
  },

  searchExtra(keyword, paint) {
    this.setData({ extraKeyword: keyword });

    const box = this.selectComponent("#extra");
    if (!box) return;
    if (paint) box.onSearch(keyword);
    else box.onInput({ detail: { value: keyword } });
  },

  onSheetFinish() {
    this.collectionId = "";
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
