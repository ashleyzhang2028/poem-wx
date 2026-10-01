/**
 * 门禁。
 *
 * Issue 里那句话是这么说的：
 *   「不登录用户只能浏览首页，首页默认列出一年级诗词，无法点击」
 *
 * 它有两个落点，这个文件只管第一个：
 *   1. **能不能进**（这里）—— 未登录能开首页、能看书目，但点不动
 *   2. **能用到哪一档**（entitlement.js）—— 登录之后按 free / pro / max 分层
 *
 * 为什么不做「打开即强制登录」：小程序没有这种能力。`wx.login` 静默拿 code，
 * 用户看不见；而 `wx.getUserProfile` 这类要用户点头的接口，必须由用户手势触发 ——
 * 所以「进入时弹一个登录框」根本写不出来。能做的只有「进门容易、用起来要求登录」，
 * 这也正是 Issue 那句话的意思。
 *
 * ⚠️ 这是**界面门禁**，不是安全边界。真正的边界在服务端：没有会话就拿不到数据。
 *   本机缓存的正文改存储就能读 —— 但那些正文本来也是公开的诗词，不是密钥。
 */
const store = require("./store");
const auth = require("./auth");

/** 未登录时首页展示的范围：一年级上下册，不跟着本机设置跑 */
const GUEST_GRADE = 1;

/** 未登录时允许的事情，一条不多 */
const PUBLIC_ACTIONS = [
  "browse-home",   // 开首页
  "browse-grade",  // 在首页切换年级看目录（只有目录，点不进正文）
  "login",         // 登录
  "about"          // 关于 / 隐私
];

function logged() {
  return auth.logged();
}

/** 这条动作未登录时能不能做 */
function allow(action) {
  if (logged()) return true;
  return PUBLIC_ACTIONS.indexOf(action) >= 0;
}

/** 能不能点开一篇（进详情页） */
function canRead() {
  return logged();
}

/**
 * 拦下来的时候说一句话。**必须带下一步**，只说「没有权限」等于没说。
 * @returns {{ok:boolean, title:string, content:string}}
 */
function refuse(what) {
  if (logged()) return { ok: true, title: "", content: "" };
  return {
    ok: false,
    title: "登录后可用",
    content: "「" + what + "」要微信登录之后才能用。\n\n登录只为两件事：跨设备带走进度、让管理员知道把档位发给谁。不登录也能看首页目录。"
  };
}

/**
 * 统一的引导：能干就回调，不能干就弹一句人话再把人送去登录。
 * 页面不自己拼措辞 —— 否则「为什么点不动」会散在十几个地方，口径早晚不一致。
 */
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

/** 当前生效的年级：未登录固定一年级，登录后听本机设置 */
function grade() {
  if (!logged()) return GUEST_GRADE;
  return store.settings().grade;
}

module.exports = { GUEST_GRADE, PUBLIC_ACTIONS, logged, allow, canRead, refuse, guard, grade };
