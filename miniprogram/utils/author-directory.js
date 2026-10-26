const source = require("./poem-source");

const KEY = "kb_author_dir_v1";
const PAGE_SIZE = 100;
const MAX_PAGES = 100;
const GAP_MS = 120;
const SAVE_EVERY = 5;

let dir = null;
let running = null;
let watchers = [];

function load() {
  if (dir) return dir;
  dir = { rows: [], page: 0, done: false };
  try {
    const raw = wx.getStorageSync(KEY);
    if (raw && Array.isArray(raw.rows) && typeof raw.page === "number") dir = raw;
  } catch (e) {
    dir = { rows: [], page: 0, done: false };
  }
  return dir;
}

function save() {
  try {
    wx.setStorageSync(KEY, dir);
  } catch (e) {
    return;
  }
}

function notify() {
  watchers.forEach((fn) => fn(dir.done));
}

function step() {
  const d = load();
  if (d.done) return Promise.resolve();
  return source.authors(d.page + 1, PAGE_SIZE).then((r) => {
    r.items.forEach((a) => d.rows.push([String(a.name || ""), String(a.dynasty || ""), String(a.id)]));
    d.page += 1;
    d.done = !r.more || d.page >= MAX_PAGES;
    if (d.done || d.page % SAVE_EVERY === 0) save();
    notify();
    if (d.done) return null;
    return new Promise((resolve) => setTimeout(resolve, GAP_MS)).then(step);
  });
}

function ensure(onChange) {
  if (onChange) watchers = watchers.concat([onChange]);
  if (load().done || running) return;
  running = step().then(
    () => { running = null; },
    (err) => {
      running = null;
      console.error("[authors] 名册补全中断 page=" + load().page, "HTTP " + ((err && err.statusCode) || 0), (err && err.message) || "");
      save();
    }
  );
}

function release(onChange) {
  watchers = watchers.filter((fn) => fn !== onChange);
}

function find(keyword) {
  const kw = String(keyword || "").trim();
  if (!kw) return [];
  return load().rows
    .filter((r) => r[0].indexOf(kw) >= 0)
    .map((r) => ({ name: r[0], dynasty: r[1], id: r[2] }));
}

function complete() {
  return load().done;
}

module.exports = { ensure, release, find, complete };
