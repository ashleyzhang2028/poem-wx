const STAGES = [
  { key: "all", name: "全部" },
  { key: "primary", name: "小学" },
  { key: "middle", name: "初中" },
  { key: "high", name: "高中" }
];

const STAGE_GRADES = {
  primary: [1, 2, 3, 4, 5, 6],
  middle: [7, 8, 9],
  high: [10, 11, 12]
};

const GRADE_NAMES = {
  1: "一年级", 2: "二年级", 3: "三年级", 4: "四年级",
  5: "五年级", 6: "六年级", 7: "七年级", 8: "八年级",
  9: "九年级", 10: "高一", 11: "高二", 12: "高三"
};

const PERIODS = [
  { key: "day", name: "今日" },
  { key: "week", name: "本周" },
  { key: "month", name: "本月" },
  { key: "year", name: "今年" }
];

const GAMES = [
  { key: "exam", name: "考试榜" },
  { key: "fly", name: "飞花令榜" }
];

const MEDALS = [
  { rank: 1, title: "状元", mark: "魁" },
  { rank: 2, title: "榜眼", mark: "亚" },
  { rank: 3, title: "探花", mark: "季" }
];

const DEFAULT_SIZE = 100;

function stageOfGrade(grade) {
  const g = Number(grade) || 0;
  const hit = Object.keys(STAGE_GRADES).filter((k) => STAGE_GRADES[k].indexOf(g) >= 0)[0];
  return hit || "all";
}

function stageName(key) {
  return (STAGES.filter((s) => s.key === key)[0] || STAGES[0]).name;
}

function gradesOf(stage) {
  const list = STAGE_GRADES[stage];
  if (!list) return [];
  return list.map((g) => ({ key: g, name: GRADE_NAMES[g] }));
}

function gradeName(grade) {
  return GRADE_NAMES[Number(grade)] || "";
}

function periodName(key) {
  return (PERIODS.filter((p) => p.key === key)[0] || PERIODS[0]).name;
}

function selfGrade(settings) {
  const grade = Number(settings && settings.grade) || 1;
  return { grade: grade, term: Number(settings && settings.term) || 1, stage: stageOfGrade(grade) };
}

function queryOf(input) {
  const s = input || {};
  const stage = STAGES.filter((x) => x.key === s.stage)[0] ? s.stage : "all";
  const period = PERIODS.filter((x) => x.key === s.period)[0] ? s.period : "day";
  return {
    stage: stage,
    period: period,
    grade: stage === "all" ? 0 : Number(s.grade) || 0,
    term: stage === "all" ? 0 : Number(s.term) || 0
  };
}

function labelOf(q) {
  const query = queryOf(q);
  if (query.stage === "all") return "全部学段";
  const g = query.grade ? gradeName(query.grade) : "";
  const t = g && query.term ? (query.term === 1 ? "上册" : "下册") : "";
  return stageName(query.stage) + (g || t ? " · " + g + t : "");
}

function maskNick(raw, uid) {
  const name = String(raw == null ? "" : raw).replace(/\s+/g, "");
  if (/^.[*]{2}.?$/.test(name)) return name;
  const chars = Array.from(name || ("诗友" + String(uid || "").slice(-4)));
  if (chars.length === 1) return chars[0] + "**";
  return chars[0] + "**" + chars[chars.length - 1];
}

function maskRow(row) {
  const r = row || {};
  const nick = String(r.nick == null ? "" : r.nick);
  return Object.assign({}, r, { nick: nick ? maskNick(nick) : "" });
}

function podiumOf(board) {
  const rows = board || [];
  const byRank = {};
  rows.forEach((r) => {
    if (r.rank >= 1 && r.rank <= 3 && !byRank[r.rank]) byRank[r.rank] = r;
  });
  return MEDALS.map((m) => {
    const r = byRank[m.rank];
    return {
      rank: m.rank,
      title: m.title,
      mark: m.mark,
      filled: !!r,
      tied: !!r && rows.filter((x) => x.rank === m.rank).length > 1,
      nick: r ? r.nick : "",
      score: r ? r.score : 0,
      total: r ? r.total : 0
    };
  });
}

function restOf(board) {
  return (board || []).filter((r) => r.rank > 3);
}

function beyondOf(board, size, total) {
  const rows = board || [];
  if (!rows.length) return 0;
  return Math.max(0, (Number(total) || 0) - rows.length);
}

function emptyOf(game) {
  return {
    exam: { mark: "榜", text: "这一档还没有成绩", tip: "考一回，成绩自己上榜" },
    fly: { mark: "令", text: "这一档还没有接句", tip: "接上一句，成绩自己上榜" }
  }[game] || { mark: "榜", text: "这一档还没有成绩", tip: "" };
}

module.exports = {
  STAGES,
  PERIODS,
  GAMES,
  MEDALS,
  DEFAULT_SIZE,
  STAGE_GRADES,
  stageOfGrade,
  stageName,
  gradesOf,
  gradeName,
  periodName,
  selfGrade,
  queryOf,
  labelOf,
  maskNick,
  maskRow,
  podiumOf,
  restOf,
  beyondOf,
  emptyOf
};
