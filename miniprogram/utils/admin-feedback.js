const remote = require("./remote");
const fb = require("./feedback-api");
const dots = require("./dots");

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

function latest(threads) {
  return dots.newest((threads || []).filter((t) => t.status === "open"), (t) => t.updatedAt || t.createdAt);
}

function list() {
  return remote.adminFeedbackList("all").then((res) => {
    if (!res.ok) return { ok: false, groups: [], counts: {}, reason: res.reason || "反馈读取失败" };
    return { ok: true, groups: group(res.threads), counts: res.counts || {}, latest: latest(res.threads) };
  });
}

function thread(tid) {
  return remote.adminFeedbackThread(tid).then((res) => {
    if (!res.ok || !res.thread) return { ok: false, reason: res.reason || "该条反馈读取失败" };
    return { ok: true, thread: fb.decorate(res.thread) };
  });
}

function reply(tid, content, status, resolution) {
  const text = String(content || "").trim();
  if (!tid) return Promise.resolve({ ok: false, reason: "缺少反馈编号" });
  if (!text) return Promise.resolve({ ok: false, reason: "请输入回复内容" });
  if (text.length > fb.COMMENT_MAX) return Promise.resolve({ ok: false, reason: "回复最多 " + fb.COMMENT_MAX + " 字" });
  return remote.adminFeedbackReply({
    tid: tid,
    content: text,
    status: status,
    resolution: resolution
  }).then((res) => ({
    ok: !!res.ok,
    reason: res.reason || "回复失败，请稍后重试",
    status: res.status,
    resolution: res.resolution
  }));
}

function remove(tid, cid) {
  if (!tid && !cid) return Promise.resolve({ ok: false, reason: "未指定要删除的条目" });
  return remote.adminFeedbackDelete(tid, cid).then((res) => ({
    ok: !!res.ok,
    reason: res.reason || "删除失败，请稍后重试"
  }));
}

module.exports = {
  GROUPS,
  list,
  thread,
  reply,
  remove
};
