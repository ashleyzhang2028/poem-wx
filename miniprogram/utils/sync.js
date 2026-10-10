const store = require("./store");
const remote = require("./remote");
const auth = require("./auth");

let running = false;
let lastAt = 0;

const MIN_GAP = 60 * 1000;

function ready() {
  return remote.configured() && auth.logged();
}

function state() {
  const s = store.settings();
  return {
    ready: ready(),
    lastSyncAt: s.lastSyncAt || 0,
    lastText: s.lastSyncAt ? timeText(s.lastSyncAt) : "还没同步过",
    pending: pendingCount()
  };
}

function pendingCount() {
  const box = store.read(store.KEYS.sync, {}) || {};
  return (box.rows || []).length;
}

function timeText(ts) {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const hm = pad(d.getHours()) + ":" + pad(d.getMinutes());
  if (sameDay) return "今天 " + hm;
  return d.getMonth() + 1 + " 月 " + d.getDate() + " 日 " + hm;
}

function pad(n) {
  return (n < 10 ? "0" : "") + n;
}

function now(force) {
  if (running) return Promise.resolve({ skipped: "busy" });
  if (!ready()) {

    return Promise.resolve({ skipped: "offline", pending: pendingCount() });
  }
  if (!force && Date.now() - lastAt < MIN_GAP) return Promise.resolve({ skipped: "throttled" });

  running = true;
  return remote
    .sync()
    .then((res) => {
      running = false;
      if (!res.error) {
        lastAt = Date.now();
        store.saveSettings({ lastSyncAt: lastAt });
      }
      return res;
    })
    .catch((err) => {
      running = false;
      return { error: err.message };
    });
}

function markDirty() {
  const box = store.read(store.KEYS.sync, {}) || {};
  box.at = Date.now();
  store.write(store.KEYS.sync, box);
}

module.exports = { ready, state, now, markDirty, pendingCount, MIN_GAP };
