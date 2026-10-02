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

/* 断句口径只有一份，在 utils/corpus.js 的 CLAUSE_SPLIT / splitLines ——
   抄第二份出来，计数与实际列出的句子早晚会对不上。 */

/**
 * 攒候选令字池。
 *
 * 只扫课内 251 首（与网页版的飞花令范围一致）—— 全站扫一遍要读 120 个
 * 正文分片，冷启动顶不住；而「飞花令」这个玩法本来就是课内诗文。
 *
 * @returns {Object} { [char]: { char, count, level } }
 */
/**
 * 取一份正文里的句子。**全模块只有这一条路**。
 *
 * 上一版 pool() 自己 split 一遍、look() 又 split 一遍，两处口径看不出差别，
 * 直到有人发现令字格上写着 346、点进去却列出 477 句 —— 差的正是
 * pool 里那道 `长度 5–20` 的门。计数与列表必须走同一个函数，才有「一致」可言。
 *
 * @param {string} text 一份正文
 * @param {boolean} [gated] 是否套用令字池的长度门槛（默认套用）
 * @returns {string[]} 句子，去标点、去空白
 */
function segsOf(text, gated) {
  const out = [];
  // 同一首里同一句可能出现两次（《蜀道难》「难于上青天」就叠了两回）。
  // 去重要在**篇**这一级做 —— 收进函数里，两边就不会再各漏一次。
  const seen = {};
  corpus.splitLines(text).forEach((ln) => {
    ln.s.forEach((seg) => {
      // 令字池的门槛：太短的没有令字价值，太长的（一段诗序）看着不像「一句」
      if (gated !== false && (seg.length < 5 || seg.length > 20)) return;
      if (seen[seg]) return;
      seen[seg] = 1;
      out.push(seg);
    });
  });
  return out;
}

let poolCache = null;

function pool() {
  if (poolCache) return poolCache;

  const counts = {};
  corpus.course().forEach((p) => {
    const e = corpus.entry(p.id);
    if (!e || !e.text) return;
    segsOf(e.text).forEach((s) => {
      // 一句里同一个字只算一次：「莲叶何田田」里「田」是一个令字，不是两个。
      // 按出现次数累加的话，「天」会算成 99 而查一查只列 97 行 —— 格上的数字
      // 就是「点进去能看到几行」，这个等式不能破。
      const counted = {};
      Array.from(s).forEach((ch) => {
        if (!/[\u3400-\u9fff]/.test(ch) || counted[ch]) return;
        counted[ch] = 1;
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
    // 去重已在 segsOf 里按「篇」做过，这里不必再来一遍
    segsOf(e.text).forEach((s) => {
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
    segsOf(e.text, false).forEach((seg) => {
      if (hit) return;
      if (strip(seg) === mine) hit = { id: p.id, title: p.t, author: p.a, seg: seg };
    });
  });

  if (!hit) {
    return { ok: false, reason: "这一句不在课内 251 首里，换一句试试" };
  }
  return { ok: true, hit, seg: hit.seg };
}

module.exports = { LEVELS, pool, chars, levelOf, look, judge };
