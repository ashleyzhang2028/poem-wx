/**
 * 每日计划的排期内核。与网页版 js/scheduler.js 同一套口径：
 * 先排到期的（复习），再从范围内补新学的，最后拿教材外/邻近年级的凑数，
 * 凑不齐才从池子里拣 —— 保证「今日 5 首」不会因为没到期的就空着。
 */
const R = require("./review-models");
const store = require("./store");

const DAY = R.DAY;

/* 取诗范围。每一项只有**一个**标签 ——
   上一版还配了一句 scopeName 副标题，而它就是标签的同义改写
   （「本册」→「本学期」、「小学随机」→「小学阶段」），
   六个选项下面吊着六行废话。副标题撤了，scopeName 只留给需要
   把范围写成一句话的地方（首页、我的页里那句「一年级上 · 本学期及之前」）。 */
const SCOPES = {
  term: { label: "本册", scopeName: "本学期", random: false, stages: ["current"] },
  upto: { label: "本册及之前", scopeName: "本学期及之前", random: false, stages: ["upto"] },
  primary: { label: "小学随机", scopeName: "小学阶段", random: true, stages: ["primary"] },
  middle: { label: "初中随机", scopeName: "初中阶段", random: true, stages: ["middle"] },
  primary_middle: { label: "小学+初中随机", scopeName: "小学及初中阶段", random: true, stages: ["primary", "middle"] },
  high: { label: "高中随机", scopeName: "高中阶段", random: true, stages: ["high"] },
  all: { label: "全部随机", scopeName: "全部阶段", random: true, stages: ["primary", "middle", "high"] }
};

const DEFAULT_SCOPE = "upto";

/* 每日首数四档。**5 是不选时的默认**（store 里 dailyCount: 5），
   所以 5 必须在档里；3 / 10 / 20 是另外三个量级。
   上一版是 3/5/8/10（照搬网页版），按 Issue #26 改为 3/5/10/20 ——
   8 与 10 只差两首，档位踩得太密，而 20 首是「今天想多背」的那一档，
   原来根本没有。 */
const DAILY_COUNTS = [3, 5, 10, 20];

const GRADE_NAMES = {
  1: "一年级", 2: "二年级", 3: "三年级", 4: "四年级",
  5: "五年级", 6: "六年级", 7: "七年级", 8: "八年级",
  9: "九年级", 10: "高一", 11: "高二", 12: "高三"
};

const STAGE_GRADES = {
  primary: [1, 2, 3, 4, 5, 6],
  middle: [7, 8, 9],
  high: [10, 11, 12]
};

function scopeOf(key) {
  return SCOPES[key] || SCOPES[DEFAULT_SCOPE];
}

function algoKey() {
  return store.settings().algo || R.DEFAULT_KEY;
}

/** 没见过、或还没开始学的，都不算「到期」—— 那些走新学那条路 */
function isDue(rec, now) {
  if (!rec || !(rec.attempted || rec.learned)) return false;
  return rec.nextReviewAt <= (now === undefined ? Date.now() : now);
}

function isLearned(rec) {
  if (!rec) return false;
  return !!(rec.learned || (rec.history && rec.history.length));
}

function mastery(rec) {
  if (!rec || !rec.learned) return 0;
  return Math.round((R.clampLevel(rec.level) / 9) * 100);
}

function stageName(rec) {
  return R.stageName(rec, algoKey());
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
  return a;
}

function poolForScope(opt) {
  const grade = Number(opt.grade);
  const term = Number(opt.term);
  const key = opt.scope || DEFAULT_SCOPE;
  const scope = scopeOf(key);
  const all = (opt.allPoems || []).slice();

  if (key === "term") {
    return all.filter((p) => p.gr === grade && p.tm === term);
  }
  if (key === "upto") {
    return all.filter((p) => p.gr < grade || (p.gr === grade && p.tm <= term));
  }

  let inStage = [];
  scope.stages.forEach((st) => {
    (STAGE_GRADES[st] || []).forEach((g) => {
      inStage = inStage.concat(all.filter((p) => p.gr === g));
    });
  });
  return inStage.length ? inStage : all.filter((p) => p.gr === grade && p.tm === term);
}

function gradeDistance(a, b) {
  return Math.abs(Number(a) - Number(b));
}

/**
 * 生成今日计划。
 * @param {Object} opt grade / term / count / scope / allPoems / extraPoems / getRecord
 */
function generateDailyPlan(opt) {
  const grade = Number(opt.grade);
  const term = Number(opt.term);
  const count = opt.count || 5;
  const getRecord = opt.getRecord;
  const now = Date.now();
  const allPoems = opt.allPoems || [];
  const current = allPoems.filter((p) => p.gr === grade && p.tm === term);
  const scope = scopeOf(opt.scope);

  let pool = poolForScope({ grade, term, scope: opt.scope, allPoems });
  if (!pool.length) pool = current.slice();

  if (scope.random) {
    pool = shuffle(pool);
  } else {
    pool.sort((a, b) => {
      const aCur = a.gr === grade && a.tm === term ? 0 : 1;
      const bCur = b.gr === grade && b.tm === term ? 0 : 1;
      if (aCur !== bCur) return aCur - bCur;
      const ag = gradeDistance(a.gr, grade);
      const bg = gradeDistance(b.gr, grade);
      if (ag !== bg) return ag - bg;
      return (a.tm - b.tm) || 0;
    });
  }

  const plan = [];
  const used = {};

  const extraById = {};
  const extraList = [];
  (opt.extraPoems || []).forEach((p) => {
    if (!p || !p.id || extraById[p.id]) return;
    extraById[p.id] = true;
    extraList.push(p);
  });

  const courseIds = {};
  allPoems.forEach((p) => {
    courseIds[p.id] = true;
  });

  const dueAll = allPoems.concat(extraList.filter((p) => !courseIds[p.id]))
    .filter((p) => isDue(getRecord(p.id), now));

  const inPool = {};
  pool.forEach((p) => {
    inPool[p.id] = true;
  });

  dueAll.sort((a, b) => {
    const aIn = inPool[a.id] ? 0 : 1;
    const bIn = inPool[b.id] ? 0 : 1;
    if (aIn !== bIn) return aIn - bIn;
    const ra = getRecord(a.id);
    const rb = getRecord(b.id);
    return (ra ? ra.nextReviewAt : 0) - (rb ? rb.nextReviewAt : 0);
  });

  dueAll.forEach((p) => {
    if (plan.length >= count || used[p.id]) return;
    used[p.id] = true;
    const rec = getRecord(p.id);
    plan.push({ poem: p, reason: "review", reviewRound: rec ? R.clampLevel(rec.level) + 1 : 1 });
  });

  function fillFrom(list, reason) {
    list.forEach((p) => {
      if (plan.length >= count || used[p.id]) return;
      if (isLearned(getRecord(p.id))) return;
      used[p.id] = true;
      plan.push({ poem: p, reason, reviewRound: 0 });
    });
  }

  fillFrom(pool, "new");
  fillFrom(extraList.filter((p) => !courseIds[p.id]), "optional");

  if (plan.length < count) {
    const others = allPoems
      .filter((p) => !used[p.id] && !(p.gr === grade && p.tm === term))
      .sort((a, b) => {
        const da = Math.abs(a.gr - grade) * 10 + Math.abs(a.tm - term);
        const db = Math.abs(b.gr - grade) * 10 + Math.abs(b.tm - term);
        return da - db;
      });
    fillFrom(others, "new");
  }

  if (plan.length < count) {
    const remain = (scope.random ? shuffle(pool) : pool.concat(current))
      .concat(extraList.filter((p) => !courseIds[p.id]))
      .filter((p) => !used[p.id]);
    remain.forEach((p) => {
      if (plan.length >= count) return;
      used[p.id] = true;
      const rec = getRecord(p.id);
      plan.push({ poem: p, reason: "extra", reviewRound: rec ? R.clampLevel(rec.level) + 1 : 1 });
    });
  }

  return plan;
}

/** 全库总览：已学 / 已掌握 / 今日到期 */
function overview(allPoems) {
  const getRecord = (id) => store.getRecord(id);
  const now = Date.now();
  let learned = 0;
  let mastered = 0;
  let due = 0;

  allPoems.forEach((p) => {
    const rec = getRecord(p.id);
    if (!rec || !rec.learned) return;
    learned += 1;
    if (R.clampLevel(rec.level) >= 7) mastered += 1;
    if (rec.nextReviewAt <= now) due += 1;
  });

  return { total: allPoems.length, learned, mastered, dueToday: due };
}

/** 未来 N 天的排期预览，用于进度总览页 */
function forecast(allPoems, days) {
  const getRecord = (id) => store.getRecord(id);
  const today = R.startOfDay(Date.now());
  const out = [];
  for (let i = 0; i < days; i++) out.push({ day: today + i * DAY, offset: i, items: [] });

  let farther = 0;
  allPoems.forEach((p) => {
    const rec = getRecord(p.id);
    if (!rec || !rec.learned) return;
    const off = Math.round((R.startOfDay(rec.nextReviewAt) - today) / DAY);
    if (off >= days) {
      farther += 1;
      return;
    }
    const bucket = out[Math.max(0, off)];
    bucket.items.push(Object.assign({ id: p.id, title: p.t, author: p.a }, {
      daysLeft: off,
      stageName: R.stageName(rec, algoKey()),
      mastery: mastery(rec)
    }));
  });

  const backlog = out[0].items.filter((x) => x.daysLeft < 0);
  return { days: out, farther, total: allPoems.length, backlog };
}

function gradeName(g) {
  return GRADE_NAMES[g] || g + "年级";
}

function termName(t) {
  return Number(t) === 2 ? "下" : "上";
}

module.exports = {
  SCOPES,
  DEFAULT_SCOPE,
  DAILY_COUNTS,
  GRADE_NAMES,
  STAGE_GRADES,
  scopeOf,
  algoKey,
  isDue,
  isLearned,
  mastery,
  stageName,
  poolForScope,
  generateDailyPlan,
  overview,
  forecast,
  gradeName,
  termName,
  startOfDay: R.startOfDay,
  DAY
};
