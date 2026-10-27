const KEY = "kb_remote_poems_v1";
const MAX = 1000;
const SAVE_MS = 800;

let box = null;
let timer = null;

function load() {
  if (box) return box;
  box = { rows: {}, order: [] };
  try {
    const raw = typeof wx !== "undefined" && wx.getStorageSync ? wx.getStorageSync(KEY) : null;
    if (raw && typeof raw === "object" && raw.rows && Array.isArray(raw.order)) box = raw;
  } catch (e) {
    box = { rows: {}, order: [] };
  }
  return box;
}

function save() {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    try {
      wx.setStorageSync(KEY, box);
    } catch (e) {
      box.order.splice(0, Math.ceil(box.order.length / 2)).forEach((id) => delete box.rows[id]);
    }
  }, SAVE_MS);
}

function keep(poems) {
  const b = load();
  let changed = false;
  (poems || []).forEach((p) => {
    if (!p || p.id === undefined || !p.title) return;
    const id = String(p.id);
    const row = [String(p.title), String((p.author && p.author.name) || ""), String((p.dynasty && p.dynasty.name) || "")];
    const had = b.rows[id];
    if (had && had.join("|") === row.join("|")) return;
    if (!had) b.order.push(id);
    b.rows[id] = row;
    changed = true;
  });
  while (b.order.length > MAX) delete b.rows[b.order.shift()];
  if (changed) save();
}

function titleOf(id) {
  const row = load().rows[String(id)];
  return (row && row[0]) || "";
}

function authorOf(id) {
  const row = load().rows[String(id)];
  return (row && row[1]) || "";
}

function rowOf(id) {
  const key = String(id);
  const row = /^\d+$/.test(key) ? load().rows[key] : null;
  if (!row) return null;
  return { id: key, sid: key, t: row[0], a: row[1], d: row[2], n: "课外阅读", b: "", g: "", s: "" };
}

require("./corpus").useIndexFallback(rowOf);

module.exports = { keep, rowOf, titleOf, authorOf };
