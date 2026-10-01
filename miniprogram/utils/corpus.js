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
 * ⚠️ 这里刻意**不做**一份全站索引缓存：5575 条攒成一个大对象会让主包多出近 1MB，
 * 而各集子索引本来就有同一份数据。全站检索逐集子遍历，
 * 按 id 查条目靠 indexById()。
 */
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

/** 单部集子的完整索引 */
function ofBook(bookId) {
  if (!bookCache[bookId]) bookCache[bookId] = loadJson(BOOKS_DIR + bookId + ".json");
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
 * @param {Object} [opt] book（限定集子）/ limit
 */
function search(keyword, opt) {
  const kw = String(keyword || "").trim().toLowerCase();
  if (!kw) return [];
  const bookId = opt && opt.book;
  const limit = (opt && opt.limit) || 60;
  const sources = bookId ? [bookId] : books().map((b) => b.id);
  const hit = [];

  for (let s = 0; s < sources.length && hit.length < limit; s++) {
    const pool = ofBook(sources[s]);
    for (let i = 0; i < pool.length && hit.length < limit; i++) {
      if (matchEntry(pool[i], kw)) hit.push(pool[i]);
    }
  }
  return hit;
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
  books,
  bookById,
  ownerOf,
  ofBook,
  course,
  courseTexts,
  manifest,
  bucketOf,
  entry,
  entries,
  indexById,
  search,
  grouped,
  matchEntry
};
