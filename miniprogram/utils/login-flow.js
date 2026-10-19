const auth = require("./auth");
const gate = require("./gate");
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

function done(res) {
  if (res && res.synced) {
    wx.showToast({ title: "已登录 · 进度已认回", icon: "none", duration: 2500 });
  } else {
    wx.showToast({ title: "已登录 · 这台手机上的记录还在", icon: "none", duration: 2500 });
  }
}

function backTo(page) {
  if (!page || !page.route) return "";
  if (page.route === "pages/mine/mine") return "";
  return "/" + page.route;
}

function settle(res, page) {
  done(res);
  const resumed = gate.resume(page);
  const back = backTo(page);
  if (back && !resumed) tabPage.back(back);
  return res;
}

function run(page) {
  wx.showLoading({ title: "登录中" });
  return auth
    .login()
    .then((res) => {
      wx.hideLoading();
      return settle(res, page);
    })
    .catch((err) => {
      wx.hideLoading();
      prompt(err);
      gate.resume(page);
      throw err;
    });
}

module.exports = { run, settle };
