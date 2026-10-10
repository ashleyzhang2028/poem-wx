const store = require("./store");
const auth = require("./auth");

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
    title: "登录后可用",
    content: "「" + what + "」要微信登录之后才能用。\n\n登录只为两件事：跨设备带走进度、让管理员知道把档位发给谁。不登录也能看首页目录。"
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
    confirmText: "去登录",
    cancelText: "先看看",
    success: (res) => {
      if (res.confirm) wx.navigateTo({ url: "/pages/mine/mine?login=1" });
    }
  });
  return false;
}

function grade() {
  if (!logged()) return GUEST_GRADE;
  return store.settings().grade;
}

module.exports = { GUEST_GRADE, PUBLIC_ACTIONS, logged, allow, canRead, refuse, guard, grade };
