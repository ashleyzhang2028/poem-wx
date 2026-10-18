const corpus = require("../../utils/corpus");
const store = require("../../utils/store");
const S = require("../../utils/scheduler");
const R = require("../../utils/review-models");
const cols = require("../../utils/collections");
const entitlement = require("../../utils/entitlement");
const sync = require("../../utils/sync");
const gate = require("../../utils/gate");
const loginFlow = require("../../utils/login-flow");
const tabbar = require("../../utils/tabbar");
const theme = require("../../utils/theme");
const nav = require("../../utils/nav");
const LUNAR = require("../../utils/lunar");
const seasonal = require("../../utils/seasonal");
const sfx = require("../../utils/sfx");
const quotes = require("../../utils/finish-quote");
const icons = require("../../utils/icons");

const REASON_TEXT = { review: "复习", new: "新学", extra: "补充", pinned: "加背" };

const SELF_CHEERS = {
  self: "自选的今日份也背完了",
  all: "课内和自选，今天的份都背完了"
};

const TOAST_GAP = 2400;

const TOAST_MS = 2200;

const REASON_CLS = { review: "theme", new: "theme", pinned: "theme" };

const SOURCE_TEXT = { course: "课内", own: "自选" };

const FACES = [
  { key: "bad", icon: icons.frown, cls: "bad", label: "忘记" },
  { key: "fuzzy", icon: icons.meh, cls: "fuzzy", label: "模糊" },
  { key: "good", icon: icons.smile, cls: "good", label: "记住" }
];

const PAGE_ICONS = {
  search: icons.search,
  clear: icons.clear,
  checked: icons.added,
  add: icons.add,
  added: icons.added,
  playlist: icons.playlist,
  refresh: icons.refresh
};

function datasetOf(e) {
  const box = {};
  let node = e && e.currentTarget;
  while (node) {
    const ds = node.dataset || {};
    Object.keys(ds).forEach((k) => { if (box[k] === undefined) box[k] = ds[k]; });
    node = node.parentNode;
  }
  return box;
}

function praiseOf(scope) {
  return quotes.pick(Date.now() / R.DAY, scope);
}

const HERO_RATIO = 916 / 1717;

const BANNER_MAX_H = 360;

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
      + Math.min(Math.round(windowWidth() * HERO_RATIO), BANNER_MAX_H)
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

function pickedToday(rec) {
  if (!R.reviewedToday(rec, Date.now())) return "";
  const last = (rec.history || [])[rec.history.length - 1];
  return (last && last.result) || "";
}

function sourceKey(id) {
  const meta = corpus.indexById(id);
  return meta && meta.b === "poems" ? "course" : "own";
}

function sourceBook(id) {
  const meta = corpus.indexById(id);
  return (meta && meta.b) || "poems";
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
      stateText: stateText(S.isLearned(rec), !!read[p.id]),
      stateCls: stateCls(S.isLearned(rec)),
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
    stats: { today: 0, done: 0, left: 0, extra: 0 },
    coursePlan: [],
    courseBase: 0,
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

    seasonal: null,
    seasonalOn: false,

    stats: { today: 0, done: 0, left: 0, extra: 0 },
    coursePlan: [],
    courseBase: 0,
    faces: FACES,
    icons: PAGE_ICONS,
    baseCount: 0,
    allDone: false,
    praise: "",

    extraKeyword: "",

    loading: true
  },

  onLoad() {
    this.setData(bannerBox());
  },

  onShow() {
    theme.apply(this);
    this.toasted = false;

    const bar = tabbar.sync(this, 0);
    if (bar) tabbar.show(this);
    this.setData({ todayLabel: todayLabel(), barBelow: !bar });
    this.refresh();

    if (gate.logged()) sync.now().catch(() => {});
  },

  refresh() {
    if (!gate.logged()) {
      this.setData(Object.assign(guestCatalog(), { seasonal: this.seasonalCard() }));
      return;
    }

    const settings = store.settings();
    const all = corpus.course();

    const view = { grade: settings.grade, term: settings.term, scope: settings.scope };
    const scope = S.scopeOf(view.scope);

    const selfOnly = cols.selfOnlyOn();

    const planOpt = {
      grade: view.grade,
      term: view.term,
      count: settings.dailyCount,
      scope: view.scope,
      allPoems: all,

      extraPoems: store.dailyExtraPoems(),
      getRecord: store.getRecord
    };

    const plan = S.generateDailyPlan(Object.assign({ selfOnly: selfOnly }, planOpt));

    const coursePlan = selfOnly ? S.generateDailyPlan(planOpt) : [];
    const courseRecorded = selfOnly
      ? store.dayPlan(S.coursePlanKeyOf(planOpt)).ids.length
      : 0;

    const allList = selfOnly ? [] : scopeList(all, view, scope);
    const allMode = this.data.allOpen || this.sheetSource === "all";
    const allRows = allMode ? rowsOfScope(allList, scope) : [];
    const sheetRows = this.sheetRowsOf(this.data.plan);

    const readOf = this.readOf();
    const recorded = store.dayPlan(S.planKeyOf({
      grade: view.grade,
      term: view.term,
      scope: view.scope,
      count: settings.dailyCount
    })).ids.length;
    let done = 0;
    const extraOf = plan.filter((it) => it.reason === "pinned").length;
    const base = Math.max(recorded, plan.length - extraOf);
    const rows = plan.map((it, i) => {
      const rec = store.getRecord(it.poem.id);
      const read = readOf(it.poem.id);
      const recited = S.isLearned(rec);
      if (recited && i < base) done += 1;
      return {
        id: it.poem.id,
        seq: i + 1,
        title: it.poem.t,
        author: it.poem.a,
        dynasty: it.poem.d,
        reason: REASON_TEXT[it.reason] || "",
        tagCls: reasonCls(it.reason),

        stage: S.stageName(rec) === REASON_TEXT[it.reason] ? "" : S.stageName(rec),
        mastery: S.mastery(rec),
        picked: pickedToday(rec),
        read,
        recited,
        stateText: stateText(recited, read),
        stateCls: stateCls(recited),
        source: SOURCE_TEXT[sourceKey(it.poem.id)]
      };
    });

    const total = rows.length;
    const allDone = base > 0 && done >= base;
    const colRows = this.collectionRows();
    const selfTotal = colRows.reduce((n, c) => n + c.planned, 0);
    const selfDone = colRows.reduce((n, c) => n + c.done, 0);
    const selfToday = colRows.reduce((n, c) => n + c.doneNow, 0);
    const selfAllDone = selfTotal > 0 && selfToday >= selfTotal;
    const cheerKey = selfAllDone && allDone ? "all" : selfAllDone ? "self" : "";

    this.setData({
      logged: true,
      guest: false,
      gradeName: S.gradeName(settings.grade) + S.termName(settings.term),
      termName: S.termName(settings.term),
      scopeName: S.scopeOf(settings.scope).scopeName,
      plan: rows,
      doneCount: done,
      total,
      baseCount: base,
      allDone: allDone,
      praise: allDone ? praiseOf("course") : "",
      percent: base ? Math.round((done / base) * 100) : 0,
      stats: {
        today: selfOnly ? selfTotal : total,
        done: selfOnly ? selfDone : done,
        left: selfOnly ? Math.max(selfTotal - selfDone, 0) : Math.max(total - done, 0),
        extra: extraOf
      },
      coursePlan: selfOnly ? coursePlan.filter((it) => it.reason !== "pinned").map((it, i) => this.poemRow(it.poem, i, it.reason, readOf)) : [],
      courseBase: selfOnly ? Math.max(courseRecorded, coursePlan.length - coursePlan.filter((it) => it.reason === "pinned").length) : 0,
      cheers: cheerKey ? [SELF_CHEERS[cheerKey]] : [],
      allCount: allList.length,
      allLabel: scopeLabel(scope),
      allRows: this.data.allOpen ? allRows : [],
      sheetRows: sheetRows,
      selfOnly: selfOnly,
      selfPraise: selfAllDone ? praiseOf("own") : "",
      collections: colRows,
      collectionCount: colRows.length,
      collectionOn: entitlement.can("collections"),
      collectionHint: entitlement.can("collections") ? "" : entitlement.hint("collections"),
      seasonal: this.seasonalCard(),
      loading: false
    });

    this.cheerCollection(colRows);
  },

  seasonalCard() {
    const card = seasonal.card();
    if (!card) return null;
    const readOf = this.readOf();
    const extra = store.dailyExtra();
    return Object.assign({}, card, {
      rows: card.poems.map((p, i) => Object.assign(this.poemRow(p, i, "", readOf), {
        daily: extra.indexOf(p.id) >= 0
      }))
    });
  },

  onSeasonalRefresh(e) {
    if (!seasonal.redraw()) return;
    const card = this.seasonalCard();
    if (card) this.setData({ seasonal: card });
  },

  seasonalRows() {
    const card = this.data.seasonal;
    return card ? card.rows : [];
  },

  openSeasonal() {
    const rows = this.seasonalRows();
    if (!rows.length) return;
    const sheet = this.selectComponent("#sheet");
    if (!sheet) return;
    this.sheetSource = "seasonal";
    this.collectionId = "";
    this.setData({ sheetRows: rows });
    sheet.open(rows, rows[0].id);
    this.attachSeasonal(rows);
  },

  attachSeasonal(rows) {
    rows.forEach((row) => {
      const item = seasonal.entryOf(row.id);
      if (!item) return;
      corpus.withTranslation(row, item);
    });
  },

  onSeasonalAdd(e) {
    const id = e.currentTarget.dataset.id;
    const r = store.toggleDailyExtra(id);
    const box = this.selectComponent("#extra");
    if (r.code === "E_TIER") {
      if (box) box.askUpgrade();
      return;
    }
    if (!r.ok) {
      wx.showToast({ title: r.code === "E_LIMIT" ? "今天已经加了 " + store.DAILY_EXTRA_MAX + " 首" : "加不进去", icon: "none" });
      return;
    }
    wx.showToast({ title: r.on ? "已加入今日加背" : "已移出今日加背", icon: "none" });
    const rows = this.seasonalRows();
    const at = rows.map((x) => x.id).indexOf(id);
    if (at >= 0) this.setData({ ["seasonal.rows[" + at + "].daily"]: r.on });
    if (box) box.refresh();
  },

  onSeasonalCollect(e) {
    const id = e.currentTarget.dataset.id;
    gate.guard("自选背诵", this, () => {
      if (!entitlement.block("collections", { page: this })) return;
      const box = this.selectComponent("#collect");
      if (box) box.ask(id);
    });
  },

  onCollectDone(e) {
    const d = (e && e.detail) || {};
    if (!d.id || !d.collectionId) return;
    this.refresh();
    wx.showToast({ title: "已收进「" + d.name + "」", icon: "none" });
  },

  sheetRowsOf(plan) {
    if (this.collectionId) return this.collectionSheetRows(this.collectionId);
    if (this.sheetSource === "all") return this.scopeRows();
    if (this.sheetSource === "seasonal") return this.seasonalRows();
    return plan;
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
      let doneNow = 0;
      plan.forEach((it) => {
        const rec = seen[it.poem.id];
        if (S.isLearned(rec)) done += 1;
        if (S.doneToday(rec)) doneNow += 1;
      });
      return {
        id: c.id,
        title: cols.nameOf(c),
        count: c.items.length,
        planned: plan.length,
        done: done,
        doneNow: doneNow,
        doneToday: plan.length > 0 && doneNow >= plan.length,
        rows: this.collectionCardRows(plan)
      };
    });
  },

  cheerCollection(list) {
    const hit = (list || []).filter((c) => c.doneToday)[0];
    if (!hit || this.cheered === hit.id) return;
    this.cheered = hit.id;
    sfx.pass();
    if (Date.now() - this.toastAt() < TOAST_GAP) return;
    this.toastedAt = Date.now();
    wx.showToast({ title: "「" + hit.title + "」今日份已背完 · " + hit.planned + " 首", icon: "none", duration: TOAST_MS });
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
      tagCls: reasonCls(reason),
      stage: stage === REASON_TEXT[reason] ? "" : stage,
      mastery: S.mastery(rec),
      picked: pickedToday(rec),
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
    const ds = datasetOf(e);
    gate.guard("自选背诵", this, () => {
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

  onGuestOpen() {
    gate.guard("诗词", this);
  },

  onOpen(e) {
    const ds = datasetOf(e);
    this.openSheet(ds.id, "plan");
  },

  onFace(e) {
    const ds = datasetOf(e);
    const face = FACES.filter((f) => f.key === ds.key)[0];
    if (!face) return;
    if (!entitlement.can("daily")) {
      wx.showToast({ title: entitlement.hint("daily"), icon: "none" });
      return;
    }
    sfx.recite(face.key);
    const settings = store.settings();
    const rec = R.review(store.getRecord(ds.id), face.key, settings.algo);
    store.setRecord(ds.id, rec);
    store.markRead(sourceBook(ds.id), ds.id);
    sync.markDirty();
    this.refresh();
    wx.showToast({
      title: face.label + " · " + R.resultHint(settings.algo, face.key, rec),
      icon: "none"
    });
  },

  onOpenAll(e) {
    this.openSheet(e.currentTarget.dataset.id, "all");
  },

  openSheet(id, source) {
    gate.guard("背诵", this, () => {
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
    this.collectExtra(this.sheetSource === "plan");
  },

  collectExtra(ofPlan) {
    if (!ofPlan || !this.data.allDone || this.toasted) return;
    this.toasted = true;
    if (Date.now() - this.toastAt() < TOAST_GAP) return;
    this.toastedAt = Date.now();
    wx.showToast({ title: "今天的几首都背完了，了不起", icon: "none", duration: TOAST_MS });
  },

  toastAt() {
    return this.toastedAt || 0;
  },

  onSettings() {
    if (!gate.guard("背诵设置", this)) return;
    wx.navigateTo({ url: "/packages/settings/recite/recite" });
  },

  seedFaces() {
    const ids = this.data.plan.map((it) => it.id);
    FACES.forEach((f, i) => {
      const id = ids[i];
      if (!id) return;
      store.setRecord(id, R.review(store.getRecord(id), f.key, store.settings().algo));
    });
    this.refresh();
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
