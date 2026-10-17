const store = require("./store");
const auth = require("./auth");
const loginFlow = require("./login-flow");

const GUEST_GRADE = 1;

const PUBLIC_ACTIONS = [
  "browse-home",
  "browse-grade",
  "login",
  "about"
];

function logged() {
  return auth.logged();
}

function allow(action) {
  if (logged()) return true;
  return PUBLIC_ACTIONS.indexOf(action) >= 0;
}

function canRead() {
  return logged();
}

function refuse(what) {
  if (logged()) return { ok: true, title: "", content: "" };
  return {
    ok: false,
    title: "登录",
    content: "解锁跬步诗词的更多可能。"
  };
}

function guard(what, onPass) {
  const r = refuse(what);
  if (r.ok) {
    if (onPass) onPass();
    return true;
  }
  wx.showModal({
    title: r.title,
    content: r.content,
    confirmText: "登录",
    cancelText: "取消",
    success: (res) => {
      if (!res.confirm) return;
      loginFlow.run().catch(() => {});
    }
  });
  return false;
}

function grade() {
  if (!logged()) return GUEST_GRADE;
  return store.settings().grade;
}

module.exports = { GUEST_GRADE, PUBLIC_ACTIONS, logged, allow, canRead, refuse, guard, grade };
