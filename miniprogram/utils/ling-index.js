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
  { id: "tangshi300", name: "唐诗三百首", source: "tangshi", kind: "selection" },
  { id: "songci300", name: "宋词三百首", source: "songci", kind: "selection" },
  { id: "tongxin", name: "童心诗话", source: "", kind: "catalog" }
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

function courseRows(index) {
  const out = [];
  (index || []).forEach((p) => {
    if (p.isBook || p.book !== "poems" || !p.text) return;
    const stage = stageOfGrade(p.grade);
    out.push({
      key: String(p.id),
      id: String(p.id),
      originId: String(p.originId || ""),
      title: String(p.title || ""),
      author: String(p.authorName || p.author || ""),
      dynasty: String(p.dynasty || ""),
      book: "poems",
      scope: "course",
      stage: stage,
      grade: gradeName(p.grade),
      text: String(p.text)
    });
  });
  return out;
}

const TITLE_TAIL = /[\s\u3000]*(其)?[一二三四五六七八九十百\d]+$/;

function headKey(title, author) {
  const head = String(title || "").split("·")[0].replace(/[\s\u3000]/g, "");
  return head + "\u0000" + String(author || "").trim();
}

function tailTitle(title) {
  const parts = String(title || "").split("·");
  if (parts.length < 2) return "";
  const tail = parts[parts.length - 1].replace(TITLE_TAIL, "").replace(/[\s\u3000]/g, "");
  return tail.length >= 3 ? tail : "";
}

function catalogRows(index, catalogs) {
  const byHead = {};
  (index || []).forEach((p) => {
    if (p.isBook || !p.text) return;
    const key = headKey(p.title, p.authorName || p.author);
    const other = headKey(p.title, p.author);
    if (!byHead[key]) byHead[key] = [];
    byHead[key].push(p);
    if (other !== key) byHead[other] = byHead[key];
  });
  const byTitle = {};
  (index || []).forEach((p) => {
    if (p.isBook || !p.text) return;
    const key = String(p.title || "").trim();
    if (!byTitle[key]) byTitle[key] = [];
    byTitle[key].push(p);
  });

  const out = [];
  SELECTIONS.forEach((s) => {
    if (s.kind !== "catalog") return;
    (((catalogs || {})[s.id] || {}).rows || []).forEach((r) => {
      const pool = byHead[headKey(r[0], r[1])] || byTitle[tailTitle(r[0])] || [];
      (pool.length ? [pool[0]] : []).forEach((p) => {
        out.push({
          key: String(p.book) + "|" + String(p.id || p.originId || p.title),
          id: s.id,
          originId: String(p.originId || p.id || ""),
          title: String(r[0] || ""),
          author: String(p.authorName || p.author || ""),
          dynasty: String(p.dynasty || ""),
          book: String(p.book || ""),
          scope: s.id,
          stage: "",
          grade: "",
          text: String(p.text)
        });
      });
    });
  });
  return out;
}

function selectionRows(index) {
  const out = [];
  (index || []).forEach((p) => {
    if (p.isBook || !p.text || !p.selection) return;
    const hit = SELECTIONS.filter((s) => s.kind === "selection" && s.name === p.selection)[0];
    if (!hit) return;
    out.push({
      key: String(p.book) + "|" + String(p.id || p.originId || p.title),
      id: hit.id,
      originId: String(p.originId || p.id || ""),
      title: String(p.title || ""),
      author: String(p.authorName || p.author || ""),
      dynasty: String(p.dynasty || ""),
      book: String(p.book || ""),
      scope: hit.id,
      stage: "",
      grade: "",
      text: String(p.text)
    });
  });
  return out;
}

function indexRows(rows) {
  const seen = {};
  const couples = [];
  rows.forEach((row) => {
    couplesOf(row.text).forEach((seg) => {
      if (seen[seg]) return;
      seen[seg] = 1;
      couples.push({ row: row, seg: seg });
    });
  });
  return { rows: rows, couples: couples };
}

function build(index, catalogs) {
  return indexRows(courseRows(index)
    .concat(selectionRows(index))
    .concat(catalogRows(index, catalogs)));
}

let box = null;

function ready() {
  return !!(box && box.couples && box.couples.length);
}

function install(rows) {
  box = indexRows(rows || []);
  return box;
}

function load() {
  if (ready()) return Promise.resolve(box);
  const meta = require("../packages/game/data/ling-rows");
  return Promise.all((meta.files || []).map(loadSub)).then((lists) => {
    box = indexRows([].concat.apply([], lists));
    return box;
  }, () => box);
}

function loadSub(name) {
  try {
    return Promise.resolve(require("../packages/game/data/" + name) || []);
  } catch (e) {
    return Promise.resolve([]);
  }
}

function reset() {
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
  return [hit ? hit.name : row.scope];
}

function pool(term) {
  const key = String(term == null ? "" : term).trim();
  if (!key || !ready()) return [];
  return box.couples
    .filter((c) => c.seg.indexOf(key) >= 0)
    .map((c) => {
      const at = c.seg.indexOf(key);
      return {
        id: c.row.id,
        originId: c.row.originId,
        book: c.row.scope === "course" ? "poems" : c.row.book,
        scope: c.row.scope,
        stage: c.row.stage,
        seg: c.seg,
        title: c.row.title,
        author: c.row.author,
        dynasty: c.row.dynasty,
        tags: tagsOf(c.row),
        head: c.seg.slice(0, at),
        hit: key,
        tail: c.seg.slice(at + key.length)
      };
    });
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
  scopes().forEach((s) => {
    out[s.id] = all.filter((row) => inScope(row, s.id, store.settings().grade)).length;
  });
  return out;
}

module.exports = {
  GROUPS,
  PAGE,
  SELECTIONS,
  scopes,
  scopeTable,
  selectionOf,
  clausesOf,
  couplesOf,
  build,
  install,
  reset,
  ready,
  load,
  find,
  counts
};
