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
    title: "登录提示",
    content: what ? "「" + what + "」登录可用。" : "登录可用。"
  };
}

function guard(what, page, onPass) {
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
      open(onPass, page);
    }
  });
  return false;
}

function open(onPass, page) {
  loginFlow.after(onPass, page);
  loginFlow.askLogin(page).catch(() => {});
}

function ask(page) {
  return loginFlow.askLogin(page).catch(() => null);
}

function resume(page) {
  return loginFlow.resume(page);
}

function grade() {
  if (!logged()) return GUEST_GRADE;
  return store.settings().grade;
}

module.exports = { GUEST_GRADE, PUBLIC_ACTIONS, logged, allow, canRead, refuse, guard, open, ask, resume, grade };
