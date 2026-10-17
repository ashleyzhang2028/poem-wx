const store = require("./store");

const FAMILY = "Kuibu Serif";

let tried = false;

function url(key) {
  const auth = store.read(store.KEYS.auth, {}) || {};
  return String(auth[key] || "");
}

function readiness() {
  if (!url("fontUrl")) {
    return { visible: false, usable: false, state: "unsupported", reason: "未配置诗词宋体子集" };
  }
  return { visible: true, usable: true, state: "ready", reason: "" };
}

function load() {
  const r = readiness();
  if (!r.usable || tried) return Promise.resolve(false);
  tried = true;

  if (typeof wx.loadFontFace !== "function") return Promise.resolve(false);

  return new Promise((resolve) => {
    wx.loadFontFace({
      global: true,
      scopes: ["webview"],
      family: FAMILY,
      source: url("fontUrl"),
      success: () => resolve(true),
      fail: () => resolve(false)
    });
  });
}

module.exports = { FAMILY, readiness, load, url };
