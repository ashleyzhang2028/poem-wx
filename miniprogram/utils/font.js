const store = require("./store");

const TITLE = "Kuibu Serif";
const TEXT = "Kuibu Serif Text";

let tried = false;

function url(key) {
  const auth = store.read(store.KEYS.auth, {}) || {};
  return String(auth[key] || "");
}

function readiness() {
  const title = url("fontUrl");
  const text = url("fontTextUrl");
  if (!title && !text) {
    return { visible: false, usable: false, state: "unsupported", reason: "未配置诗词宋体子集" };
  }
  return { visible: true, usable: true, state: "ready", reason: "" };
}

function load() {
  const r = readiness();
  if (!r.usable || tried) return Promise.resolve(false);
  tried = true;

  if (typeof wx.loadFontFace !== "function") return Promise.resolve(false);

  const faces = [
    { family: TITLE, source: url("fontUrl") },
    { family: TEXT, source: url("fontTextUrl"), desc: { weight: "normal" } }
  ].filter((f) => f.source);

  return Promise.all(faces.map((f) => new Promise((resolve) => {
    wx.loadFontFace(Object.assign({ global: true, scopes: ["webview"] }, f, {
      success: () => resolve(true),
      fail: () => resolve(false)
    }));
  }))).then((r2) => r2.some(Boolean));
}

module.exports = { FAMILY: TITLE, TEXT_FAMILY: TEXT, readiness, load, url };
