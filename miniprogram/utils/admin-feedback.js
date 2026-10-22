const remote = require("./remote");
const fb = require("./feedback-api");

const GROUPS = ["open", "replied", "closed"];

function order(threads) {
  return (threads || []).slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

function group(threads) {
  const rows = (threads || []).map(fb.decorate);
  return GROUPS.map((key) => ({
    key: key,
    name: fb.statusOf(key).name,
    tone: fb.statusOf(key).tone,
    threads: order(rows.filter((t) => t.status === key))
  }));
}

function list() {
  return remote.adminFeedbackList("all").then((res) => {
    if (!res.ok) return { ok: false, groups: [], counts: {}, reason: res.reason || "读不到反馈" };
    return { ok: true, groups: group(res.threads), counts: res.counts || {} };
  });
}

function thread(tid) {
  return remote.adminFeedbackThread(tid).then((res) => {
    if (!res.ok || !res.thread) return { ok: false, reason: res.reason || "读不到这一条" };
    return { ok: true, thread: fb.decorate(res.thread) };
  });
}

function reply(tid, content, status, resolution) {
  const text = String(content || "").trim();
  if (!tid) return Promise.resolve({ ok: false, reason: "缺少编号" });
  if (!text) return Promise.resolve({ ok: false, reason: "写一句再回" });
  if (text.length > fb.COMMENT_MAX) return Promise.resolve({ ok: false, reason: "一条最多 " + fb.COMMENT_MAX + " 字" });
  return remote.adminFeedbackReply({
    tid: tid,
    content: text,
    status: status,
    resolution: resolution
  }).then((res) => ({
    ok: !!res.ok,
    reason: res.reason || "没回成，稍后再试",
    status: res.status,
    resolution: res.resolution
  }));
}

module.exports = {
  GROUPS,
  list,
  thread,
  reply
};
