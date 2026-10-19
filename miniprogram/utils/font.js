const store = require("./store");

const FAMILY = "Kuibu Serif";

const SOURCES = [
  "https://706f-poem-d9g1bqeq978682c58-1502724481.tcb.qcloud.la/fonts/zhuquefangsong-regular/zhuquefangsong-regular-3500.woff2",
  "https://706f-poem-d9g1bqeq978682c58-1502724481.tcb.qcloud.la/fonts/zhuquefangsong-regular/zhuquefangsong-regular-3500.woff"
];

let tried = false;

function configured() {
  const auth = store.read(store.KEYS.auth, {}) || {};
  if (auth.fontUrl !== undefined) {
    const list = Array.isArray(auth.fontUrl) ? auth.fontUrl : [auth.fontUrl];
    return list.map((it) => String(it || "")).filter(Boolean);
  }
  return SOURCES.slice();
}

function readiness() {
  if (!configured().length) {
    return { visible: false, usable: false, state: "unsupported", reason: "未配置诗词仿宋子集" };
  }
  return { visible: true, usable: true, state: "ready", reason: "" };
}

function attempt(source) {
  return new Promise((resolve) => {
    wx.loadFontFace({
      global: true,
      scopes: ["webview"],
      family: FAMILY,
      source,
      success: () => resolve(true),
      fail: () => resolve(false)
    });
  });
}

function sequence(list) {
  return list.reduce(
    (prev, source) => prev.then((done) => (done ? true : attempt(source))),
    Promise.resolve(false)
  );
}

function load() {
  const r = readiness();
  if (!r.usable || tried) return Promise.resolve(false);
  tried = true;

  if (typeof wx.loadFontFace !== "function") return Promise.resolve(false);

  return sequence(configured());
}

module.exports = { FAMILY, SOURCES, readiness, load, configured };
