const auth = require("./auth");
const store = require("./store");
const sync = require("./sync");
const tabPage = require("./tab-page");

function failText(err) {
  const code = (err && err.code) || "";
  if (code === "E_NOT_CONFIGURED") {
    return {
      title: "还没接上同步服务器",
      content:
        "登录连不上服务器，账号与进度只在这台手机上，换台手机就没了。\n\n"
        + "这不是这台手机能改的，找部署方（见「关于」）。"
    };
  }
  if (code === "E_CLOUD_OFF" || code === "E_CLOUD_INIT") {
    return {
      title: "同步服务器没接上",
      content:
        "登录与课外正文都要连服务器，这个包还没接上。\n\n"
        + "这不是这台手机能改的，找部署方（见「关于」）。"
    };
  }
  if (code === "E_WX_NOT_CONFIGURED" || code === "E_WX_CONFIG" || code === "E_WX_TABLE") {
    return {
      title: "登录没打通",
      content: ((err && err.message) || "") + "\n\n这是服务端/部署那一侧的事，先看「关于」里的联系方式。"
    };
  }
  return null;
}

function prompt(err) {
  if (err && err.cloudFail) {
    wx.showModal({
      title: "登录没有连上服务器",
      content: (err.message || "") + "\n\n这不是这台手机能改的，把这整段发给部署方。",
      showCancel: false,
      confirmText: "好"
    });
    return;
  }

  const box = failText(err);
  if (!box) {
    wx.showToast({ title: (err && err.message) || "登录未完成", icon: "none" });
    return;
  }
  wx.showModal({ title: box.title, content: box.content, showCancel: false, confirmText: "好" });
}

function toastLater(title) {
  return () => wx.showToast({ title, icon: "none", duration: 2500 });
}

function done(res) {
  if (!res || !res.wechatAsked) {
    const title = res && res.synced ? "已登录 · 进度已认回" : "已登录 · 这台手机上的记录还在";
    wx.showToast({ title, icon: "none", duration: 2500 });
    return;
  }
  res.afterToast = res.synced
    ? toastLater("已登录 · 进度已认回")
    : toastLater("已登录 · 这台手机上的记录还在");
}

const WECHAT_ITEMS = ["用微信头像", "用微信昵称", "用微信头像和昵称"];

function wechatActionOf(picked) {
  const avatar = picked !== WECHAT_ITEMS[1];
  const nickname = picked !== WECHAT_ITEMS[0];
  return { avatar, nickname, picked };
}

function wechatParts(picked) {
  const action = wechatActionOf(picked);
  const parts = [];
  if (action.avatar) parts.push("avatar");
  if (action.nickname) parts.push("nickname");
  return parts;
}

function wechatEntry(picked) {
  const entry = {
    picked,
    part: "",
    waiting: null,
    early: "",
    earlyValue: "",
    exit: () => resume(null),
    arm: (part) => {
      entry.part = part;
      if (typeof entry.ready === "function") entry.ready(part);
    }
  };
  const ask = (part) => {
    if (entry.early === part) {
      const value = entry.earlyValue;
      entry.early = "";
      entry.earlyValue = "";
      return Promise.resolve(value);
    }
    return new Promise((resolve) => {
      entry.waiting = resolve;
      entry.arm(part);
    });
  };
  wechatParts(picked).forEach((part) => {
    entry[part] = () => ask(part);
  });
  return entry;
}

function takeWechat(entry) {
  const at = entry || {};
  const after = at.after || at.exit || (() => {});
  const give = (value) => {
    const resolve = at.waiting;
    const part = at.part;
    at.waiting = null;
    at.part = "";
    if (typeof resolve === "function") {
      resolve(value || "");
      return;
    }
    at.early = part;
    at.earlyValue = value || "";
  };
  at.give = give;
  const finish = (result) => {
    after();
    return result;
  };
  const avatarPart = () => (typeof at.avatar === "function" ? at.avatar() : Promise.resolve(""));
  const nicknamePart = () => (typeof at.nickname === "function" ? at.nickname() : Promise.resolve(""));
  return avatarPart().then((url) => {
    if (url) takeAvatar(url, typeof at.nickname === "function");
    if (typeof at.nickname !== "function") return finish({ avatar: url, nickname: "" });
    return nicknamePart().then((name) => {
      return takeNickname(name, null, nicknamePart).then((res) => finish({
        avatar: url,
        nickname: res && res.saved ? name : ""
      }));
    });
  });
}

function takeAvatar(url, withNickname) {
  if (!url) return false;
  store.saveProfile({ avatarLocal: url });
  if (!withNickname) wx.showToast({ title: "头像已换成微信的", icon: "none" });
  return true;
}

function takeNickname(name, after, again) {
  const nickname = String(name == null ? "" : name).replace(/[\u0000-\u001f<>]/g, "").trim();
  if (!nickname) {
    const retry = typeof again === "function" ? again() : null;
    if (!retry) {
      if (after) after();
      return Promise.resolve({ saved: false });
    }
    return Promise.resolve(retry).then((next) => takeNickname(next, after, again));
  }
  const before = store.profile().nickname || "";
  store.saveProfile({ nickname });
  sync.markDirty();
  return auth.saveNickname(nickname).then((r) => {
    if (r && r.blocked) {
      store.saveProfile({ nickname: before });
      wx.showToast({ title: r.reason || "这个昵称不能用，换一个吧", icon: "none" });
    } else {
      wx.showToast({ title: "昵称已换成微信的", icon: "none" });
    }
    if (after) after();
    return r;
  });
}

function askWechat(page, entry) {
  const at = entry || {};
  const after = at.exit || (() => resume(page));
  if (!at.picked) {
    after();
    return Promise.resolve(null);
  }
  return takeWechat(at).catch((err) => {
    prompt(err);
    after();
    throw err;
  });
}

const ASK = {
  login: () => ({
    title: "登录",
    content: "登录后进度会同步到账号，换台手机也接得上。",
    confirmText: "登录"
  }),
  wechat: () => ({
    title: "换成微信的",
    content: "把头像和昵称换成微信里的那一份。\n\n"
      + "头像只留在这台手机上，不同步、也不上传。",
    confirmText: "换掉"
  })
};

function ask(box) {
  return new Promise((resolve) => {
    wx.showModal({
      title: box.title,
      content: box.content,
      confirmText: box.confirmText,
      cancelText: "取消",
      success: (r) => resolve(!!(r && r.confirm)),
      fail: () => resolve(false)
    });
  });
}

function askLogin(page) {
  if (auth.logged()) return Promise.resolve(null);
  return ask(ASK.login()).then((ok) => (ok ? run(page) : null));
}

function askWechatPick(page) {
  if (!auth.logged()) return Promise.resolve(null);
  return ask(ASK.wechat()).then((ok) => (ok ? start(page, WECHAT_ITEMS[2]) : null));
}

function start(page, picked) {
  if (!picked || !auth.logged()) return Promise.resolve(null);
  const entry = wechatEntry(picked);
  if (page && typeof page.wechatBind === "function") page.wechatBind(entry);
  return askWechat(page, entry);
}

function backTo(page) {
  if (!page || !page.route) return "";
  if (page.route === "pages/mine/mine") return "";
  return "/" + page.route;
}

let pending = null;

function after(onPass, page) {
  pending = { run: onPass || null, page: page || null };
}

function resume(page) {
  const job = pending;
  pending = null;
  const at = (job && job.page) || page;
  if (at && typeof at.refresh === "function") at.refresh();
  if (job && typeof job.run === "function") job.run();
  return !!job;
}

function settle(res, page) {
  done(res);
  const resumed = resume(page);
  const back = backTo(page);
  if (back && !resumed) tabPage.back(back);
  if (res && res.afterToast) res.afterToast();
  return res;
}

function run(page) {
  wx.showLoading({ title: "登录中" });
  return auth
    .login()
    .then((res) => {
      wx.hideLoading();
      return askWechatPick(page).then(() => {
        res.wechatAsked = true;
        return settle(res, page);
      });
    })
    .catch((err) => {
      wx.hideLoading();
      prompt(err);
      resume(page);
      throw err;
    });
}

module.exports = {
  run,
  start,
  after,
  askLogin,
  WECHAT_ITEMS,
  settle,
  resume,
  askWechat,
  askWechatPick,
  wechatEntry,
  wechatParts,
  takeWechat,
  takeAvatar,
  takeNickname
};
