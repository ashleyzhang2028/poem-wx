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

function wechatPick() {
  return new Promise((resolve) => {
    wx.showActionSheet({
      itemList: WECHAT_ITEMS,
      success: (r) => resolve(WECHAT_ITEMS[r && r.tapIndex] || ""),
      fail: () => resolve("")
    });
  });
}

function askWechat(page) {
  return wechatPick().then((picked) => {
    if (!picked) return "";
    const action = wechatActionOf(picked);
    const after = () => resume(page);
    return action.avatar
      .then((url) => {
        if (url) takeAvatar(url, !!action.nickname);
        if (!action.nickname) {
          after();
          return "";
        }
        return action.nickname.then((name) => {
          return takeNickname(name, after);
        });
      })
      .catch((err) => {
        prompt(err);
        after();
        throw err;
      });
  });
}

function wechatActionOf(picked) {
  if (picked === WECHAT_ITEMS[0]) {
    return { avatar: pickAvatar(), nickname: null };
  }
  if (picked === WECHAT_ITEMS[1]) {
    return { avatar: Promise.resolve(""), nickname: pickNickname() };
  }
  return { avatar: pickAvatar(), nickname: pickNickname() };
}

function pickAvatar() {
  return new Promise((resolve) => {
    wx.chooseAvatar({
      success: (r) => resolve((r && r.avatarUrl) || ""),
      fail: () => resolve("")
    });
  });
}

function pickNickname() {
  return new Promise((resolve) => {
    wx.showModal({
      title: "微信昵称",
      editable: true,
      placeholderText: "填微信里的昵称",
      confirmText: "用",
      cancelText: "取消",
      success: (r) => resolve(r && r.confirm ? (r.content || "").trim() : ""),
      fail: () => resolve("")
    });
  });
}

function takeAvatar(url, withNickname) {
  if (!url) return false;
  store.saveProfile({ avatarLocal: url });
  if (!withNickname) wx.showToast({ title: "头像已换成微信的", icon: "none" });
  return true;
}

function takeNickname(name, after) {
  const nickname = String(name == null ? "" : name).replace(/[\u0000-\u001f<>]/g, "").trim();
  if (!nickname) {
    if (after) after();
    return Promise.resolve({ saved: false });
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

function backTo(page) {
  if (!page || !page.route) return "";
  if (page.route === "pages/mine/mine") return "";
  return "/" + page.route;
}

function resume(page) {
  const step = require("./gate");
  if (!step || typeof step.resume !== "function") {
    if (page && typeof page.refresh === "function") page.refresh();
    return false;
  }
  return step.resume(page);
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
      return askWechat(page).then(() => {
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

module.exports = { run, settle, resume, askWechat, takeAvatar, takeNickname };
