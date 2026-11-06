const store = require("../../../utils/store");

const GROUPS = [
  { name: "季节时序", chars: ["春", "秋", "夜", "晓", "暮", "朝", "霜", "雪", "露", "霞", "烟", "雾", "日", "月"] },
  { name: "山水风物", chars: ["山", "水", "江", "湖", "溪", "泉", "河", "海", "云", "风", "雨", "舟", "帆", "桥", "楼", "城"] },
  { name: "花木芳菲", chars: ["花", "草", "柳", "梅", "兰", "竹", "菊", "桃", "荷", "香"] },
  { name: "鸟兽虫禽", chars: ["雁", "鸟", "蝶", "莺", "蝉", "马"] },
  { name: "色彩", chars: ["红", "白", "绿", "蓝", "黄", "紫", "青"] },
  { name: "数字", chars: ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十", "零"] },
  { name: "人事情思", chars: ["人", "君", "情", "梦", "相思", "泪", "归", "别", "孤", "寒", "空", "幽", "远", "离", "合", "望", "忆", "寄", "送", "寻", "访", "醉", "醒", "新", "旧", "生", "死", "故"] },
  { name: "器物雅物", chars: ["酒", "书", "笛", "箫", "烛", "钟", "琴", "棋", "诗", "画"] },
  { name: "其他", chars: ["长", "深", "高", "凉", "暖"] }
];

const CHARS = GROUPS.reduce((all, g) => all.concat(g.chars), []);

const STAGE_NAMES = { primary: "小学", middle: "初中", high: "高中" };

const STAGE_GRADES = { primary: [1, 2, 3, 4, 5, 6], middle: [7, 8, 9], high: [10, 11, 12] };

const STAGE_ORDER = ["primary", "middle", "high"];

const COURSE_SCOPES = [
  { id: "stage", name: "当前学段", note: "按「我的」里设的年级算" },
  { id: "primary", name: "小学课内", note: "一至六年级" },
  { id: "middle", name: "初中课内", note: "七至九年级" },
  { id: "high", name: "高中课内", note: "高一至高三" },
  { id: "course", name: "课内全部", note: "小学到高中" }
];

const SELECTIONS = [
  { id: "tangshi300", name: "唐诗三百首", book: "tangshi" },
  { id: "songci300", name: "宋词三百首", book: "songci" },
  { id: "tongxin", name: "童心诗话", book: "tongxin" },
  { id: "qianjiashi", name: "千家诗", book: "qianjiashi" },
  { id: "huajianji", name: "花间集", book: "huajianji" },
  { id: "gushiyuan", name: "古诗源", book: "gushiyuan" },
  { id: "yuefuji", name: "乐府诗集", book: "yuefuji" },
  { id: "cizong", name: "词综", book: "cizong" }
];

const ANY = { id: "any", name: "不限", note: "课内加各选集" };

const PAGE = 20;

const CLOSING = /[」』”’）》〉]/;

const COUPLET = /^[^，。！？；]+，[^，。！？；]+[。！？]$/;

const HEAD = /^[^，。！？；]+，$/;

const GRADE_NAMES = {
  1: "一年级", 2: "二年级", 3: "三年级", 4: "四年级", 5: "五年级", 6: "六年级",
  7: "七年级", 8: "八年级", 9: "九年级", 10: "高一", 11: "高二", 12: "高三"
};

function stageOfGrade(grade) {
  const g = Number(grade) || 1;
  return STAGE_ORDER.filter((k) => STAGE_GRADES[k].indexOf(g) >= 0)[0] || "primary";
}

function stageAt(grade) {
  return STAGE_ORDER.indexOf(stageOfGrade(grade));
}

function gradeName(grade) {
  return GRADE_NAMES[Number(grade)] || "";
}

function clausesOf(text) {
  const out = [];
  String(text == null ? "" : text)
    .split("\n")
    .forEach((line) => {
      const chars = Array.from(line.replace(/[\s\u3000]/g, ""));
      let buf = "";
      chars.forEach((ch, i) => {
        buf += ch;
        if (/[，。！？；]/.test(ch) && !CLOSING.test(chars[i + 1] || "")) {
          out.push(buf);
          buf = "";
        }
      });
      if (buf) out.push(buf);
    });
  return out;
}

function couplesOf(text) {
  const segs = clausesOf(text);
  const out = [];
  segs.forEach((seg, i) => {
    const hit = seg + (segs[i + 1] || "");
    if (HEAD.test(seg) && COUPLET.test(hit)) out.push(hit);
  });
  return out;
}

function scopes() {
  return COURSE_SCOPES
    .concat(SELECTIONS.map((s) => ({ id: s.id, name: s.name })))
    .concat([ANY]);
}

function scopeTable() {
  return scopes().map((s) => Object.assign({}, s));
}

function selectionOf(id) {
  return SELECTIONS.filter((s) => s.id === id)[0] || null;
}

function bookNameOf(bookId, books) {
  const hit = (books || []).filter((b) => b.id === bookId)[0];
  return hit ? String(hit.name || "") : "";
}

function courseRows(pack) {
  const out = [];
  (pack || []).forEach((p) => {
    const text = String((p && p.text) || "");
    if (!text) return;
    const stage = stageOfGrade(p.gr);
    out.push({
      id: String(p.id),
      originId: String(p.originId || ""),
      book: String(p.b || ""),
      title: String(p.t || ""),
      author: String(p.a || ""),
      dynasty: String(p.d || ""),
      scope: "course",
      stage: stage,
      grade: gradeName(p.gr),
      text: text
    });
  });
  return out;
}

function bookRows(pack, selection, name) {
  const out = [];
  (pack || []).forEach((p) => {
    const text = String((p && p.text) || "");
    if (!text) return;
    out.push({
      id: String(p.id),
      originId: String(p.originId || ""),
      book: String(p.b || ""),
      title: String(p.t || ""),
      author: String(p.a || ""),
      dynasty: String(p.d || ""),
      scope: selection.id,
      stage: "",
      grade: name,
      text: text
    });
  });
  return out;
}

function rowOf(rows) {
  const seen = {};
  const couples = [];
  (rows || []).forEach((row) => {
    couplesOf(row.text).forEach((seg) => {
      if (seen[seg]) return;
      seen[seg] = 1;
      couples.push({ row: row, seg: seg });
    });
  });
  return { rows: rows || [], couples: couples };
}

function build(parts) {
  const p = parts || {};
  const course = courseRows(p.course);
  return rowOf(course.concat(bookRows(p.tangshi, selectionOf("tangshi300")))
    .concat(bookRows(p.songci, selectionOf("songci300"))));
}

function buildBooks(books, packs) {
  const rows = [];
  Object.keys(packs || {}).forEach((id) => {
    const sel = selectionOf(id);
    if (!sel) return;
    rows.push.apply(rows, bookRows(packs[id], sel, bookNameOf(sel.book, books) || sel.name));
  });
  return rowOf(rows);
}

let box = null;

let hitCache = null;

function ready() {
  return !!(box && box.couples);
}

function install(rows) {
  hitCache = null;
  box = rowOf(rows || []);
  return box;
}

function load() {
  if (ready()) return Promise.resolve(box);
  const corpus = require("../../../utils/corpus");
  return corpus.ready("core")
    .then(() => {
      if (ready()) return box;
      const texts = corpus.courseTexts();
      install(courseRows(corpus.course().map((p) => Object.assign({}, p, {
        text: (texts[p.id] || {}).text
      }))));
      return box;
    }, () => {
      if (!ready()) box = rowOf([]);
      return box;
    });
}

function installBooks(books, packs) {
  hitCache = null;
  const extra = buildBooks(books, packs);
  box = box || rowOf([]);
  const seen = {};
  const couples = box.couples.slice();
  box.couples.forEach((c) => { seen[c.seg] = 1; });
  extra.couples.forEach((c) => {
    if (seen[c.seg]) return;
    seen[c.seg] = 1;
    couples.push(c);
  });
  box = { rows: box.rows.concat(extra.rows), couples: couples };
  return extra.couples.length;
}

function reset() {
  hitCache = null;
  box = null;
}

function inScope(row, scope, grade) {
  if (scope === "any") return true;
  if (row.scope !== "course") return row.scope === scope;
  if (scope === "course") return true;
  if (scope === "stage") return stageAt(row.stage) <= stageAt(grade || store.settings().grade);
  return row.stage === scope;
}

function tagsOf(row) {
  if (row.scope === "course") return [STAGE_NAMES[row.stage] || "课内", row.grade].filter(Boolean);
  const hit = selectionOf(row.scope);
  return [hit ? hit.name : row.grade];
}

function hitRow(row, seg, key) {
  const at = seg.indexOf(key);
  return {
    id: row.id,
    originId: row.originId,
    book: row.scope === "course" ? "poems" : row.book,
    scope: row.scope,
    stage: row.stage,
    seg: seg,
    title: row.title,
    author: row.author,
    dynasty: row.dynasty,
    tags: tagsOf(row),
    head: seg.slice(0, at),
    hit: key,
    tail: seg.slice(at + key.length)
  };
}

function matchAt(term, opt) {
  const o = opt || {};
  const key = String(term == null ? "" : term).trim();
  if (!key || !ready()) return [];
  const grade = o.grade;
  const scope = o.scope || "stage";
  const stamp = [key, scope, grade].join("|");
  if (hitCache && hitCache.stamp === stamp && hitCache.box === box) return hitCache.rows.slice();
  const rows = box.couples
    .filter((c) => c.seg.indexOf(key) >= 0 && inScope(c.row, scope, grade))
    .map((c) => hitRow(c.row, c.seg, key));
  hitCache = { stamp: stamp, box: box, rows: rows };
  return rows.slice();
}

function find(term, opt) {
  const o = opt || {};
  const all = matchAt(term, o);
  const from = Math.max(0, Number(o.from) || 0);
  const size = Math.max(1, Number(o.size) || PAGE);
  const page = all.slice(from, from + size);
  return {
    term: String(term == null ? "" : term),
    scope: o.scope || "stage",
    total: all.length,
    from: from,
    items: page,
    more: from + page.length < all.length
  };
}

module.exports = {
  GROUPS,
  CHARS,
  PAGE,
  SELECTIONS,
  scopes,
  scopeTable,
  selectionOf,
  clausesOf,
  couplesOf,
  build,
  buildBooks,
  install,
  installBooks,
  reset,
  ready,
  load,
  find,
  matchAt,
  tagsOf
};
