const remote = require("./remote");
const dots = require("./dots");

const KINDS = [
  { key: "bug", name: "Bug 反馈" },
  { key: "typo", name: "内容纠错" },
  { key: "feature", name: "功能建议" },
  { key: "experience", name: "体验优化" },
  { key: "recommend", name: "篇目推荐" },
  { key: "performance", name: "性能问题" },
  { key: "account", name: "账号问题" },
  { key: "payment", name: "虚拟支付" },
  { key: "other", name: "其他" }
];

const STATUSES = [
  { key: "open", name: "未处理", tone: "amber" },
  { key: "replied", name: "处理中", tone: "blue" },
  { key: "closed", name: "已处理", tone: "green" }
];

const RESOLUTIONS = [
  { key: "pending", name: "待定" },
  { key: "adopted", name: "已采纳" },
  { key: "planned", name: "排期中" },
  { key: "rejected", name: "不采纳" },
  { key: "duplicate", name: "重复" }
];

const TITLE_MAX = 40;
const CONTENT_MAX = 2000;
const COMMENT_MAX = 2000;

function pick(list, key) {
  return list.filter((x) => x.key === key)[0] || list[list.length - 1];
}

function kindName(key) {
  return pick(KINDS, key).name;
}

function statusOf(key) {
  return pick(STATUSES, key);
}

function resolutionName(key) {
  return pick(RESOLUTIONS, key).name;
}

function pad(n) {
  return n < 10 ? "0" + n : String(n);
}

function dayOf(ts) {
  const n = Number(ts) || 0;
  if (!n) return "";
  const d = new Date(n);
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}

function timeOf(ts) {
  const n = Number(ts) || 0;
  if (!n) return "";
  const d = new Date(n);
  return pad(d.getHours()) + ":" + pad(d.getMinutes());
}

function stampOf(ts) {
  const day = dayOf(ts);
  return day ? day + " " + timeOf(ts) : "";
}

function decorate(thread) {
  if (!thread) return null;
  const status = statusOf(thread.status);
  return Object.assign({}, thread, {
    kindName: kindName(thread.kind),
    statusName: status.name,
    tone: status.tone,
    resolutionName: resolutionName(thread.resolution),
    createdText: stampOf(thread.createdAt),
    updatedText: stampOf(thread.updatedAt),
    comments: (thread.comments || []).map((c) => Object.assign({}, c, {
      stampText: stampOf(c.createdAt),
      admin: c.role === "admin"
    }))
  });
}

function replyAt(thread) {
  const admins = (thread.comments || []).filter((c) => c.role === "admin");
  const at = admins.reduce((top, c) => Math.max(top, Number(c.createdAt) || 0), 0);
  return thread.resolution ? Math.max(at, Number(thread.updatedAt) || 0) : at;
}

function latestReply(threads) {
  return dots.newest(threads, replyAt);
}

function validate(draft) {
  const title = String((draft && draft.title) || "").trim();
  const content = String((draft && draft.content) || "").trim();
  if (!title) return { ok: false, reason: "标题不能为空" };
  if (title.length > TITLE_MAX) return { ok: false, reason: "标题最多 " + TITLE_MAX + " 字" };
  if (!content) return { ok: false, reason: "正文不能为空" };
  if (content.length > CONTENT_MAX) return { ok: false, reason: "正文最多 " + CONTENT_MAX + " 字" };
  return { ok: true, title: title, content: content };
}

function submit(draft) {
  const checked = validate(draft);
  if (!checked.ok) return Promise.resolve(checked);
  return remote
    .feedbackCreate({
      kind: draft.kind,
      title: checked.title,
      content: checked.content
    })
    .then((res) => {
      if (!res.ok) return { ok: false, offline: !!res.offline, reason: res.reason || "没发出去，稍后再试" };
      return { ok: true, thread: decorate(res.thread), duplicate: !!res.duplicate };
    });
}

function mine() {
  return remote.feedbackMine().then((res) => ({
    offline: !!res.offline,
    threads: (res.threads || []).map(decorate)
  }));
}

function comment(tid, text) {
  const content = String(text || "").trim();
  if (!tid) return Promise.resolve({ ok: false, reason: "缺少编号" });
  if (!content) return Promise.resolve({ ok: false, reason: "写一句再发" });
  if (content.length > COMMENT_MAX) return Promise.resolve({ ok: false, reason: "一条最多 " + COMMENT_MAX + " 字" });
  return remote.feedbackComment(tid, content).then((res) => ({
    ok: !!res.ok,
    offline: !!res.offline,
    reason: res.reason || "没发出去，稍后再试"
  }));
}

module.exports = {
  KINDS,
  STATUSES,
  RESOLUTIONS,
  TITLE_MAX,
  CONTENT_MAX,
  COMMENT_MAX,
  kindName,
  statusOf,
  resolutionName,
  stampOf,
  decorate,
  validate,
  submit,
  mine,
  comment,
  latestReply
};
