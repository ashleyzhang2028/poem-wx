const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

const NEXT_DAY_HOUR = 0;

const EBBINGHAUS_INTERVALS = [0, 1, 2, 4, 7, 15, 30, 60, 120, 240];

const LEVEL_MAX = 9;

const MASTERED_PERCENT = 80;

function startOfDay(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function dayAt(ts, days) {
  return startOfDay(ts) + days * DAY + NEXT_DAY_HOUR * HOUR;
}

function nextSlot(ts) {
  const ahead = Math.ceil((ts + NEXT_DAY_HOUR * HOUR - dayAt(ts, 1)) / DAY);
  return dayAt(ts, Math.max(1, ahead) + 1);
}

function clampLevel(lv) {
  const n = typeof lv === "number" && isFinite(lv) ? Math.round(lv) : 0;
  return Math.max(0, Math.min(n, LEVEL_MAX));
}

function mastery(rec) {
  if (!rec || !rec.learned) return 0;
  return Math.round((clampLevel(rec.level) / LEVEL_MAX) * 100);
}

function mastered(rec) {
  return mastery(rec) >= MASTERED_PERCENT;
}

function levelName(level) {
  const lv = clampLevel(level);
  return lv >= LEVEL_MAX ? "已牢固" : lv + " / " + LEVEL_MAX;
}

function clampBox(b) {
  const n = typeof b === "number" && isFinite(b) ? Math.round(b) : 0;
  return Math.max(0, Math.min(n, MODELS.leitner.boxes.length - 1));
}

const MODELS = {
  ebbinghaus: {
    key: "ebbinghaus",
    name: "艾宾浩斯 (Ebbinghaus)",
    years: "1885 · 固定间隔",
    free: true,
    init: () => ({ level: 0 }),
    intervalDays: (level) => EBBINGHAUS_INTERVALS[clampLevel(level)],
    stageName(rec) {
      const names = EBBINGHAUS_INTERVALS.map((d, i) => (i ? d + " 天后" : "新学"));
      names[names.length - 1] = "已牢固";
      return names[clampLevel(rec && rec.level)] || "新学";
    },
    describe() {
      const table = EBBINGHAUS_INTERVALS.slice(1).join(" → ");
      const last = EBBINGHAUS_INTERVALS[EBBINGHAUS_INTERVALS.length - 1];
      return [
        "记住进下一格，记错退一格",
        "间隔按固定表走：" + table + " 天",
        "到 " + last + " 天不再往后"
      ];
    }
  },

  leitner: {
    key: "leitner",
    name: "莱特纳盒 (Leitner Box)",
    years: "1972 · 分级盒子",
    free: true,
    boxes: [1, 2, 4, 8, 16],
    init: () => ({ box: 0 }),
    intervalDays(box) {
      return this.boxes[clampBox(box)];
    },
    stageName(rec) {
      if (!rec || !rec.learned) return "新学";
      const b = clampBox(rec.box);
      return (b + 1) + " 号盒 · " + this.boxes[b] + " 天后";
    },
    describe() {
      const n = this.boxes.length;
      return [
        "记住进下一盒，记错退回第 1 盒",
        "共 " + n + " 盒：" + this.boxes.join(" / ") + " 天",
        "第 " + n + " 盒答对则保持不动"
      ];
    }
  },

  sm2: {
    key: "sm2",
    name: "SM-2 (SuperMemo 2)",
    years: "1987 · 间隔 × 简易度",
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
    },
    describe() {
      const first = this.steps().slice(0, this.firstIntervals.length);
      return [
        "新卡记住：" + first.join(" → ") + " 天",
        "之后每次间隔 × 简易度",
        "记错退回 " + this.firstIntervals[0] + " 天，简易度最低压到 " + this.MIN_EF
      ];
    },
    steps() {
      const out = [];
      let r = null;
      let t = 0;
      for (let i = 0; i <= this.firstIntervals.length; i++) {
        r = review(r, "good", "sm2", t);
        out.push(r.interval);
        t = r.nextReviewAt + DAY;
      }
      return out;
    }
  },

  fsrs: {
    key: "fsrs",
    name: "FSRS (自由间隔重复调度)",
    years: "2022 · 难度 / 稳定性",
    free: false,
    params: {
      initS: { bad: 1, fuzzy: 3, good: 6 },
      initD: 5,
      dStep: { bad: 1.6, fuzzy: 0.6, good: -0.6 },
      minD: 1,
      maxD: 10,
      goodGain: 2.4,
      minS: 1,
      maxInterval: 365
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
      return Math.min(this.params.maxInterval, Math.max(1, Math.round(days)));
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
    },
    describe() {
      return [
        "稳定天数越厚，间隔越长",
        "临近遗忘即提前复习",
        "难度 1 到 " + this.params.maxD + "，记错加难度"
      ];
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

function dayStamp(ts) {
  const d = new Date(ts);
  const mm = String(d.getMonth() + 1);
  const dd = String(d.getDate());
  return d.getFullYear() + "-" + (mm.length < 2 ? "0" + mm : mm) + "-" + (dd.length < 2 ? "0" + dd : dd);
}

function reviewedToday(rec, t) {
  if (!rec || !rec.reviewedOn) return false;
  return rec.reviewedOn === dayStamp(t);
}

function markOf(rec, t) {
  if (!rec || !reviewedToday(rec, t)) return null;
  const last = (rec.history || [])[rec.history.length - 1] || null;
  return {
    day: rec.reviewedOn,
    reviewCount: rec.reviewCount || 0,
    covered: !!(last && last.dayCovered)
  };
}

const DAY_BASE_FIELDS = ["level", "box", "interval", "ef", "stability", "difficulty", "lapses", "learned", "nextReviewAt", "lastReviewAt"];

function dayBaseOf(rec, day) {
  if (!rec) return { day: day, fresh: true };
  const fields = {};
  DAY_BASE_FIELDS.forEach((k) => { if (rec[k] !== undefined) fields[k] = rec[k]; });
  return { day: day, fields: fields };
}

function restoreDayBase(rec, saved) {
  const out = JSON.parse(JSON.stringify(rec));
  DAY_BASE_FIELDS.forEach((k) => { delete out[k]; });
  Object.assign(out, saved.fields);
  out.history = (out.history || []).slice(0, -1);
  out.reviewCount = Math.max(0, (out.reviewCount || 0) - 1);
  return out;
}

function undoMark(rec, mark) {
  const undone = JSON.parse(JSON.stringify(rec));
  if (!mark) return undone;

  const last = (undone.history || [])[undone.history.length - 1];
  undone.history = (undone.history || []).slice(0, -1);
  if (last && last.result === "bad") undone.lapses = Math.max(0, (undone.lapses || 0) - 1);
  if (last && last.level !== undefined) undone.level = last.level;
  undone.reviewCount = Math.max(0, (undone.reviewCount || 0) - 1);
  return undone;
}

function review(rec, result, key, now) {
  const t = now === undefined ? Date.now() : now;
  const modelKey = ORDER.indexOf(key) >= 0 ? key : (rec && ORDER.indexOf(rec.algo) >= 0 ? rec.algo : DEFAULT_KEY);
  const model = modelOf(modelKey);

  const mark = markOf(rec, t);
  const saved = mark && rec.dayBase && rec.dayBase.day === mark.day ? rec.dayBase : null;
  let base = null;
  if (saved && saved.fresh) base = null;
  else if (saved) base = adopt(restoreDayBase(rec, saved), modelKey);
  else if (rec) base = adopt(undoMark(rec, mark), modelKey);
  const dayBase = saved || (mark ? null : dayBaseOf(base, dayStamp(t)));

  let r = base;
  if (!r) {
    r = { level: 0, nextReviewAt: t, lastReviewAt: null, reviewCount: 0, lapses: 0, learned: false, history: [] };
    Object.assign(r, model.init());
  }

  r.lastReviewAt = t;
  r.reviewCount = mark ? mark.reviewCount : (r.reviewCount || 0) + 1;
  r.learned = true;
  r.reviewedOn = dayStamp(t);
  if (dayBase) r.dayBase = dayBase;
  else delete r.dayBase;

  const spot = r;

  const elapsedDays = spot.lastReviewAt ? Math.max(0, (t - spot.lastReviewAt) / DAY) : 0;
  const levelBefore = base ? base.level : 0;

  if (result === "fuzzy") {
    r.nextReviewAt = nextSlot(t);
    pushHistory(r, result, t, levelBefore, mark);
    return r;
  }

  if (result === "bad") {
    r.lapses = (r.lapses || 0) + 1;
    advance(modelKey, r, result, elapsedDays);
    r.nextReviewAt = nextSlot(t);
    pushHistory(r, result, t, levelBefore, mark);
    return r;
  }

  advance(modelKey, r, "good", elapsedDays);
  r.nextReviewAt = dayAt(t, daysFor(modelKey, r));
  pushHistory(r, result, t, levelBefore, mark);
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

function pushHistory(r, result, t, level, mark) {
  if (!Array.isArray(r.history)) r.history = [];

  const entry = { at: t, result, level: level === undefined ? r.level : level };
  const last = r.history[r.history.length - 1];

  if (mark) entry.dayCovered = mark.covered && last ? String(last.dayCovered) : mark.day;
  r.history.push(entry);
  if (r.history.length > 20) r.history = r.history.slice(-20);
}

function replacedToday(rec, t) {
  const last = (rec && rec.history && rec.history[rec.history.length - 1]) || null;
  return !!(last && last.dayCovered && reviewedToday(rec, t));
}

function resultHint(key, result, rec) {
  if (!rec || !rec.nextReviewAt) return "已记录";
  const d = new Date(rec.nextReviewAt);
  return "复诵：" + (d.getMonth() + 1) + "月" + d.getDate() + "日";
}

function list() {
  return ORDER.map((k) => {
    const m = MODELS[k];
    return {
      key: m.key,
      name: m.name,
      years: m.years,
      describe: m.describe()
    };
  });
}

module.exports = {
  DAY,
  HOUR,
  dayStamp,
  dayAt,
  daysFor,
  EBBINGHAUS_INTERVALS,
  LEVEL_MAX,
  MASTERED_PERCENT,
  mastery,
  mastered,
  levelName,
  ORDER,
  DEFAULT_KEY,
  MODELS,
  modelOf,
  adopt,
  review,
  reviewedToday,
  replacedToday,
  resultHint,
  startOfDay,
  dayAt,
  clampLevel,
  list,
  stageName: (rec, key) => modelOf(key).stageName(rec)
};
