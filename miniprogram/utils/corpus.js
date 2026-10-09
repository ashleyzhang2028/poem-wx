/**
 * 语料读取层。
 *
 * 三层来源，从近到远：
 *   1. 包内 JSON —— 各集子索引（篇名/作者/朝代/出处，不含正文）+ 课内正文
 *   2. 正文分片 —— 课外集子的正文，按哈希桶取用（落地后走云端）
 *   3. 腾讯云 COS + CDN —— 分片清单指向远端时的按需回源（utils/remote.js，暂未接）
 *
 * 分界线是**课内 251 首的正文进主包**（course.json，223KB），因为首页「每日背诵」
 * 与详情页都靠它，不该为一次取文等网络；其余 5300+ 条正文留在分片里，按需取。
 * 索引里仍然**不带正文**，这是主包能压在 2MB 内的前提。
 *
 * ⚠️ 这里刻意**不做**一份全站索引缓存：5599 条攒成一个大对象会让主包多出近 1MB，
 * 而各集子索引本来就有同一份数据。全站检索逐集子遍历，
 * 按 id 查条目靠 indexById()。
 */
/**
 * 断句用的标点 —— **全 app 只此一份**。
 * 飞花令的令字池、逐句朗读、阅读页的分行都用它。抄第二份，两边迟早会对不上。
 */
const CLAUSE_SPLIT = /[\n，。！？；：、]/;

/**
 * 把一段正文切成「行 → 句」。
 *
 * 拿它直接 `split("\n")` 是不等价的：语料里一行往往承好几个句子
 * （《琵琶行》一整段诗序就是一行），整行当一个块排，居中时是一坨、
 * 朗读时整段一起合成。切句之后三种呈现（正文 / 注音 / 朗读）才对齐。
 *
 * 空行**保留成空数组**：那是语料里的一道真换行，不是「什么都没写」。
 *
 * `s` 里的每一句**带尾标点**（`鹅，` 而不是 `鹅`），拼回去就等于 `line`。
 * 想按裸句判定（比如「这两句是不是同一句」），自己去标点，别在这另切一遍。
 *
 * @param {string} text 一份正文
 * @returns {{line: string, s: string[]}[]}
 */
function splitClauses(line) {
  // 切句时把标点**留在上一句的尾巴上**：`鹅，鹅，鹅，` 切成
  // `鹅，` `鹅，` `鹅，`，而不是三个光秃秃的 `鹅`。
  // 丢标点会当场露馅 —— 正文里「鹅鹅鹅」读起来就是缺了一个字。
  const s = [];
  let buf = "";
  for (const ch of String(line)) {
    if (CLAUSE_SPLIT.test(ch)) {
      if (buf.trim()) s.push(buf.trim() + ch);
      buf = "";
    } else {
      buf += ch;
    }
  }
  if (buf.trim()) s.push(buf.trim());
  return s;
}

/**
 * 把一段正文切成「行 → 句」。
 *
 * 拿它直接 `split("\n")` 是不等价的：语料里一行往往承好几个句子
 * （《琵琶行》一整段诗序就是一行、《长恨歌》两句一行）。
 *
 * 空行**保留成空数组**：那是语料里的一道真换行，不是「什么都没写」。
 *
 * `s` 里的每一句**带尾标点**（`鹅，` 而不是 `鹅`），拼回去就等于 `line`。
 * 想按裸句判定（比如「这两句是不是同一句」），自己去标点，别在这另切一遍。
 *
 * @param {string} text 一份正文
 * @returns {{line: string, s: string[]}[]}
 */
function splitLines(text) {
  return String(text == null ? "" : text)
    .split("\n")
    .map((line) => ({ line: line, s: splitClauses(line) }));
}

/* ============================================================
   版式：正文怎么排。
   ============================================================ */

/**
 * 句读标点。与 CLAUSE_SPLIT 的分别：那个**包含换行**，用来切分；
 * 这个只判「一句念完了没有」，所以不含换行。
 *
 * 顿号 `、` 不在里面 —— 它连的是并列的字词（`五花马、千金裘`），
 * 不是句子；整段古文若按它断，会碎成一地词。
 */
const PUNCT_END = /[，。！？；：]/;
const PUNCT_SOFT = /[，、：；]/;

/** 短句搁在一行里不像「一句」，像被切了一半；凑够两行才另起一行 */
const MIN_VERSE = 4;

/** 一行两块是排版的常态（`床前明月光，疑是地上霜。`），不是长诗 */
const MAX_STANZA_BLOCK = 2;
/** 连着的短句超过这个数，再不分段就是一面墙 */
const WALL_RUN = 6;
/** 一段里块数够多却一句也没收尾（整段没有句号），也该分段 */
const RUN_LIMIT = 16;

/**
 * 按句读把一行折开，**行尾必定收在句读上**。
 *
 * 为什么不按「，。！」断：那样《琵琶行》的序会碎成 27 行墙上贴 ——
 * 一行一句读着像诗，句式全然不是。折开之后
 * 「元和十年，」「予左迁九江郡司马。」各占一行，仍是散文的读法。
 *
 * @param {string} line 语料里的一行
 * @returns {string[]} 若干行；拼起来逐字等于 line
 */
function foldClauses(clauses) {
  const out = [];
  let buf = [];
  clauses.forEach((cl) => {
    buf.push(cl);
    // `，` 与 `。` 收行；`！？；：` 也要收 —— 「岂无山歌与村笛，呕哑嘲哳难为听！」
    // 的叹号本来就在句尾。收行点只看**最后一个字**，不看它在行里第几个
    const last = cl[cl.length - 1] || "";
    if (/[，。！？；：]/.test(last)) {
      out.push(buf);
      buf = [];
    }
  });
  if (!buf.length) return out;

  /* 尾巴上那一句没有标点（语料里很常见：`……月承幌而通晖` 就断在那儿）。
     它若自己占一行，读起来像句子被切断了 —— 而且这一行**既不是作者排的、
     也不是我们折的**，是「折到一半停了」。并回上一行，让它跟着前一句走。 */
  if (out.length) {
    out[out.length - 1] = out[out.length - 1].concat(buf);
    return out;
  }
  // 整行都没标点（《乡愁》的「我在这头」）：那它本来就该原样留着
  out.push(buf);
  return out;
}

/**
 * 整行都是短句就不折。
 *
 * `杨柳青青江水平，` 单占一行是七绝的排法，折成
 * `杨柳青青江水` / `平，` 才是真难看。长句才折 ——
 * `元和十年，予左迁九江郡司马。` 是散文的长短句，折开才读得下去。
 */
function shortAll(clauses) {
  return clauses.every((cl) => !verseLike(cl));
}

/** 这一行「看着像不像一句」（不含尾标点） */
function verseLike(seg) {
  return String(seg || "").replace(PUNCT_SOFT, "").length >= MIN_VERSE;
}

/** 一行里有没有「念完了」的落点。分段要按它判，不是按字数 */
function hasStop(rows) {
  return rows.some((seg) => PUNCT_END.test(seg[seg.length - 1] || ""));
}

/**
 * 攒到这儿要不要分段。
 *
 * 两处要分段：一句一行连着排了六行以上（《琵琶行》的序）；
 * 或者这一段里横竖没有落点（《左传》那种对白连段）。
 * **散文的分段是作者的，语料里没有** —— 所以这里只是别让它糊成一片，
 * 不假装还原了原文的段落。
 *
 * @param {string[][][]} cur 这一段已经攒下的行
 * @param {string[][]} next 这一行折出来的行
 * @returns {boolean} 攒完这一行是否要收段
 */
function wallAfter(cur, next) {
  if (!next.length) return false;
  const all = cur.concat(next);
  // 连着几句一行一行排下来
  let run = 0;
  for (let i = all.length - 1; i >= 0; i--) {
    const row = all[i];
    if (row.length === 1 && verseLike(row[0]) && hasStop(row)) run++;
    else break;
  }
  if (run >= WALL_RUN) return true;
  if (all.length >= RUN_LIMIT && hasStop(all[all.length - 1])) return true;
  return false;
}

/**
 * 正文排版。**阅读页的正文 / 注音 / 朗读、飞花令的句子全走它**。
 *
 * 返回值里两个字段各管一件事：
 *   `paras` 段落 → 行 → 句，给**注音与朗读**用（逐字标音、逐句合成都要到句）；
 *   `rows`  拍平的行，给**正文**用（一行一个块，才排得出版式）。
 * 两者都是同一份切分，不会两边对不上。
 *
 * 散文行**保持原样、不折**：折开等于替作者决定句子在哪收，
 * 《左传》《世说新语》那种语料本来就是照原文的句读排的。
 *
 * @param {string} text 一份正文
 * @returns {{rows: string[], paras: string[][][], verse: boolean}}
 */
function layout(text) {
  const lines = splitLines(text);
  const rows = [];
  const paras = [];

  /* 攒一段：把**连续的几行**拼成一段，直到遇上一道空行、或者
     一句一行一路排下去排成了一道墙（长诗的序、长篇对白就这样分段）。
     上一版是「一行一段」—— 四句的绝句会变成四段，每段一行，
     行距叠上段距，一屏排不下四句话。 */
  let cur = [];

  const flush = () => {
    if (cur.length) paras.push(cur);
    cur = [];
  };

  lines.forEach((ln) => {
    if (!ln.s.length) {
      // 空行**保留成空数组**：那是语料里的一道真换行，不是「什么都没写」。
      // 它是作者分的段，段落到此为止
      flush();
      rows.push("");
      return;
    }
    // 一行只有一句、而且这一句够长 —— 作者本来就是这么排的，别动它。
    // 判据用句子而不是原文行：原文行尾可能带空白，拿它判会忽长忽短。
    // 短句（`白毛浮绿水，`）不折：七言拆成两行是反的，它自己就是一行
    const verse = ln.s.length === 1 || shortAll(ln.s);
    const cut = verse ? [ln.s] : foldClauses(ln.s);
    cut.forEach((g) => rows.push(g.join("")));

    // 这一行与上一行之间要不要分段
    const closeHere = wallAfter(cur, cut);
    cur = cur.concat(cut);
    if (closeHere) flush();
  });
  flush();

  // 段落收尾：去掉空段落，也去掉空行留下的尾巴
  while (paras.length && !paras[paras.length - 1].length) paras.pop();
  return { rows: rows, paras: paras, verse: rows.length > lines.length };
}

const BOOKS_DIR = "data/books/";
const COURSE = "data/course.json";
const MANIFEST = "data/texts/manifest.json";

let booksCache = null;
let courseCache = null;
let manifestCache = null;
const bookCache = {};
const bucketCache = {};

/** require 的路径必须字面量，微信的打包器才认，所以这里不能把 rel 拼成变量 */
function loadJson(rel) {
  return require("../" + rel);
}

function books() {
  if (!booksCache) booksCache = loadJson(BOOKS_DIR + "books.json");
  return booksCache;
}

function bookById(id) {
  return books().find((b) => b.id === id) || null;
}

/**
 * 单部集子的完整索引。
 *
 * ⚠️ **这里是 `b` / `n` / `hasT` 三个字段的补回处，只此一处。**
 * 落盘时把它们摘掉了（每个文件里 `b` / `n` 是同一个常数、`hasT` 5854 条
 * 全是 true，三者合计 199KB —— 见 `scripts/build-data.js` 里那段账）。
 * 从这一层往上，条目的形状与从前**一模一样**：列表、检索、阅读、
 * 作者索引、试题，全都走 `ofBook()` / `indexById()`，谁都不必知道这件事。
 *
 * 补的是 `books.json` 里那份 id → 名字的表，不另编一份。
 */
function ofBook(bookId) {
  if (!bookCache[bookId]) {
    const meta = bookById(bookId);
    const rows = loadJson(BOOKS_DIR + bookId + ".json");
    bookCache[bookId] = rows.map(function (p) {
      p.b = bookId;
      p.n = meta ? meta.name : bookId;
      p.hasT = true;
      return p;
    });
  }
  return bookCache[bookId];
}

/** 课内诗词索引：首页每日计划只认这一份 */
function course() {
  return ofBook("poems");
}

/** 课内正文（进主包的那一份），键与分片里的 id 同构 */
function courseTexts() {
  if (!courseCache) courseCache = loadJson(COURSE);
  return courseCache;
}

function manifest() {
  if (!manifestCache) manifestCache = loadJson(MANIFEST);
  return manifestCache;
}

function bucketOf(id) {
  return (manifest().map || {})[id] || "";
}

/** 取一个正文分片 */
function bucket(name) {
  if (!bucketCache[name]) bucketCache[name] = loadJson("data/texts/" + name + ".json");
  return bucketCache[name];
}

/**
 * 取条目正文。课内先查包内那份，命中就不必碰分片。
 * @returns {{text:string, translation:string, src:string}|null}
 */
function entry(id) {
  const inPack = courseTexts()[id];
  if (inPack) return inPack;
  const name = bucketOf(id);
  if (!name) return null;
  return bucket(name)[id] || null;
}

/** 批量取正文，供连读场景用 */
function entries(ids) {
  const out = {};
  (ids || []).forEach((id) => {
    const e = entry(id);
    if (e) out[id] = e;
  });
  return out;
}

/**
 * 按 id 查条目。
 * 集子 id 是条目 id 的前缀（`poems-xx1-01` 属于 `poems`），
 * 所以先按「已知集子里最长的那个前缀」定位，命中一次就够，不必扫全站。
 */
function indexById(id) {
  const owner = ownerOf(id);
  if (!owner) return null;
  const full = ofBook(owner);
  for (let i = 0; i < full.length; i++) {
    if (full[i].id === id) return full[i];
  }
  return null;
}

/** 条目 id 前缀 → 集子 id。集子 id 本身可能带连字符（mingren-waiguo），取最长匹配 */
function ownerOf(id) {
  const all = books();
  let best = "";
  for (let i = 0; i < all.length; i++) {
    const b = all[i].id;
    if (id.indexOf(b + "-") === 0 && b.length > best.length) best = b;
  }
  return best;
}

/**
 * 搜索。默认只搜索引字段 —— 正文不全量常驻内存，全文检索是另一件事。
 *
 * 逐部集子遍历而不是在内存里攒一份全站索引：索引按集子拆开正是为了让
 * 「搜一次」的成本跟命中集子的数量走，而不是跟全站条数走。
 *
 * `total` 是**截断前的命中总数**：界面写「命中 528 篇 · 列出前 80 篇」要靠它，
 * 只报 `items.length` 就是把「我只给你 80 条」说成「全站只有 80 条」。
 * 计数与列举在同一次遍历里做完，为这一个数字多走一遍 5599 条不值当。
 *
 * @param {string} keyword
 * @param {Object} [opt] book（集子 id，空为全站）/ limit
 * @returns {{items: Array, total: number}} total 为截断前总数
 */
function search(keyword, opt) {
  const kw = String(keyword || "").trim().toLowerCase();
  if (!kw) return { items: [], total: 0 };
  const bookId = opt && opt.book;
  const limit = (opt && opt.limit) || 60;
  const sources = bookId ? [bookId] : books().map((b) => b.id);
  const items = [];
  let total = 0;

  for (let s = 0; s < sources.length; s++) {
    const pool = ofBook(sources[s]);
    for (let i = 0; i < pool.length; i++) {
      if (!matchEntry(pool[i], kw)) continue;
      total += 1;
      if (items.length < limit) items.push(pool[i]);
    }
  }
  return { items: items, total: total };
}

function matchEntry(p, kw) {
  return !!(
    (p.t && p.t.toLowerCase().indexOf(kw) >= 0) ||
    (p.a && p.a.toLowerCase().indexOf(kw) >= 0) ||
    (p.d && p.d.toLowerCase().indexOf(kw) >= 0) ||
    (p.s && p.s.toLowerCase().indexOf(kw) >= 0) ||
    (p.g && p.g.toLowerCase().indexOf(kw) >= 0)
  );
}

/** 按分组摊开，列表页的分段显示用它 */
function grouped(list) {
  const order = [];
  const map = {};
  (list || []).forEach((p) => {
    const g = p.g || "";
    if (!map[g]) {
      map[g] = [];
      order.push(g);
    }
    map[g].push(p);
  });
  return order.map((g) => ({ group: g, items: map[g] }));
}

module.exports = {
  CLAUSE_SPLIT,
  splitLines,
  splitClauses,
  layout,
  books,
  bookById,
  ownerOf,
  ofBook,
  course,
  courseTexts,
  manifest,
  bucketOf,
  bucket,
  entry,
  entries,
  indexById,
  search,
  grouped,
  matchEntry
};
