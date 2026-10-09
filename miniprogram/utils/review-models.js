/**
 * 四套复习算法：艾宾浩斯 / 莱特纳盒 / SM-2 / FSRS。
 * 口径与网页版 js/review-models.js 逐条对齐 —— 换算法不清进度，
 * 已有记录按 adopt() 折算到新模型上。
 */
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const MIN = 60 * 1000;

const FUZZY_HOURS = 12;
const BAD_MINUTES = 30;

const EBBINGHAUS_INTERVALS = [0, 1, 2, 4, 7, 15, 30, 60, 120, 240];

function startOfDay(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function dayAt(ts, days) {
  return startOfDay(ts) + days * DAY + 9 * HOUR;
}

function clampLevel(lv) {
  const n = typeof lv === "number" && isFinite(lv) ? Math.round(lv) : 0;
  return Math.max(0, Math.min(n, EBBINGHAUS_INTERVALS.length - 1));
}

function clampBox(b) {
  const n = typeof b === "number" && isFinite(b) ? Math.round(b) : 0;
  return Math.max(0, Math.min(n, MODELS.leitner.boxes.length - 1));
}

const MODELS = {
  ebbinghaus: {
    key: "ebbinghaus",
    name: "艾宾浩斯遗忘曲线",
    short: "艾宾浩斯",
    sub: "按艾宾浩斯遗忘曲线复习",
    years: "1885 · 固定间隔",
    blurb: "固定间隔，短篇最省心",
    free: true,
    init: () => ({ level: 0 }),
    intervalDays: (level) => EBBINGHAUS_INTERVALS[clampLevel(level)],
    stageName(rec) {
      const names = ["新学", "1 天后", "2 天后", "4 天后", "7 天后", "15 天后",
        "30 天后", "60 天后", "120 天后", "已牢固"];
      return names[clampLevel(rec && rec.level)] || "新学";
    }
  },

  leitner: {
    key: "leitner",
    name: "莱特纳盒",
    short: "Leitner",
    sub: "按 Leitner 盒复习",
    years: "1972 · 分级盒子",
    blurb: "答对往后挪一盒",
    free: true,
    boxes: [1, 2, 4, 8, 16],
    init: () => ({ box: 0 }),
    intervalDays(box) {
      return this.boxes[clampBox(box)];
    },
    stageName(rec) {
      const b = clampBox(rec && rec.box);
      return (b + 1) + " 号盒 · " + this.boxes[b] + " 天后";
    }
  },

  sm2: {
    key: "sm2",
    name: "SM-2",
    short: "SM-2",
    sub: "按 SM-2 复习",
    years: "1987 · 间隔 × 简易度",
    blurb: "按简易度拉长间隔",
    free: false,
    firstIntervals: [1, 3, 7],
    DEFAULT_EF: 2.5,
    MIN_EF: 1.3,
    grades: { bad: 1, fuzzy: 3, good: 5 },
    init() {
      return { level: 1, interval: 0, ef: this.DEFAULT_EF };
    },
    efAfter(ef, q) {
      const next = ef + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
      return Math.max(this.MIN_EF, Math.round(next * 100) / 100);
    },
    intervalAfter(interval, ef, passCount) {
      if (passCount <= 1) return this.firstIntervals[0];
      if (passCount === 2) return this.firstIntervals[1];
      if (passCount === 3) return this.firstIntervals[2];
      return Math.max(1, Math.round(interval * ef));
    },
    stageName(rec) {
      if (!rec || !rec.learned) return "新学";
      const iv = Math.max(0, Math.round(rec.interval || 0));
      const ef = typeof rec.ef === "number" ? rec.ef : this.DEFAULT_EF;
      return "间隔 " + iv + " 天 · 简易度 " + ef;
    }
  },

  fsrs: {
    key: "fsrs",
    name: "FSRS",
    short: "FSRS",
    sub: "按 FSRS 复习",
    years: "2022 · 难度 / 稳定性",
    blurb: "按难度与稳定天数排期",
    free: false,
    params: {
      initS: { bad: 1, fuzzy: 3, good: 6 },
      initD: 5,
      dStep: { bad: 1.6, fuzzy: 0.6, good: -0.6 },
      minD: 1,
      maxD: 10,
      goodGain: 2.4,
      minS: 1
    },
    init() {
      return { level: 1, difficulty: this.params.initD, stability: this.params.initS.good };
    },
    retrievability(stability, elapsedDays) {
      const s = Math.max(this.params.minS, stability || this.params.minS);
      const t = Math.max(0, elapsedDays || 0);
      return Math.pow(2, -t / s);
    },
    intervalOf(stability, target) {
      const rt = target || 0.9;
      const days = stability * (Math.log(1 / rt) / Math.log(2));
      return Math.max(1, Math.round(days));
    },
    difficultyAfter(d, result) {
      const step = this.params.dStep[result] || 0;
      return Math.max(this.params.minD, Math.min(this.params.maxD, d + step));
    },
    stabilityAfter(s, d, result, rNow) {
      const p = this.params;
      if (result === "bad") return Math.max(p.minS, Math.round(s * 0.4 * 100) / 100);
      const ease = (p.maxD - d) / (p.maxD - p.minD);
      const gain = p.goodGain * (0.5 + ease) * (result === "fuzzy" ? 0.6 : 1);
      const bonus = 1 + (1 - (rNow || 1)) * 0.5;
      return Math.max(p.minS, Math.round(s * gain * bonus * 100) / 100);
    },
    stageName(rec) {
      if (!rec || !rec.learned) return "新学";
      const st = typeof rec.stability === "number" ? Math.round(rec.stability * 10) / 10 : 0;
      const d = typeof rec.difficulty === "number" ? Math.round(rec.difficulty * 10) / 10 : 0;
      return "稳定 " + st + " 天 · 难度 " + d;
    }
  }
};

const ORDER = ["ebbinghaus", "leitner", "sm2", "fsrs"];
const DEFAULT_KEY = "ebbinghaus";

function modelOf(key) {
  return MODELS[ORDER.indexOf(key) >= 0 ? key : DEFAULT_KEY];
}

function adopt(rec, key) {
  const target = modelOf(key);
  const src = rec && typeof rec === "object" ? JSON.parse(JSON.stringify(rec)) : {};
  const out = src;
  out.algo = target.key;

  const learned = !!src.learned;
  const level = typeof src.level === "number" ? clampLevel(src.level) : (learned ? 1 : 0);
  const lapses = typeof src.lapses === "number" ? src.lapses : 0;
  const days = EBBINGHAUS_INTERVALS[level] || 0;

  out.level = level;

  if (target.key === "leitner") {
    out.box = learned ? Math.max(0, Math.min(MODELS.leitner.boxes.length - 1, Math.floor(level / 2))) : 0;
  } else if (target.key === "sm2") {
    out.interval = learned ? Math.max(src.interval || 0, days) : 0;
    out.ef = Math.round(Math.max(1.3, MODELS.sm2.DEFAULT_EF - lapses * 0.1) * 100) / 100;
  } else if (target.key === "fsrs") {
    const s = learned
      ? Math.max(src.stability || 0, src.interval || 0, days || MODELS.fsrs.params.minS)
      : MODELS.fsrs.params.initS.good;
    out.stability = Math.round(s * 100) / 100;
    out.difficulty = Math.round(Math.min(MODELS.fsrs.params.maxD, MODELS.fsrs.params.initD + lapses * 0.5) * 100) / 100;
  }

  return out;
}

function review(rec, result, key, now) {
  const t = now === undefined ? Date.now() : now;
  const modelKey = ORDER.indexOf(key) >= 0 ? key : (rec && ORDER.indexOf(rec.algo) >= 0 ? rec.algo : DEFAULT_KEY);
  const model = modelOf(modelKey);

  let r = rec ? adopt(rec, modelKey) : null;
  if (!r) {
    r = { level: 0, nextReviewAt: t, lastReviewAt: null, reviewCount: 0, lapses: 0, learned: false, history: [] };
    Object.assign(r, model.init());
  }

  r.lastReviewAt = t;
  r.reviewCount = (r.reviewCount || 0) + 1;
  r.learned = true;

  const elapsedDays = rec && rec.lastReviewAt ? Math.max(0, (t - rec.lastReviewAt) / DAY) : 0;

  if (result === "fuzzy") {
    r.nextReviewAt = t + FUZZY_HOURS * HOUR;
    pushHistory(r, result, t);
    return r;
  }

  if (result === "bad") {
    r.lapses = (r.lapses || 0) + 1;
    advance(modelKey, r, result, elapsedDays);
    r.nextReviewAt = t + BAD_MINUTES * MIN;
    pushHistory(r, result, t);
    return r;
  }

  advance(modelKey, r, "good", elapsedDays);
  r.nextReviewAt = dayAt(t, daysFor(modelKey, r));
  pushHistory(r, result, t);
  return r;
}

function advance(modelKey, r, result, elapsedDays) {
  const model = modelOf(modelKey);

  if (modelKey === "ebbinghaus") {
    r.level = result === "good"
      ? Math.min(clampLevel(r.level) + 1, EBBINGHAUS_INTERVALS.length - 1)
      : Math.max(0, clampLevel(r.level) - 1);
    return;
  }

  if (modelKey === "leitner") {
    const b = clampBox(r.box);
    r.box = result === "good" ? Math.min(b + 1, model.boxes.length - 1) : 0;
    r.level = Math.min(9, r.box * 2 + (result === "good" ? 1 : 0));
    return;
  }

  if (modelKey === "sm2") {
    const q = model.grades[result];
    const passed = q >= 3;
    r.ef = model.efAfter(typeof r.ef === "number" ? r.ef : model.DEFAULT_EF, q);
    const passCount = passed ? Math.max(1, Math.min(9, (r.level || 0) + 1)) : 1;
    r.interval = model.intervalAfter(r.interval || 0, r.ef, passCount);
    r.level = passed ? Math.min(9, passCount) : Math.max(1, (r.level || 1) - 1);
    return;
  }

  const ss = typeof r.stability === "number" ? r.stability : model.params.initS.good;
  const dd = typeof r.difficulty === "number" ? r.difficulty : model.params.initD;
  const rNow = model.retrievability(ss, elapsedDays);
  r.stability = model.stabilityAfter(ss, dd, result, rNow);
  r.difficulty = model.difficultyAfter(dd, result);
  r.level = result === "good"
    ? Math.min(9, (r.level || 0) + 1)
    : Math.max(1, (r.level || 1) - 1);
}

function daysFor(modelKey, r) {
  const model = modelOf(modelKey);
  if (modelKey === "ebbinghaus") return model.intervalDays(r.level);
  if (modelKey === "leitner") return model.intervalDays(r.box);
  if (modelKey === "sm2") return Math.max(1, r.interval || 1);
  return model.intervalOf(r.stability);
}

function pushHistory(r, result, t) {
  if (!Array.isArray(r.history)) r.history = [];
  // 只留最近 20 次，否则背一年的条目会把这个 key 撑爆
  r.history.push({ at: t, result, level: r.level });
  if (r.history.length > 20) r.history = r.history.slice(-20);
}

/** 结果提示语：只说一件事 —— 下一次什么时候复习。
    用户 2026-10-03 的原话：「背得怎么样是什么不专业的词汇？我需要所有页面
    的标题，选项，设置，内容都专业，精简」。这三句原来是「有点模糊，…」
    「没关系，…」「记住了！下次复习：…」—— 每条前面都挂着一句情绪垫话，
    而用户真正要看的是那个时刻。删掉垫话，留读数。 */
function resultHint(key, result, rec) {
  if (result === "fuzzy") return FUZZY_HOURS + " 小时后再复习";
  if (result === "bad") return BAD_MINUTES + " 分钟后再复习";
  if (!rec || !rec.nextReviewAt) return "已记录";
  const d = new Date(rec.nextReviewAt);
  return "下次复习：" + (d.getMonth() + 1) + " 月 " + d.getDate() + " 日";
}

/** 可见算法列表：小程序端不做付费分层，四套全开放 */
function list() {
  return ORDER.map((k) => {
    const m = MODELS[k];
    return {
      key: m.key,
      name: m.name,
      short: m.short,
      sub: m.sub,
      years: m.years,
      blurb: m.blurb
    };
  });
}

module.exports = {
  DAY,
  HOUR,
  MIN,
  EBBINGHAUS_INTERVALS,
  ORDER,
  DEFAULT_KEY,
  MODELS,
  modelOf,
  adopt,
  review,
  resultHint,
  startOfDay,
  dayAt,
  clampLevel,
  list,
  stageName: (rec, key) => modelOf(key).stageName(rec)
};
