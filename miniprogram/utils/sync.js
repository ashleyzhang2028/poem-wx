/**
 * 云端同步的调度层：什么时候同步、同步完界面怎么刷。
 *
 * 网页版是「登录即在后台常驻同步」；小程序端不能常驻，
 * 所以收敛成四个触发点：**登录成功那一刻**、启动后、做完一首、用户手动点。
 * 平时写本机，同步只是把本机已有的往上搬 —— **离线优先级最高**，
 * 断网时一行数据都不丢，只是延迟上传。
 *
 * 登录那一刻是 2026-10-04 补上的（用户：「同步功能只要用户登录就全部提供，
 * 确保用户数据不丢失，背诵进度换设备也能得到」）。它原来是缺的：
 * 新机器上登录完，用户第一眼看的是首页，而进度还在云上 ——
 * 要等启动 3 秒那一次，或者自己手动点一下同步。
 *
 * 这一层**不再问档位**。云同步上一版是 pro 起（服务端 syncTierGate 定的），
 * 现在是「登录即得」；门槛只剩一条 `ready()`：配了后端、且登录了。
 */
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

/**
 * 同步一次。
 * @param {boolean} [force] 用户手动点，忽略节流
 */
function now(force) {
  if (running) return Promise.resolve({ skipped: "busy" });
  if (!ready()) {
    // 没登录 / 没后端：把队列留着，进度依然只在本机，功能一个不少
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

/** 写本机之后调一次，把变化堆进队列。不做网络请求，随写随调不心疼。 */
function markDirty() {
  const box = store.read(store.KEYS.sync, {}) || {};
  box.at = Date.now();
  store.write(store.KEYS.sync, box);
}

module.exports = { ready, state, now, markDirty, pendingCount, MIN_GAP };
