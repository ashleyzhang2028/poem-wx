/**
 * 飞花令。
 *
 * 一条路：给一个令字，用户自己写一句带这个字的诗，判定对错。
 *   - 令字**随机**从当前背诵范围里出（不是给一排字让用户挑）；
 *   - 作答扫**全部课内语料**判定 —— 范围只管令字（题），不管作答（答）。
 *
 * 为什么范围只管令字：真飞花令里令字是定死的（这一轮就对这一个字），
 * 而答的那一句来自你记得的诗词，没人管你背的那首在不在范围内。
 * 拿范围去卡作答，会把一句真诗判成「没有这一句」——那不是飞花令，是背范围。
 * （口径与 poem 网页版 §4.118「飞花令：范围只管令字」一致。）
 *
 * 令字池与作答池都取课内 251 首：课外正文要走 CDN，冷启动顶不住；
 * 而飞花令这个玩法本来就是课内诗文。作答池 = 课内全部，
 * 所以「范围选小学」时令字是小学习题、答案可以是初中那一首 —— 这正是用户要的。
 */
const corpus = require("../corpus");

/** 令字候选按命中数分档（与 poem 网页版同一套阈值） */
const LEVELS = [
  { id: "easy", name: "常见字", min: 25 },
  { id: "normal", name: "一般字", min: 6 },
  { id: "hard", name: "难字", min: 1, max: 5 }
];

/* 断句口径只有一份，在 utils/corpus.js 的 CLAUSE_SPLIT / splitLines ——
   抄第二份出来，计数与实际列出的句子早晚会对不上。 */

/**
 * 取一份正文里的句子。**全模块只有这一条路**。
 *
 * 计数与列表必须走同一个函数，才有「一致」可言：上一版 pool() 自己 split
 * 一遍、look() 又 split 一遍，直到有人发现令字格上写着 346、点进去却列出 477 句 ——
 * 差的正是 pool 里那道长度门槛。
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

/**
 * 全部课内条目（{ id, t, a, d, gr, tm }）。
 * 作答池与令字池都以这一份为底。
 */
function allPoems() {
  return corpus.course();
}

/**
 * 按取诗范围筛出「令字来源」的篇目。
 *
 * 范围的算法**不在这里重算** —— 复用 utils/scheduler.js 的 poolForScope，
 * 与首页「每日背诵」用同一份口径。抄第二份范围口径，首页是小学、飞花令是别的，
 * 早晚对不上（网页版 §3.1 那个「选了小学，答案仍是全部」的 bug 就是这么来的）。
 *
 * @param {Object} [opt] grade / term / scope
 * @returns {Array} 范围内的篇目；范围拉不到东西时退回全部课内
 */
function scopedPoems(opt) {
  const o = opt || {};
  if (!o.scope) return allPoems();
  let S;
  try {
    S = require("../scheduler");
  } catch (e) {
    return allPoems();
  }
  const out = S.poolForScope({
    grade: o.grade,
    term: o.term,
    scope: o.scope,
    allPoems: allPoems()
  });
  return out && out.length ? out : allPoems();
}

let poolCache = null;

/**
 * 攒候选令字池。**全课内**扫一遍 —— 令字候选本身与范围无关，
 * 范围是在出题那一刻用它筛「这个字底下有没有范围内的句子」。
 *
 * @returns {Object} { [char]: { char, count, level } }
 */
function pool() {
  if (poolCache) return poolCache;

  const counts = {};
  allPoems().forEach((p) => {
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
 * 查一查：列出**范围内**含令字的句子。
 *
 * 这是「看答案」那一栏：给用户当前范围里所有能对上的句子。
 * （作答判定走另一条路 —— judge 扫全部课内，见下面。）
 *
 * @param {string} char
 * @param {Object} [opt] limit / scope / grade / term
 * @returns {Array<{id, title, author, dynasty, seg}>}
 */
function look(char, opt) {
  const o = opt || {};
  const ch = String(char || "").trim();
  if (!ch) return [];
  const limit = o.limit || 60;
  const out = [];

  scopedPoems(o).forEach((p) => {
    if (out.length >= limit) return;
    const e = corpus.entry(p.id);
    if (!e || !e.text) return;
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

/** 去标点：用户敲字不会把逗号也敲上 */
function strip(s) {
  return String(s).replace(/[^\u3400-\u9fff]/g, "");
}

/**
 * 判定一条作答。
 *
 * 判据三条都要满足：
 *   1. 句子里有令字
 *   2. 这句话确实出现在**全部课内语料**里（不是自己编的）
 *   3. 没在这一轮里说过
 *
 * 第 2 条扫全部课内、**不按范围收窄** —— 这是「范围只管令字，不管作答」。
 * 用户写的字串与语料里某一句「去掉标点后」相同即算命中，容忍他漏标点、用错标点。
 *
 * @param {string} char 令字
 * @param {string} input 用户写的那一句
 * @param {string[]} [said] 这一轮已经说过的句子（去重）
 * @returns {{ok:boolean, reason?:string, hit?:Object, seg?:string}}
 */
function judge(char, input, said) {
  const ch = String(char || "").trim();
  const raw = String(input || "").trim();
  if (!ch) return { ok: false, reason: "先出一个令字" };
  if (!raw) return { ok: false, reason: "写一句带这个字的诗" };
  if (raw.indexOf(ch) < 0) return { ok: false, reason: "这句里没有「" + ch + "」" };

  const mine = strip(raw);
  if (mine.length < 4) return { ok: false, reason: "太短了，至少写四字" };

  const used = {};
  (said || []).forEach((s) => {
    used[strip(s)] = 1;
  });
  if (used[mine]) return { ok: false, reason: "这一句说过了" };

  // 在**全部课内语料**里找同一句（不按范围收窄）
  let hit = null;
  allPoems().forEach((p) => {
    if (hit) return;
    const e = corpus.entry(p.id);
    if (!e || !e.text) return;
    segsOf(e.text, false).forEach((seg) => {
      if (hit) return;
      if (strip(seg) === mine) hit = { id: p.id, title: p.t, author: p.a, seg: seg };
    });
  });

  if (!hit) {
    return { ok: false, reason: "这一句不在课内诗文集里，换一句试试" };
  }
  return { ok: true, hit, seg: hit.seg };
}

/**
 * 随机出一个令字。
 *
 * 三条约束叠在一起：
 *   1. 令字落在**当前范围**里（范围内的句子里有它）；
 *   2. 档位对得上（常见字 / 一般字 / 难字）；
 *   3. 不被 exclude（这一轮说过的字不重复出）。
 * 三者交集为空时逐级放宽（先放档位、再放范围），保证一定给得出一个字 ——
 * 一个空关比一个字都不出更糟。
 *
 * @param {Object} opt level / scope / grade / term / exclude / avoid
 * @returns {{char:string, count:number, level:string}|null}
 */
function pick(opt) {
  const o = opt || {};
  const inScope = scopedPoems(o);
  const excl = {};
  (o.exclude || []).forEach((c) => {
    excl[c] = 1;
  });

  // 范围内的句子 → 出现过的字
  const inScopeChars = {};
  inScope.forEach((p) => {
    const e = corpus.entry(p.id);
    if (!e || !e.text) return;
    segsOf(e.text).forEach((s) => {
      Array.from(new Set(Array.from(s))).forEach((ch) => {
        if (/[\u3400-\u9fff]/.test(ch)) inScopeChars[ch] = 1;
      });
    });
  });

  const all = pool();
  const lv = levelOf(o.level);

  const match = (scopeOnly, levelOnly) => {
    const list = Object.keys(all)
      .map((c) => all[c])
      .filter((it) => {
        if (excl[it.char]) return false;
        if (scopeOnly && !inScopeChars[it.char]) return false;
        if (levelOnly) {
          if (lv.max ? it.count > lv.max : it.count < lv.min) return false;
        }
        return true;
      });
    return list;
  };

  // 逐级放宽：范围内+档位 → 范围外+档位 → 范围内放任档位 → 全都行
  const tiers = [
    match(true, true),
    match(false, true),
    match(true, false),
    match(false, false)
  ];
  const hits = tiers.find((t) => t.length) || [];
  if (!hits.length) return null;

  const it = hits[Math.floor(Math.random() * hits.length)];
  return { char: it.char, count: it.count, level: it.level };
}

module.exports = {
  LEVELS,
  pool,
  chars,
  levelOf,
  pick,
  scopedPoems,
  look,
  judge
};
