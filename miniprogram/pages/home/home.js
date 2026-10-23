const corpus = require("../../utils/corpus");
const store = require("../../utils/store");
const S = require("../../utils/scheduler");
const R = require("../../utils/review-models");
const cols = require("../../utils/collections");
const entitlement = require("../../utils/entitlement");
const sync = require("../../utils/sync");
const gate = require("../../utils/gate");
const loginFlow = require("../../utils/login-flow");
const tabPage = require("../../utils/tab-page");
const tabbar = require("../../utils/tabbar");
const theme = require("../../utils/theme");
const LUNAR = require("../../utils/lunar");
const seasonal = require("../../utils/seasonal");
const sfx = require("../../utils/sfx");
const quotes = require("../../utils/finish-quote");
const icons = require("../../utils/icons");
const guard = require("../../utils/guard");
const pv = require("../../components/progress-view/progress-view");

const REASON_TEXT = { review: "复习", new: "新学", extra: "补充", pinned: "加背" };

const TOAST_GAP = 2400;

const TOAST_MS = 2200;

const GUEST_SCOPE = "term";

const GUEST_SEED = 20240301;

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
  return corpus.bookOf(id) === "poems" ? "course" : "own";
}

function dailyOnIds() {
  const box = {};
  store.dailyExtra().forEach((id) => { box[id] = true; });
  return box;
}

function sourceBook(id) {
  return corpus.bookOf(id) || "poems";
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
  const plan = S.samplePlan({
    grade: gate.GUEST_GRADE,
    term: 1,
    scope: GUEST_SCOPE,
    count: store.DEFAULTS.dailyCount,
    allPoems: corpus.course(),
    seed: GUEST_SEED
  });
  const catalog = plan.map((it, i) => ({
    id: it.poem.id,
    title: it.poem.t,
    author: it.poem.a,
    dynasty: it.poem.d,
    seq: i + 1
  }));
  return {
    logged: false,
    guest: true,
    gradeName: S.gradeName(gate.GUEST_GRADE),
    termName: "",
    scopeName: S.gradeName(gate.GUEST_GRADE),
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

    banner: theme.BANNER,

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
    this.onLoginSettled = () => this.refresh();
    loginFlow.watch(this.onLoginSettled);
  },

  onUnload() {
    loginFlow.unwatch(this.onLoginSettled);
  },

  onShow() {
    theme.apply(this);
    this.toasted = false;

    this.setData({
      banner: theme.bannerSrc(),
      todayLabel: todayLabel(),
      barBelow: !!tabbar.sync(this, 0)
    });
    this.refresh();
  },

  refresh(force) {
    if (!gate.logged()) {
      this.setData(Object.assign(guestCatalog(), { seasonal: this.seasonalCard() }));
      return;
    }

    this.paint();
    this.pull(force);
  },

  pull(force) {
    const seq = (this.pullSeq || 0) + 1;
    this.pullSeq = seq;
    guard
      .once("home:pull", () => sync.pullOnly(!!force))
      .then((res) => {
        if (this.pullSeq !== seq) return;
        if (!res || res.skipped || res.error || !res.applied) return;
        this.paint();
      });
  },

  paint() {
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
    const planKey = S.planKeyOf({
      grade: view.grade,
      term: view.term,
      scope: view.scope,
      count: settings.dailyCount
    });
    const recorded = store.dayPlan(planKey).ids;
    const extraOf = plan.filter((it) => it.reason === "pinned").length;
    const base = Math.max(recorded.length, plan.length - extraOf);
    const todaySet = S.todaySet(planKey, base);
    const dailyOn = dailyOnIds();
    const recitedOf = {};
    const rows = plan.map((it, i) => {
      const rec = store.getRecord(it.poem.id);
      const read = readOf(it.poem.id);
      const recited = S.isLearned(rec);
      recitedOf[it.poem.id] = recited;
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
        daily: !!dailyOn[it.poem.id],
        read,
        recited,
        stateText: stateText(recited, read),
        stateCls: stateCls(recited),
        source: SOURCE_TEXT[sourceKey(it.poem.id)]
      };
    });

    const total = rows.length;
    const done = S.todayDone(todaySet, recitedOf);
    const allDone = done >= base;
    const left = S.todayLeft(todaySet, recitedOf);
    const colRows = this.collectionRows();
    const selfTotal = colRows.reduce((n, c) => n + c.planned, 0);
    const selfDone = colRows.reduce((n, c) => n + c.done, 0);
    const selfToday = colRows.reduce((n, c) => n + c.doneNow, 0);
    const selfAllDone = selfTotal > 0 && selfToday >= selfTotal;

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
        left: selfOnly ? Math.max(selfTotal - selfDone, 0) : left,
        extra: extraOf
      },
      coursePlan: selfOnly ? coursePlan.filter((it) => it.reason !== "pinned").map((it, i) => this.poemRow(it.poem, i, it.reason, readOf)) : [],
      courseBase: selfOnly ? Math.max(courseRecorded, coursePlan.length - coursePlan.filter((it) => it.reason === "pinned").length) : 0,
      allCount: allList.length,
      allLabel: scopeLabel(scope),
      allRows: this.data.allOpen ? allRows : [],
      sheetRows: sheetRows,
      selfOnly: selfOnly,
      collections: colRows,
      collectionCount: colRows.length,
      collectionOn: entitlement.can("collections"),
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
    const collected = {};
    cols.list().forEach((c) => cols.idsOf(c).forEach((id) => { collected[id] = true; }));
    return Object.assign({}, card, {
      rows: card.poems.map((p, i) => Object.assign(this.poemRow(p, i, "", readOf), {
        daily: extra.indexOf(p.id) >= 0,
        collected: !!collected[p.id]
      }))
    });
  },

  seasonalRow(id) {
    const rows = this.seasonalRows();
    const at = rows.map((x) => x.id).indexOf(id);
    return { at: at, row: at >= 0 ? rows[at] : null };
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

  onSeasonalOpen(e) {
    const rows = this.seasonalRows();
    if (!rows.length) return;
    const sheet = this.selectComponent("#sheet");
    if (!sheet) return;
    const id = (e && e.currentTarget && e.currentTarget.dataset.id) || rows[0].id;
    this.sheetSource = "seasonal";
    this.collectionId = "";
    this.setData({ sheetRows: rows });
    sheet.open(rows, id);
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
    if (!guard.enter("home:extra:" + id)) return;
    const r = store.toggleDailyExtra(id);
    guard.leave("home:extra:" + id);
    const box = this.selectComponent("#extra");
    if (r.code === "E_TIER") {
      entitlement.gateTier("extra", { page: this });
      return;
    }
    if (!r.ok) {
      wx.showToast({ title: r.code === "E_LIMIT" ? "今日已加背 " + store.DAILY_EXTRA_MAX + " 首" : "添加失败", icon: "none" });
      return;
    }
    wx.showToast({ title: r.on ? "已加入今日加背" : "已移出今日加背", icon: "none" });
    this.syncDailyExtra(id, r.on);
    this.paint();
    if (box) box.refresh();
  },

  syncDailyExtra(id, on) {
    const at = this.seasonalRow(id).at;
    if (at >= 0) this.setData({ ["seasonal.rows[" + at + "].daily"]: !!on });
  },

  onSeasonalCollect(e) {
    const id = e.currentTarget.dataset.id;
    if (!this.requireLogin("collections")) return;
    const have = cols.collectionsOf(id);
    if (have.length === 1) {
      this.dropFromCollection(id, have[0]);
      return;
    }
    const box = this.selectComponent("#collect");
    if (box) box.ask(id);
  },

  dropFromCollection(id, c) {
    const r = cols.removeItems(c.id, [id]);
    if (!r.ok) return;
    this.syncCollected(id, false);
    this.paint();
    sync.markDirty();
    wx.showToast({ title: "已移出「" + c.name + "」", icon: "none" });
  },

  syncCollected(id, on) {
    const hit = this.seasonalRow(id);
    if (hit.at < 0) return;
    this.setData({ ["seasonal.rows[" + hit.at + "].collected"]: !!on });
  },

  requireLogin(name) {
    return entitlement.block(name, { page: this, loginPrompt: true });
  },

  onGoCollections() {
    wx.navigateTo({ url: "/packages/settings/collections/collections" });
  },

  onCollectDone(e) {
    const d = (e && e.detail) || {};
    if (!d.id || !d.collectionId) return;
    this.syncCollected(d.id, true);
    this.paint();
    sync.markDirty();
    wx.showToast({ title: "已加入「" + d.name + "」", icon: "none" });
  },

  sheetRowsOf(plan) {
    if (this.collectionId) return this.collectionSheetRows(this.collectionId);
    if (this.sheetSource === "all") return this.scopeRows();
    if (this.sheetSource === "seasonal") return this.seasonalRows();
    return plan;
  },

  collectionRows() {
    const all = corpus.course();
    return cols.list().map((c, i) => {
      const plan = S.collectionPlan(c, {
        count: cols.countOf(c),
        allPoems: all,
        getRecord: store.getRecord
      });
      const recOf = (it) => store.getRecord(it.poem.id);
      const doneNow = plan.filter((it) => S.doneToday(recOf(it))).length;
      return {
        id: c.id,
        title: cols.nameOf(c),
        count: c.items.length,
        planned: plan.length,
        done: plan.filter((it) => S.isLearned(recOf(it))).length,
        doneNow: doneNow,
        doneToday: plan.length > 0 && doneNow >= plan.length,
        color: pv.DOTS[i % pv.DOTS.length],
        praise: plan.length > 0 && doneNow >= plan.length ? praiseOf("own") : "",
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
    wx.showToast({ title: "「" + hit.title + "」今日已背完 · " + hit.planned + " 首", icon: "none", duration: TOAST_MS });
  },

  collectionCardRows(plan) {
    const readOf = this.readOf();
    return plan.map((it, i) => this.poemRow(it.poem, i, it.reason, readOf));
  },

  readOf() {
    const seen = {};
    return (id) => {
      const book = corpus.bookOf(id) || "poems";
      if (!seen[book]) seen[book] = store.reads(book);
      return !!seen[book][id];
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
    if (!this.requireLogin("collections")) return;
    const sheet = this.selectComponent("#sheet");
    if (!sheet) return;
    const rows = this.collectionSheetRows(ds.coll);
    if (!rows.length) {
      wx.showToast({ title: "该集合暂无篇目", icon: "none" });
      return;
    }
    this.collectionId = ds.coll;
    this.setData({ sheetRows: rows });
    sheet.open(rows, ds.id);
  },

  onProgress(e) {
    const id = datasetOf(e).id;
    if (!this.requireLogin("collections")) return;
    wx.navigateTo({ url: "/packages/progress/coll/coll?coll=" + encodeURIComponent(id) });
  },

  scopeRows() {
    const settings = store.settings();
    const view = { grade: settings.grade, term: settings.term, scope: settings.scope };
    const scope = S.scopeOf(view.scope);
    return rowsOfScope(scopeList(corpus.course(), view, scope), scope);
  },

  onGuestOpen() {
    if (!this.requireLogin("daily")) return;
    this.refresh();
  },

  showIdentity() {
    tabPage.mine();
  },

  onLoginTapped() {
    loginFlow.askLogin(this);
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
    if (!guard.enter("home:face:" + ds.id)) return;
    sfx.recite(face.key);
    const settings = store.settings();
    const rec = R.review(store.getRecord(ds.id), face.key, settings.algo);
    store.setRecord(ds.id, rec);
    store.markRead(sourceBook(ds.id), ds.id);
    sync.markDirty();
    guard.leave("home:face:" + ds.id);
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
    if (!this.requireLogin("daily")) return;
    const sheet = this.selectComponent("#sheet");
    if (!sheet) return;
    this.sheetSource = source;
    this.collectionId = "";
    const rows = source === "all" ? this.scopeRows() : this.data.plan;
    const patch = { sheetRows: rows };
    if (source === "all") patch.allRows = rows;
    this.setData(patch);
    sheet.open(rows, id);
  },

  onToggleAll() {
    const open = !this.data.allOpen;
    this.setData({ allOpen: open, allRows: open ? this.scopeRows() : [] });
  },

  onSheetOpen() {
    this.refresh();
  },

  onDeferChange() {
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
    wx.showToast({ title: "今日篇目已全部背完", icon: "none", duration: TOAST_MS });
  },

  toastAt() {
    return this.toastedAt || 0;
  },

  onSettings() {
    if (!this.requireLogin("daily")) return;
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
    this.refresh(true);
    setTimeout(() => wx.stopPullDownRefresh(), 320);
  },

  onShareAppMessage() {

    return { title: "每天背一首古诗文", path: "/pages/home/home" };
  },

  onShareTimeline() {
    return { title: "每天背一首古诗文" };
  }
});
