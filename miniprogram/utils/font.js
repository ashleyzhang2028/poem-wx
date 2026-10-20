const store = require("./store");
const tiers = require("./tiers");
const entitlement = require("./entitlement");

const FAMILY = "Kuibu Serif";

const BASE = "https://706f-poem-d9g1bqeq978682c58-1502724481.tcb.qcloud.la/fonts/zhuquefangsong-regular/zhuquefangsong-regular-";

const SETS = {
  free: [BASE + "free.woff2", BASE + "free.woff"],
  pro: [BASE + "pro.woff2", BASE + "pro.woff"]
};

function paid(tier) {
  return tiers.rank(tier) >= tiers.rank("pro");
}

function setOf(tier) {
  return paid(tier) ? "pro" : "free";
}

function configured() {
  const auth = store.read(store.KEYS.auth, {}) || {};
  if (auth.fontUrl !== undefined) {
    const list = Array.isArray(auth.fontUrl) ? auth.fontUrl : [auth.fontUrl];
    return list.map((it) => String(it || "")).filter(Boolean);
  }
  return SETS[setOf(entitlement.status().tier)].slice();
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

let loaded = "";

function load() {
  const list = configured();
  const key = list.join(" ");

  if (!list.length || key === loaded) return Promise.resolve(false);

  if (typeof wx.loadFontFace !== "function") return Promise.resolve(false);

  loaded = key;

  return sequence(list).then((ok) => {
    if (!ok) loaded = "";
    return ok;
  });
}

module.exports = { FAMILY, SETS, setOf, readiness, load, configured };
