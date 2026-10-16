const store = require("./store");
const remote = require("./remote");
const auth = require("./auth");
const wire = require("./wire");

let running = false;
let lastAt = 0;
let packTimer = null;

const MIN_GAP = 60 * 1000;
const IDLE_GAP = 5 * 1000;

function ready() {
  return remote.configured() && auth.logged();
}

function state() {
  const s = store.settings();
  const pending = pendingCount();
  return {
    ready: ready(),
    lastSyncAt: s.lastSyncAt || 0,
    lastText: s.lastSyncAt ? timeText(s.lastSyncAt) : "还没有同步过",
    pendingStatus: pending ? pending + " 项在等同步" : "已同步",
    pendingText: pending ? pending + " 项改动在等同步" : "进度跟着微信账号走，不用手动"
  };
}

function pendingCount() {
  const at = packMoment();
  if (!at) return 0;
  return wire.packRecords().filter((r) => (r.updatedAt || 0) > at).length;
}

function packMoment() {
  const box = store.read(store.KEYS.sync, {}) || {};
  return Number(box.packedAt || 0) || 0;
}

function armPackMoment() {
  clearTimeout(packTimer);
  packTimer = setTimeout(() => {
    packTimer = null;
    store.write(store.KEYS.sync, Object.assign({}, store.read(store.KEYS.sync, {}), {
      packedAt: Date.now()
    }));
  }, IDLE_GAP);
}

function timeText(ts) {
  const d = new Date(ts);
  const hm = pad(d.getHours()) + ":" + pad(d.getMinutes());
  if (d.toDateString() === new Date().toDateString()) return "今天 " + hm;
  return d.getMonth() + 1 + " 月 " + d.getDate() + " 日 " + hm;
}

function pad(n) {
  return (n < 10 ? "0" : "") + n;
}

function now(force) {
  if (running) return Promise.resolve({ skipped: "busy" });
  if (!ready()) return Promise.resolve({ skipped: "offline", pending: pendingCount() });
  if (!force && Date.now() - lastAt < MIN_GAP) return Promise.resolve({ skipped: "throttled" });

  running = true;
  return remote
    .sync()
    .then((res) => {
      running = false;
      if (!res.error) {
        lastAt = Date.now();
        store.saveSettings({ lastSyncAt: lastAt });
        store.write(store.KEYS.sync, { at: lastAt });
        clearTimeout(packTimer);
        packTimer = null;
      }
      return res;
    })
    .catch((err) => {
      running = false;
      return { error: err.message };
    });
}

function markDirty() {
  if (!ready()) return;
  armPackMoment();
  if (Date.now() - lastAt < MIN_GAP) return;
  now().catch(() => {});
}

module.exports = { ready, state, now, markDirty, pendingCount, packMoment, MIN_GAP };
