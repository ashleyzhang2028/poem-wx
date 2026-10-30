const MARKS = [
  { from: 100, said: "十道皆中，古人的句子，您都接得住。" },
  { from: 90, said: "只差一处，月色近满。" },
  { from: 80, said: "底子扎得实，再收一收。" },
  { from: 60, said: "路子是通的，火候未到。" },
  { from: 1, said: "错得不少，题却都还认得。" },
  { from: 0, said: "一题未中，这一场也照样算数。" }
];

const KEEP = {
  100: ["满卷无遗，千载诗心与君相认。", "卷上无错字，笔下尽是诗。"],
  90: ["八九不离，剩下的交给时日。", "几处失误，抵不过满纸的熟。"],
  80: ["错的那一题，恰是下次的长进。", "差之毫厘，再念几遍便稳了。"],
  60: ["诗已入心，只欠一遍细读。", "半卷寒山，半卷春色，皆在途中。"],
  40: ["认得一半，欠一半火候。", "今日之误，明日之熟。"],
  0: ["今日先识数句，明日再识数句。", "不认得，才值得认识。"]
};

const STREAK = {
  3: "连对三句，已是旧相识。",
  5: "五句相接，古人的话顺着您的话往下走。",
  10: "十句不歇，这不是运气。",
  20: "二十句，您已在诗里住下了。",
  30: "三十句，这已是本事。"
};

const LING = {
  14: [
    "连吟如贯，胸藏千章。此令酣畅，后会有期。",
    "应对从容，行云无滞。诗心如是，当为雅客。"
  ],
  9: [
    "气象初成，偶作停顿，诗思未竭。",
    "令下有得，句蕴春风。精进少许，一气贯通。"
  ],
  5: [
    "路径已明，句待熟诵。时时温习，随口可成。",
    "中途得句，足见勤功。细加研读，渐至盈篇。"
  ],
  1: [
    "起手稍缓，已入雅境。日日积累，不必匆促。",
    "初接片语，即是开端。诗书久浸，眼界自宽。"
  ],
  0: [
    "一时难续，所得非虚。广储诗章，重赴飞花。",
    "令字虽难，自此启学。勤加记诵，终可应答。"
  ]
};

const LING_FROM = [14, 9, 5, 1, 0];

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
  return hit ? "连对 " + n + " 句，再接再厉。" : "";
}

function ofRun(answered, correct) {
  if (!answered || answered !== correct) return "";
  if (answered === 3) return "连中三道，手已热了。";
  return "连中 " + answered + " 道，笔未曾停。";
}

function ofQuit(answered, total) {
  if (!answered) return "白卷交出，下回先识数句亦可。";
  if (answered < total) return "尚有 " + (total - answered) + " 题未答，不答不得分。";
  return "";
}

const SAY = {
  hit: ["对上了", "接住了", "这一句，是您的了", "和古人对上了"],
  char: ["这一句里没有这个字。", "字未入句，再寻一次。"],
  empty: ["先写一句诗。", "一句未出，纸上还空。"],
  short: ["字数不足，诗句须四字以上。", "再写长些，才认得出是诗。"],
  said: ["这一句方才说过了。", "旧句不重出，换一句。"],
  absent: ["这一句不在诗文集里。", "未能对上，请换一句。"]
};

function _cheer_lingFrom(n) {
  return LING_FROM.find((f) => n >= f);
}

function ofLing(said, seed) {
  const n = Math.max(0, Math.floor(said) || 0);
  return _cheer_pick(LING[_cheer_lingFrom(n)], seed);
}

function ofSay(why, seed) {
  return _cheer_pick(SAY[why] || SAY.absent, seed);
}

module.exports = {
  MARKS,
  KEEP,
  STREAK,
  LING,
  SAY,
  ofScore,
  ofStreak,
  ofRun,
  ofQuit,
  ofLing,
  ofSay
};
