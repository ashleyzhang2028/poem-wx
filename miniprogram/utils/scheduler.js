const R = require("./review-models");
const store = require("./store");

const DAY = R.DAY;

const SCOPES = {
  term: { label: "本册", scopeName: "本学期", random: false, stages: ["current"] },
  grade: { label: "本年级", scopeName: "本年级", random: false, stages: ["grade"] },
  upto: { label: "本册及之前", scopeName: "本学期及之前", random: false, stages: ["upto"] },
  primary: { label: "小学随机", scopeName: "小学阶段", random: true, stages: ["primary"] },
  middle: { label: "初中随机", scopeName: "初中阶段", random: true, stages: ["middle"] },
  primary_middle: { label: "小初随机", scopeName: "小学及初中阶段", random: true, stages: ["primary", "middle"] },
  high: { label: "高中随机", scopeName: "高中阶段", random: true, stages: ["high"] },
  all: { label: "全部随机", scopeName: "全部阶段", random: true, stages: ["primary", "middle", "high"] }
};

const DEFAULT_SCOPE = "upto";

const DAILY_COUNTS = [3, 5, 10, 20];


const SPAN = 7;

const MASTERED_LEVEL = 7;

const BACKLOG_DAYS = 7;

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

const STAGES = {
  primary: { name: "小学", grades: STAGE_GRADES.primary },
  middle: { name: "初中", grades: STAGE_GRADES.middle },
  high: { name: "高中", grades: STAGE_GRADES.high }
};

const STAGE_KEYS = ["primary", "middle", "high"];

function scopeOf(key) {
  return SCOPES[key] || SCOPES[DEFAULT_SCOPE];
}

function stageOf(grade) {
  const g = Number(grade);
  return STAGE_KEYS.filter((k) => STAGE_GRADES[k].indexOf(g) >= 0)[0] || "primary";
}

function stageLabel(key) {
  return (STAGES[key] || STAGES.primary).name;
}

function algoKey() {
  return store.settings().algo || R.DEFAULT_KEY;
}

function isDue(rec, now) {
  if (!rec || !(rec.attempted || rec.learned)) return false;
  return rec.nextReviewAt <= (now === undefined ? Date.now() : now);
}

function isLearned(rec) {
  if (!rec) return false;
  return !!(rec.learned || (rec.history && rec.history.length));
}

function doneToday(rec, now) {
  if (!isLearned(rec)) return false;
  return rec.reviewedOn === R.dayStamp(now === undefined ? Date.now() : now);
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
  if (key === "grade") {
    return all.filter((p) => p.gr === grade);
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

function dedupePoems(list) {
  const seen = {};
  const out = [];
  (list || []).forEach((p) => {
    if (!p || !p.id || seen[p.id]) return;
    seen[p.id] = true;
    out.push(p);
  });
  return out;
}

function pinnedPlan(extraPoems, getRecord) {
  return (extraPoems || []).filter((p) => p && p.id).map((p) => {
    const rec = getRecord(p.id);
    return {
      poem: p,
      reason: "pinned",
      reviewRound: rec && rec.learned ? R.clampLevel(rec.level) + 1 : 1
    };
  });
}

function generateDailyPlan(opt) {
  const grade = Number(opt.grade);
  const term = Number(opt.term);
  const count = opt.count || 5;
  const getRecord = opt.getRecord;

  if (opt.selfOnly) return pinnedPlan(dedupePoems(opt.extraPoems), getRecord);

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

  const extraList = dedupePoems(opt.extraPoems);
  const extraById = {};
  extraList.forEach((p) => { extraById[p.id] = true; });

  const isExtra = (p) => !!extraById[p.id];

  const dueAll = allPoems.filter((p) => isDue(getRecord(p.id), now) && !isExtra(p));

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

  fillFrom(pool.filter((p) => !isExtra(p)), "new");

  if (plan.length < count) {
    const others = allPoems
      .filter((p) => !used[p.id] && !isExtra(p) && !(p.gr === grade && p.tm === term))
      .sort((a, b) => {
        const da = Math.abs(a.gr - grade) * 10 + Math.abs(a.tm - term);
        const db = Math.abs(b.gr - grade) * 10 + Math.abs(b.tm - term);
        return da - db;
      });
    fillFrom(others, "new");
  }

  if (plan.length < count) {
    const remain = (scope.random ? shuffle(pool) : pool.concat(current))
      .filter((p) => !used[p.id] && !isExtra(p));
    remain.forEach((p) => {
      if (plan.length >= count) return;
      used[p.id] = true;
      const rec = getRecord(p.id);
      plan.push({ poem: p, reason: "extra", reviewRound: rec ? R.clampLevel(rec.level) + 1 : 1 });
    });
  }

  extraList.forEach((p) => {
    const rec = getRecord(p.id);
    plan.push({
      poem: p,
      reason: "pinned",
      reviewRound: rec && rec.learned ? R.clampLevel(rec.level) + 1 : 1
    });
  });

  return plan;
}

function lastReviewOf(rec) {
  if (!rec) return 0;
  if (Number(rec.lastReviewAt) > 0) return Number(rec.lastReviewAt);
  const h = rec.history;
  if (Array.isArray(h) && h.length) return Number(h[h.length - 1].at) || 0;
  return 0;
}

function overview(allPoems, days) {
  const getRecord = (id) => store.getRecord(id);
  const span = Math.max(1, Number(days) || SPAN);
  const now = Date.now();
  const today = R.startOfDay(now);
  const calendar = [];
  for (let i = 0; i < span; i++) calendar.push({ offset: i, day: today + i * DAY, count: 0 });

  let learned = 0;
  let mastered = 0;
  let masterySum = 0;
  let backlog = 0;
  const buckets = [0, 0, 0, 0, 0];

  allPoems.forEach((p) => {
    const rec = getRecord(p.id);
    if (!rec || !rec.learned) return;
    learned += 1;
    if (R.clampLevel(rec.level) >= MASTERED_LEVEL) mastered += 1;

    const m = mastery(rec);
    masterySum += m;
    buckets[Math.min(buckets.length - 1, Math.floor(m / 20))] += 1;

    const off = Math.round((R.startOfDay(rec.nextReviewAt) - today) / DAY);
    if (off < -BACKLOG_DAYS) {
      backlog += 1;
    } else if (off < 0) {
      calendar[0].count += 1;
    } else if (off < span) {
      calendar[off].count += 1;
    }
  });

  const maxDay = calendar.reduce((a, d) => Math.max(a, d.count), 0);
  return {
    total: allPoems.length,
    learned,
    mastered,
    avgMastery: learned ? Math.round(masterySum / learned) : 0,
    dueToday: calendar[0].count,
    backlog,
    calendar,
    maxDay,
    masteryBuckets: buckets
  };
}

function dueList(allPoems, days) {
  const getRecord = (id) => store.getRecord(id);
  const span = Math.max(1, Number(days) || SPAN);
  const today = R.startOfDay(Date.now());
  const out = [];
  for (let i = 0; i < span; i++) out.push({ offset: i, day: today + i * DAY, items: [] });

  const backlog = [];
  let farther = 0;

  allPoems.forEach((p) => {
    const rec = getRecord(p.id);
    if (!rec || !rec.learned) return;
    const off = Math.round((R.startOfDay(rec.nextReviewAt) - today) / DAY);
    const item = {
      id: p.id,
      title: p.t,
      author: p.a,
      dynasty: p.d,
      daysLeft: off,
      stageName: R.stageName(rec, algoKey()),
      mastery: mastery(rec),
      lastReviewAt: lastReviewOf(rec)
    };
    if (off < -BACKLOG_DAYS) {
      backlog.push(item);
      return;
    }
    if (off >= span) {
      farther += 1;
      return;
    }
    out[Math.max(0, off)].items.push(item);
  });

  const byUrgency = (a, b) => {
    if (a.daysLeft !== b.daysLeft) return a.daysLeft - b.daysLeft;
    if (a.mastery !== b.mastery) return a.mastery - b.mastery;
    return a.id < b.id ? -1 : 1;
  };
  out.forEach((d) => d.items.sort(byUrgency));
  backlog.sort(byUrgency);

  return { days: out, backlog, total: out.reduce((a, d) => a + d.items.length, 0), farther };
}

function collectionPoems(allPoems, c) {
  const owner = require("./corpus");
  return ((c && c.items) || [])
    .map((it) => allPoems.filter((p) => p.id === it.id)[0] || owner.indexById(it.id))
    .filter(Boolean);
}

function collectionPlan(c, opt) {
  const o = opt || {};
  const getRecord = o.getRecord || store.getRecord;
  const count = Number(o.count) || 5;
  const now = Date.now();
  const poems = collectionPoems(o.allPoems || [], c);
  const due = [];
  const fresh = [];
  const rest = [];

  poems.forEach((p) => {
    const rec = getRecord(p.id);
    if (isDue(rec, now)) due.push(p);
    else if (!isLearned(rec)) fresh.push(p);
    else rest.push(p);
  });

  const at = (p) => {
    const rec = getRecord(p.id);
    return rec ? Number(rec.nextReviewAt) || 0 : 0;
  };
  due.sort((a, b) => at(a) - at(b));

  const plan = [];
  const used = {};
  const take = (list, reason) => {
    list.forEach((p) => {
      if (plan.length >= count || used[p.id]) return;
      used[p.id] = true;
      const rec = getRecord(p.id);
      plan.push({
        poem: p,
        reason: reason,
        reviewRound: isLearned(rec) ? R.clampLevel(rec.level) + 1 : 0
      });
    });
  };
  take(due, "review");
  take(fresh, "new");
  take(rest, "extra");
  return plan;
}

function collectionOverview(allPoems, c) {
  const getRecord = (id) => store.getRecord(id);
  const poems = collectionPoems(allPoems, c);
  const now = Date.now();
  let learned = 0;
  let due = 0;
  poems.forEach((p) => {
    const rec = getRecord(p.id);
    if (!isLearned(rec)) return;
    learned += 1;
    if (isDue(rec, now)) due += 1;
  });
  return { total: poems.length, learned: learned, due: due };
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
  STAGES,
  STAGE_KEYS,
  stageOf,
  stageLabel,
  scopeOf,
  algoKey,
  isDue,
  isLearned,
  doneToday,
  mastery,
  stageName,
  poolForScope,
  collectionPlan,
  collectionOverview,
  generateDailyPlan,
  overview,
  dueList,
  gradeName,
  termName,
  startOfDay: R.startOfDay,
  DAY,
  SPAN
};
