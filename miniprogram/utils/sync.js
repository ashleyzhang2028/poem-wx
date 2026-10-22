const store = require("./store");
const remote = require("./remote");
const auth = require("./auth");
const wire = require("./wire");

let running = false;
let lastAt = 0;
let packTimer = null;

const MIN_GAP = 60 * 1000;
const IDLE_GAP = 5 * 1000;
const RETRY_FIRST = 15 * 1000;
const RETRY_STEP = 2;
const RETRY_MAX = 10 * 60 * 1000;
const DEFAULT_RETRY_AFTER = 60;

function ready() {
  return remote.configured() && auth.logged();
}

function box() {
  return store.read(store.KEYS.sync, {}) || {};
}

function patch(p) {
  store.write(store.KEYS.sync, Object.assign({}, box(), p));
}

function failed() {
  return Number(box().failAt || 0) || 0;
}

function waiting() {
  return Number(box().retryAt || 0) > Date.now();
}

function retryIn() {
  return Math.max(0, Math.ceil((Number(box().retryAt || 0) - Date.now()) / 1000));
}

function state() {
  const s = store.settings();
  const pending = pendingCount() || (unsent() ? 1 : 0);
  const at = failed();
  const late = pending && at && !waiting();
  return {
    ready: ready(),
    lastSyncAt: s.lastSyncAt || 0,
    lastText: s.lastSyncAt ? timeText(s.lastSyncAt) : "尚未同步",
    failed: !!at,
    failedText: at ? timeText(at) : "",
    later: waiting() ? retryIn() : 0,
    pendingStatus: pending
      ? (waiting() ? pending + " 项待重试" : late ? "待同步" : pending + " 项待同步")
      : "已同步",
    pendingText: pending
      ? (waiting() ? pending + " 项改动将在 " + waitText(retryIn()) + "后重试" : late ? "本次未同步成功，稍后自动重试" : pending + " 项改动待同步")
      : at ? "上次同步未成功，稍后自动重试" : "进度跟随微信账号，无需手动同步"
  };
}

function pendingCount() {
  const at = packMoment();
  const cleared = store.clearMarks();
  const clearing = cleared.rows.length + cleared.books.length + (cleared.dailyExtra ? 1 : 0);
  if (!at) return clearing;
  return clearing + wire.packRecords().filter((r) => !r.deleted && (r.updatedAt || 0) > at).length;
}

function packMoment() {
  return Number(box().packedAt || 0) || 0;
}

function armPackMoment() {
  clearTimeout(packTimer);
  packTimer = setTimeout(() => {
    packTimer = null;
    patch({ packedAt: Date.now() });
  }, IDLE_GAP);
}

function timeText(ts) {
  const d = new Date(ts);
  const hm = pad(d.getHours()) + ":" + pad(d.getMinutes());
  if (d.toDateString() === new Date().toDateString()) return "今天 " + hm;
  return d.getMonth() + 1 + " 月 " + d.getDate() + " 日 " + hm;
}

function waitText(seconds) {
  const total = Math.max(1, Math.round(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  if (h >= 24) return Math.floor(h / 24) + " 天" + (h % 24 ? " " + h % 24 + " 小时" : "");
  if (h) return h + " 小时" + (m ? " " + m + " 分" : "");
  if (m) return m + " 分" + (sec ? " " + sec + " 秒" : "");
  return sec + " 秒";
}

function pad(n) {
  return (n < 10 ? "0" : "") + n;
}

function now(force) {
  return run(force, remote.sync);
}

function pullOnly(force) {
  return run(force, remote.pull);
}

function run(force, job) {
  if (running) return Promise.resolve({ skipped: "busy" });
  if (!ready()) return Promise.resolve({ skipped: "offline", pending: pendingCount() });
  if (!force && Date.now() - lastAt < MIN_GAP) return Promise.resolve({ skipped: "throttled" });
  if (!force && waiting()) return Promise.resolve({ skipped: "waiting", retryAfter: retryIn() });

  running = true;
  return job()
    .then((res) => {
      running = false;
      if (res && res.error) {
        settleFail(res);
        return res;
      }
      lastAt = Date.now();
      store.saveSettings({ lastSyncAt: lastAt });
      store.write(store.KEYS.sync, { at: lastAt });
      clearTimeout(packTimer);
      packTimer = null;
      return res;
    })
    .catch((err) => {
      running = false;
      const res = { error: (err && err.message) || "同步失败" };
      settleFail(res);
      return res;
    });
}

function settleFail(res) {
  const after = (Number(res && res.retryAfter) || DEFAULT_RETRY_AFTER) * 1000;
  const tries = Number(box().fails || 0) + 1;
  const backoff = Math.min(RETRY_MAX, Math.max(after, RETRY_FIRST) * Math.pow(RETRY_STEP, tries - 1));
  const wait = Math.max(after, backoff);
  patch({ failAt: Date.now(), fails: tries, retryAt: Date.now() + wait });
}

function markDirty() {
  if (!ready()) return;
  armPackMoment();
  if (Date.now() - lastAt < MIN_GAP) {
    markUnsent();
    return;
  }
  now().catch(() => {
    markUnsent();
  });
}

function markUnsent() {
  if (box().unsent) return;
  patch({ unsent: Date.now() });
}

function unsent() {
  return Number(box().unsent || 0) > 0;
}

function flush() {
  if (!ready()) return Promise.resolve({ skipped: "offline" });
  if (!unsent() && !pendingCount()) return Promise.resolve({ skipped: "clean" });
  return now();
}

function resetThrottle() {
  lastAt = 0;
}

module.exports = { resetThrottle, ready, state, now, pullOnly, markDirty, flush, unsent, pendingCount, packMoment, waitText, MIN_GAP, RETRY_FIRST, RETRY_MAX };
