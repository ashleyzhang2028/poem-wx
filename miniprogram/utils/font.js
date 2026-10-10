const store = require("./store");

const FAMILY = "Kuibu Serif";

let tried = false;

function url() {
  const auth = store.read(store.KEYS.auth, {}) || {};
  return String(auth.fontUrl || "");
}

function readiness() {
  const u = url();
  if (!u) {
    return { visible: false, usable: false, state: "unsupported", reason: "未配置篇名子集字体" };
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
      family: FAMILY,
      source: 'url("' + url() + '")',

      global: true,
      scopes: ["webview"],
      success: () => resolve(true),

      fail: () => resolve(false)
    });
  });
}

module.exports = { FAMILY, readiness, load, url };
