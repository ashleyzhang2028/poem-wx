const corpus = require("./corpus");
const store = require("./store");

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

const STAGES = { primary: "小学", middle: "初中", high: "高中" };

const COLLECTIONS = ["tangshi300", "songci300", "xiaoguwen", "tongxin", "qianjiashi", "huajianji", "gushiyuan", "yuefuji", "cizong", "chuci", "wenxuan"];

const SCOPES = [
  { id: "stage", name: "当前学段", note: "按「我的」里设的年级算" },
  { id: "primary", name: "小学课内", note: "一至六年级" },
  { id: "middle", name: "初中课内", note: "七至九年级" },
  { id: "high", name: "高中课内", note: "高一至高三" },
  { id: "course", name: "课内全部", note: "小学到高中" }
].concat(COLLECTIONS.map((id) => ({ id: id, name: "" }))).concat([{ id: "any", name: "不限", note: "上面之外的全部集子" }]);

const PAGE = 20;

const CLOSING = /[」』”’）》〉]/;

const COUPLET = /^[^，。！？；]+，[^，。！？；]+[。！？]$/;

const HEAD = /^[^，。！？；]+，$/;

const GRADE_NUM = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

function stageOfGrade(grade) {
  const g = Number(grade) || 1;
  if (g >= 10) return "high";
  return g >= 7 ? "middle" : "primary";
}

function gradeLabel(grade) {
  const g = Number(grade) || 0;
  if (!g) return "";
  if (g >= 10) return "高" + (g - 9);
  const name = Object.keys(GRADE_NUM).find((k) => GRADE_NUM[k] === g);
  return name ? name + "年级" : "";
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
    const next = segs[i + 1] || "";
    const hit = seg + next;
    if (HEAD.test(seg) && COUPLET.test(hit)) out.push(hit);
  });
  return out;
}

let bookCache = null;

function books() {
  if (bookCache) return bookCache;
  const out = {};
  corpus.books().forEach((book) => {
    out[book.id] = book;
  });
  bookCache = out;
  return out;
}

function scopeTable() {
  return SCOPES.map((s) => Object.assign({}, s, { name: s.name || bookName(s.id) }));
}

let ledgerCache = null;

function ledger() {
  if (!ledgerCache) ledgerCache = require("../data/catalog-ledger");
  return ledgerCache;
}

function catalogText(row) {
  const hit = corpus.catalogText(row);
  if (hit && hit.text) return hit.text;
  return ledger().texts[String(row.id)] || "";
}

function bookName(id) {
  const book = books()[id];
  return book ? String(book.name || id) : id;
}

function workText(row) {
  if (row.b === "poems") {
    const e = corpus.entry(row.id);
    return (e && e.text) || "";
  }
  return catalogText(row);
}

let rowsCache = null;

function rows() {
  if (rowsCache) return rowsCache;
  const out = [];
  corpus.course().forEach((row) => {
    const text = workText(row);
    if (!text) return;
    out.push({
      id: String(row.id),
      title: String(row.t || ""),
      author: String(row.a || row.an || ""),
      dynasty: String(row.d || ""),
      scope: "poems",
      stage: Number(row.gr) ? stageOfGrade(row.gr) : "",
      grade: gradeLabel(row.gr),
      text: text
    });
  });
  COLLECTIONS.forEach((id) => {
    (corpus.ofBook(id) || []).forEach((row) => {
      const text = catalogText(row);
      if (!text) return;
      out.push({
        id: String(row.id),
        title: String(row.t || ""),
        author: String(row.a || row.an || ""),
        dynasty: String(row.d || ""),
        scope: id,
        stage: "",
        grade: "",
        text: text
      });
    });
  });
  rowsCache = out;
  return out;
}

function tagsOf(row) {
  if (row.scope === "poems") return [STAGES[row.stage] || "课内", row.grade].filter(Boolean);
  return [bookName(row.scope)];
}

function inScope(row, scope, grade) {
  if (scope === "any") return true;
  if (row.scope === "poems") {
    if (scope === "course") return true;
    if (scope === "stage") return row.stage === stageOfGrade(grade || store.settings().grade);
    return row.stage === scope;
  }
  return row.scope === scope;
}

let poolCache = {};

function pool(term) {
  const key = String(term == null ? "" : term).trim();
  if (!key) return [];
  if (poolCache[key]) return poolCache[key];
  const seen = {};
  const out = [];
  rows().forEach((row) => {
    const tags = tagsOf(row);
    const here = {};
    couplesOf(row.text).forEach((seg) => {
      if (here[seg]) return;
      here[seg] = 1;
      const dedupe = row.title + "\u0000" + row.author + "\u0000" + seg;
      if (seen[dedupe]) return;
      seen[dedupe] = 1;
      const at = seg.indexOf(key);
      if (at < 0) return;
      out.push({
        id: row.id,
        scope: row.scope,
        stage: row.stage,
        seg: seg,
        title: row.title,
        author: row.author,
        dynasty: row.dynasty,
        tags: tags,
        head: seg.slice(0, at),
        hit: key,
        tail: seg.slice(at + key.length)
      });
    });
  });
  poolCache[key] = out;
  return out;
}

function find(term, opt) {
  const o = opt || {};
  const scope = o.scope || "stage";
  const all = pool(term).filter((row) => inScope(row, scope, o.grade));
  const from = Math.max(0, Number(o.from) || 0);
  const page = all.slice(from, from + PAGE);
  return {
    term: String(term == null ? "" : term),
    scope: scope,
    total: all.length,
    from: from,
    items: page,
    more: from + page.length < all.length
  };
}

function counts(term) {
  const all = pool(term);
  const out = {};
  SCOPES.forEach((s) => {
    out[s.id] = all.filter((row) => inScope(row, s.id, store.settings().grade)).length;
  });
  return out;
}

module.exports = {
  GROUPS,
  SCOPES,
  PAGE,
  clausesOf,
  couplesOf,
  scopeTable,
  find,
  counts
};
