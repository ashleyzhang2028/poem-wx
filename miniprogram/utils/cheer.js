const MARKS = [
  { from: 100, said: "全对。这一把没有漏网的。" },
  { from: 90, said: "差一点满分。" },
  { from: 80, said: "底子在，再收一收就够。" },
  { from: 60, said: "过了及格线。" },
  { from: 1, said: "错得不少。" },
  { from: 0, said: "这回一题没对，也照样算数。" }
];

const KEEP = {
  100: ["十道全中，古人的句子你接得住了。", "满分不常有，今天这一次是你的。"],
  90: ["稳得住，已经是好成绩。", "再收一格就够到顶了。"],
  80: ["错的那两道，正是下次的长进。", "底子扎得实，往上抬一抬就到顶。"],
  60: ["别停在这儿，抬一抬就稳了。", "还有一半的路，走起来并不远。"],
  40: ["分不高，题都还认得。", "别气馁，背过的字都还在你手里。"],
  0: ["今天先认识这几句，明天再认几句。", "读不出声也不要紧，一题一题地认。"]
};

const STREAK = {
  3: "连对三句，手已经热了。",
  5: "五句了。古人的句子顺着你的话往下走。",
  10: "十句不歇。这不是运气。",
  20: "二十句。你已经在诗里住了。",
  30: "三十句。这已经是本事。"
};

const MILESTONE = 10;

function _cheer_pick(list, seed) {
  const n = Math.abs(Math.floor(seed || 0));
  return list[n % list.length];
}

function _cheer_bucket(pct) {
  if (pct >= 100) return 100;
  if (pct >= 90) return 90;
  if (pct >= 80) return 80;
  if (pct >= 60) return 60;
  if (pct >= 40) return 40;
  return 0;
}

function _cheer_mark(pct) {
  const p = Math.max(0, Math.min(100, Math.round(pct) || 0));
  return MARKS.find((m) => p >= m.from);
}

function ofScore(pct, seed) {
  const p = Math.max(0, Math.min(100, Math.round(pct) || 0));
  return _cheer_mark(p).said + _cheer_pick(KEEP[_cheer_bucket(p)], seed);
}

function ofStreak(n) {
  const hit = (n || 0) >= MILESTONE && n % MILESTONE === 0;
  if (STREAK[n]) return STREAK[n];
  return hit ? "连对 " + n + " 句。接着来。" : "";
}

function ofRun(answered, correct) {
  if (!answered || answered !== correct) return "";
  if (answered === 3) return "连中三道。手感回来了。";
  return "连中 " + answered + " 道。别停。";
}

function ofQuit(answered, total) {
  if (!answered) return "交了白卷。下一回先认两三句也好。";
  if (answered < total) return "还剩 " + (total - answered) + " 题空着，不答不得分。";
  return "";
}

module.exports = { MARKS, KEEP, STREAK, ofScore, ofStreak, ofRun, ofQuit };
