const KEEP = 30;

const TEXT_MAX = 300;

const KEY = "kb_error_log_v1";

const pageStack = require("./page-stack");

let box = null;
let boxWx = null;

function host() {
  try {
    if (typeof wx !== "undefined" && wx) return wx;
  } catch (e) {
    return null;
  }
  return null;
}

function read() {
  const api = host();
  if (box && boxWx === api) return box;
  box = [];
  boxWx = api;
  try {
    const raw = api && typeof api.getStorageSync === "function" ? api.getStorageSync(KEY) : null;
    box = Array.isArray(raw) ? raw : [];
  } catch (e) {
    box = [];
  }
  return box;
}

function text(v) {
  const s = String(v === undefined || v === null ? "" : v).replace(/\s+/g, " ").trim();
  return s.length > TEXT_MAX ? s.slice(0, TEXT_MAX) : s;
}

const SCRIPT_ERROR = /^script error\.?$/i;

function where() {
  try {
    return pageStack.route();
  } catch (e) {
    return "";
  }
}

function say(v) {
  if (!v) return "";
  if (typeof v === "object") {
    if (v.stack) return String(v.stack);
    const said = [v.name, v.message].filter(Boolean).join(": ");
    if (said) return said;
    try {
      return JSON.stringify(v);
    } catch (e) {
      return Object.prototype.toString.call(v);
    }
  }
  return String(v);
}

function appVersion() {
  try {
    if (typeof wx === "undefined" || !wx || typeof wx.getAccountInfoSync !== "function") return "";
    const info = (wx.getAccountInfoSync() || {}).miniProgram || {};
    return String(info.version || "");
  } catch (e) {
    return "";
  }
}

function advice() {
  const at = appVersion();
  return "报错只有 Script error 时，真机不给出错位置，开发者工具的报错内容在这一份记录里。"
    + (at ? "出问题的版本 " + at + "。" : "") + "带上这份记录反馈。";
}

function add(kind, message, stack) {
  const rows = read();
  const said = text(message);
  const row = {
    at: Date.now(),
    kind: String(kind || "error"),
    msg: said || "(无信息)",
    stack: text(stack),
    page: where(),
    times: 1
  };
  if (SCRIPT_ERROR.test(said) && !row.stack) row.msg = said + " · " + advice();
  const last = rows[rows.length - 1];
  if (last && last.kind === row.kind && last.msg === row.msg && last.page === row.page) {
    last.at = row.at;
    last.times = (last.times || 1) + 1;
    row.times = last.times;
  } else {
    rows.push(row);
    while (rows.length > KEEP) rows.shift();
  }
  const api = host();
  if (api && typeof api.setStorageSync === "function") {
    try {
      api.setStorageSync(KEY, rows);
    } catch (e) {
      return row;
    }
  }
  return row;
}

function rows() {
  return read().slice().reverse();
}

function count() {
  return read().length;
}

function clear() {
  const api = host();
  box = [];
  boxWx = api;
  if (!api || typeof api.removeStorageSync !== "function") return false;
  try {
    api.removeStorageSync(KEY);
    return true;
  } catch (e) {
    return false;
  }
}

function clock(at) {
  const d = new Date(Number(at) || 0);
  const two = (n) => (n < 10 ? "0" + n : String(n));
  return d.getFullYear() + "-" + two(d.getMonth() + 1) + "-" + two(d.getDate()) + " "
    + two(d.getHours()) + ":" + two(d.getMinutes()) + ":" + two(d.getSeconds());
}

function dump() {
  const list = rows();
  if (!list.length) return "";
  return list.map((r) => [
    clock(r.at),
    r.kind,
    r.page || "(未知页面)",
    (r.msg || "") + (r.times > 1 ? " x" + r.times : ""),
    r.stack || ""
  ].join(" | ")).join("\n");
}

module.exports = { KEEP, TEXT_MAX, KEY, SCRIPT_ERROR, add, rows, count, clear, dump, clock, advice, say };
