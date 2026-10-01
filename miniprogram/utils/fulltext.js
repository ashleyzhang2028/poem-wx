/**
 * 正文全文检索。
 *
 * 索引字段搜索（corpus.search）搜不到正文里的字 —— 用户搜「明月几时有」，
 * 那是正文，索引里没有，一无所获。所以另做一层：
 *
 *   把全站正文首尾相接铺成一条位次长串，对每个字记下它出现的所有位次，
 *   按固定跨度切成列文件。搜「明月几时有」= 找五个字的位次里连续的 5 个位置。
 *
 * 长串是**全站**的，不是按集子拼的，所以子串永远跨不过条目边界 —— 相邻两条
 * 正文既不连续，凑出来的假命中也不会出现。
 *
 * 位次 → 条目的换算靠清单里的 base[]：第 i 条起点是 base[i]，长度是
 * base[i+1] - base[i]。二分一下就知道命中落在哪一条。
 *
 * 体积与请求的取舍见 scripts/build-data.js 的 COL_SPAN：一列 64K 位次、
 * 约 440KB，全站 44 列。只有第一次搜才拉，之后落本机缓存；拉不到就退回
 * 索引字段搜索，并把「这次没搜正文」如实告诉调用方。
 */
const corpus = require("./corpus");

/** 与 scripts/build-data.js 的 COL_SPAN 必须一致；运行时以清单里的 colSpan 为准 */
const COL_SPAN_DEFAULT = 65536;

let manifest = null;
let base = null;
const cols = {};
const loading = {};

function spec() {
  if (!manifest) manifest = corpus.fulltextManifest();
  return manifest;
}

function colSpan() {
  return spec().colSpan || COL_SPAN_DEFAULT;
}

/** 第 i 条正文的位次起点 / 长度 */
function spanOf(i) {
  const m = spec();
  if (!base) base = m.base || [];
  return { from: base[i], to: base[i + 1] === undefined ? m.span : base[i + 1] };
}

/** 位次 → 条目序号。base[] 是升序数组，二分即可 */
function entryAt(at) {
  const m = spec();
  if (!base) base = m.base || [];
  let lo = 0;
  let hi = base.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (base[mid] <= at) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * 拉一列。优先包内（本地开发会把全量打进 data/），其次云存储，最后失败。
 * @returns {Promise<boolean>}
 */
function ensureCol(n) {
  if (cols[n]) return Promise.resolve(true);
  if (loading[n]) return loading[n];

  loading[n] = new Promise((resolve) => {
    // 1) 包内：build-data 生成的 data/fulltext/<n>.json（只在本地开发时存在，
    //    线上不进包 —— 44 列合计 19MB，塞进主包必超限）
    try {
      cols[n] = require("../data/fulltext/" + n + ".json");
      resolve(true);
      return;
    } catch (e) {
      /* 没打进包，走云 */
    }

    // 2) 云存储 / CDN
    const remote = require("./remote");
    remote
      .fetchFulltextCol(n)
      .then((data) => {
        if (data && typeof data === "object") {
          cols[n] = data;
          remote.cacheFulltextCol(n, data);
          resolve(true);
        } else {
          resolve(false);
        }
      })
      .catch(() => resolve(false));
  });

  return loading[n];
}

/**
 * 解回升序位次数组。
 *
 * 编码是「长度位 + 差值」反复：`18k` 表示读 1 位得差值 8，再读 1 位得差值 20。
 * 长度位不能省 —— 差值大于 35 时 base36 会占两位（`(967-308).toString(36) === "ib"`），
 * 直接拼接就没有边界，解码从那里开始整段错位。
 * 配套的 pack() 在 scripts/build-data.js。
 */
function unpack(s) {
  const out = [];
  let cur = 0;
  const str = String(s == null ? "" : s);
  let i = 0;
  while (i < str.length) {
    const len = parseInt(str[i], 36);
    if (!len) break;
    i += 1;
    const enc = str.slice(i, i + len);
    i += len;
    if (enc.length < len) break;
    cur += parseInt(enc, 36);
    out.push(cur);
  }
  return out;
}

/**
 * 全文检索。
 *
 * @param {string} keyword
 * @param {Object} [opt] book（限定集子）/ limit
 * @returns {Promise<{hits:Object[], fulltext:boolean}>}
 *   fulltext=false 表示只搜了索引字段，正文没搜到 —— 界面上要如实说明
 */
function search(keyword, opt) {
  const kw = String(keyword || "").trim();
  const options = opt || {};
  if (!kw) return Promise.resolve({ hits: [], fulltext: true });

  const han = Array.from(kw).filter((c) => /[\u3400-\u9fff]/.test(c));

  // 没有汉字（纯作者名 / 朝代 / 拼音）走索引就够，不必下倒排
  if (!han.length) {
    return Promise.resolve({
      hits: corpus.search(kw, { book: options.book, limit: options.limit }),
      fulltext: false
    });
  }

  const total = spec().cols || 1;
  const wanted = [];
  for (let n = 0; n < total; n++) wanted.push(n);

  return Promise.all(wanted.map(ensureCol)).then((oks) => {
    if (!oks.some(Boolean)) {
      return {
        hits: corpus.search(kw, { book: options.book, limit: options.limit }),
        fulltext: false
      };
    }

    const span = colSpan();

    // 每个字在位次空间里的集合。位次是全局的，所以直接并起来 ——
    // 注意列表本身已升序，合并后仍然升序，不做 sort（排序会打乱与字的对应）
    const sets = han.map((ch) => {
      const per = [];
      for (let n = 0; n < total; n++) {
        if (!cols[n]) continue;
        const packed = cols[n][ch];
        if (!packed) continue;
        const off = unpack(packed);
        for (let i = 0; i < off.length; i++) per.push(n * span + off[i]);
      }
      return per;
    });

    if (sets.some((s) => !s.length)) return { hits: [], fulltext: true };

    // 以最短的那个集合为驱动，但掩码按**原始字序**配对：
    // 位次只差 k 才代表相邻的字，一旦按长度重排，k 与字的对应就错位了。
    let driveIdx = 0;
    for (let i = 1; i < sets.length; i++) {
      if (sets[i].length < sets[driveIdx].length) driveIdx = i;
    }
    const hitAt = sets.map((s) => {
      const m = {};
      for (let i = 0; i < s.length; i++) m[s[i]] = 1;
      return m;
    });

    const m = spec();
    const limit = options.limit || 60;
    const hits = [];
    const seen = {};
    const driver = sets[driveIdx];

    for (let i = 0; i < driver.length; i++) {
      const start = driver[i] - driveIdx;
      if (start < 0) continue;

      let ok = true;
      for (let k = 0; k < han.length; k++) {
        if (k === driveIdx) continue;
        if (!hitAt[k][start + k]) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;

      const idx = entryAt(start);
      const from = base[idx];
      const to = base[idx + 1] === undefined ? m.span : base[idx + 1];
      // 命中必须整段落在同一条正文里，不能横跨两条 —— 长串虽然连续，
      // 但两条之间是硬截断，跨条的「命中」是假阳性
      if (start + han.length > to || idx >= m.entryCount) continue;

      const id = idOf(idx);
      if (!id || seen[id]) continue;
      seen[id] = 1;

      const meta = corpus.indexById(id);
      if (!meta) continue;
      if (options.book && meta.b !== options.book) continue;

      const e = corpus.entry(id);
      const text = (e && e.text) || "";
      if (text.indexOf(kw) < 0) continue;

      hits.push(
        Object.assign({}, meta, {
          hit: snippet(text, kw),
          inText: true
        })
      );
      if (hits.length >= limit) break;
    }

    return { hits, fulltext: true };
  });
}

/** 条目序号 → 条目 id。集子按 books.json 的次序拼起来，与 build 时同一口径 */
let orderCache = null;
function order() {
  if (orderCache) return orderCache;
  const out = [];
  corpus.books().forEach((b) => {
    corpus.ofBook(b.id).forEach((p) => out.push(p.id));
  });
  orderCache = out;
  return out;
}

function idOf(i) {
  return order()[i] || "";
}

/** 命中句：取包含关键词的那一句，两端各留一点上下文 */
function snippet(text, kw) {
  const src = String(text == null ? "" : text).replace(/\n/g, "");
  if (!src) return "";
  const at = src.indexOf(kw);
  if (at < 0) return src.slice(0, 24);
  const from = Math.max(0, at - 6);
  const to = Math.min(src.length, at + kw.length + 14);
  return (from > 0 ? "…" : "") + src.slice(from, to) + (to < src.length ? "…" : "");
}

/** 清缓存。换了账号或本机存储被清时调 */
function reset() {
  manifest = null;
  base = null;
  orderCache = null;
  Object.keys(cols).forEach((k) => delete cols[k]);
}

module.exports = { search, snippet, ensureCol, unpack, reset, colSpan, entryAt };
