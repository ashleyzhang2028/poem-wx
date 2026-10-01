/**
 * 飞花令。
 *
 * 网页版 js/game.js 有**两种形态**，小程序端都做：
 *   look  「查一查」—— 给一个令字，一次列出全部命中句。当查阅用。
 *   level 「闯关」—— 一个令字一关，自己写一句，写不出就断在那儿。
 *
 * 数据来源是课内正文本身 —— 令字要求出现在**诗句里**，出现在标题里不算，
 * 所以按正文扫，扫到就把整句切出来。
 *
 * 只扫课内 251 首，不碰课外分片：课外正文要走 CDN、并且「飞花令」这个玩法
 * 本来就是课内诗文（与网页版一致）。这也是它能离线玩的原因。
 *
 * 网页版还有「难字 / 一般字 / 常见字」三档，按命中数分：
 *   常见字 ≥25 句、一般字 ≥6 句、难字 <6 句 且要冷僻。
 * 同一套阈值搬过来。
 */
const corpus = require("../corpus");

/** 令字候选。网页版从题库统计里挑高频字，这里按课内正文的命中数动态算 */
const LEVELS = [
  { id: "easy", name: "常见字", min: 25 },
  { id: "normal", name: "一般字", min: 6 },
  { id: "hard", name: "难字", min: 1, max: 5 }
];

/** 断句用的标点。与 utils/quiz.js 同一套 */
const SPLIT = /[\n，。！？；：、]/;

/**
 * 攒候选令字池。
 *
 * 只扫课内 251 首（与网页版的飞花令范围一致）—— 全站扫一遍要读 120 个
 * 正文分片，冷启动顶不住；而「飞花令」这个玩法本来就是课内诗文。
 *
 * @returns {Object} { [char]: { char, count, level } }
 */
let poolCache = null;

function pool() {
  if (poolCache) return poolCache;

  const counts = {};
  corpus.course().forEach((p) => {
    const e = corpus.entry(p.id);
    if (!e || !e.text) return;
    const seen = {};
    String(e.text)
      .split(SPLIT)
      .forEach((seg) => {
        const s = seg.trim();
        if (s.length < 5 || s.length > 20) return;
        Array.from(s).forEach((ch) => {
          // 只收汉字，且一个字每句只算一次
          if (!/[\u3400-\u9fff]/.test(ch) || seen[ch] === s) return;
          seen[ch] = s;
          counts[ch] = (counts[ch] || 0) + 1;
        });
      });
  });

  const out = {};
  Object.keys(counts).forEach((ch) => {
    const n = counts[ch];
    const level = n >= 25 ? "easy" : n >= 6 ? "normal" : "hard";
    out[ch] = { char: ch, count: n, level };
  });
  poolCache = out;
  return out;
}

/** 按档位取令字。难字档要冷僻，所以从命中 1–5 句的里面挑 */
function chars(levelId, limit) {
  const all = pool();
  const lv = LEVELS.find((l) => l.id === levelId) || LEVELS[1];
  const list = Object.keys(all)
    .map((c) => all[c])
    .filter((it) => (lv.max ? it.count <= lv.max : it.count >= lv.min))
    .sort((a, b) => b.count - a.count);
  return list.slice(0, limit || 24);
}

function levelOf(id) {
  return LEVELS.find((l) => l.id === id) || LEVELS[1];
}

/**
 * 查一查：列出全部含令字的句子。
 * @param {string} char
 * @param {Object} [opt] limit
 * @returns {Array<{id, title, author, dynasty, seg}>}
 */
function look(char, opt) {
  const ch = String(char || "").trim();
  if (!ch) return [];
  const limit = (opt && opt.limit) || 60;
  const out = [];

  corpus.course().forEach((p) => {
    if (out.length >= limit) return;
    const e = corpus.entry(p.id);
    if (!e || !e.text) return;
    String(e.text)
      .split(SPLIT)
      .forEach((seg) => {
        const s = seg.trim();
        if (out.length >= limit || s.indexOf(ch) < 0) return;
        out.push({
          id: p.id,
          title: p.t,
          author: p.a,
          dynasty: p.d,
          seg: s
        });
      });
  });

  return out;
}

/**
 * 闯关：给一个令字，判定用户写的句子算不算过。
 *
 * 判据与网页版一致，三条都要满足：
 *   1. 句子里有令字
 *   2. 这句话确实出现在语料里（不是自己编的）
 *   3. 没在这一关里说过
 *
 * 第 2 条是关键 —— 飞花令不是自由创作，是背诵比赛。用户写的字串与语料里
 * 某一句「去掉标点后」相同即算命中，容忍他漏标点、用错标点。
 */
function judge(char, input, said) {
  const ch = String(char || "").trim();
  const raw = String(input || "").trim();
  if (!ch) return { ok: false, reason: "先选一个令字" };
  if (!raw) return { ok: false, reason: "写一句带这个字的诗" };
  if (raw.indexOf(ch) < 0) return { ok: false, reason: "这句里没有「" + ch + "」" };

  const strip = (s) => String(s).replace(/[^\u3400-\u9fff]/g, "");
  const mine = strip(raw);
  if (mine.length < 4) return { ok: false, reason: "太短了，至少写四字" };

  const used = {};
  (said || []).forEach((s) => {
    used[strip(s)] = 1;
  });
  if (used[mine]) return { ok: false, reason: "这一句说过了" };

  // 在语料里找同一句
  let hit = null;
  corpus.course().forEach((p) => {
    if (hit) return;
    const e = corpus.entry(p.id);
    if (!e || !e.text) return;
    String(e.text)
      .split(SPLIT)
      .forEach((seg) => {
        if (hit) return;
        if (strip(seg) === mine) hit = { id: p.id, title: p.t, author: p.a, seg: seg.trim() };
      });
  });

  if (!hit) {
    return { ok: false, reason: "这一句不在课内 251 首里，换一句试试" };
  }
  return { ok: true, hit, seg: hit.seg };
}

module.exports = { LEVELS, pool, chars, levelOf, look, judge };
