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

function sendFail(err) {
  if (err && err.cloudFail) {
    wx.showModal({
      title: "登录没有连上服务器",
      content: (err.message || "") + "\n\n这不是这台手机能改的，把这整段发给部署方。",
      showCancel: false,
      confirmText: "好"
    });
    return true;
  }
  if (err && err.statusCode) {
    const say = err.message || "";
    const code = err.code || String(err.statusCode);
    wx.showModal({
      title: "登录没有连上服务器",
      content: (say || "服务器回了 " + err.statusCode) + "\n\n（" + code + "）这不是这台手机能改的，把这整段发给部署方。",
      showCancel: false,
      confirmText: "好"
    });
    return true;
  }
  if (err && err.host) {
    wx.showModal({
      title: "登录没有连上服务器",
      content: "服务器在 " + (err.baseUrl || err.host) + "，这台手机打不通："
        + ((err.errMsg || err.message) || "没有回话")
        + "\n\n多半是域名没备案或被拦，这不是这台手机能改的，把这段发给部署方。",
      showCancel: false,
      confirmText: "好"
    });
    return true;
  }
  return false;
}

function prompt(err) {
  if (sendFail(err)) return;

  const box = failText(err);
  if (!box) {
    wx.showToast({ title: (err && err.message) || "登录未完成", icon: "none" });
    return;
  }
  wx.showModal({ title: box.title, content: box.content, showCancel: false, confirmText: "好" });
}

function done(res) {
  const title = res && res.synced ? "已登录 · 进度已认回" : "已登录 · 这台手机上的记录还在";
  wx.showToast({ title, icon: "none", duration: 2500 });
}

function share(action, page) {
  const at = action || {};
  const url = String(at.avatar || "").trim();
  if (!url || !auth.logged()) return Promise.resolve(null);
  takeAvatar(url, at.nickname);
  if (!at.nickname) return Promise.resolve({ avatar: url, nickname: "" });
  return askNickname(page).then((typed) => {
    if (!typed) return { avatar: url, nickname: "" };
    return takeNickname(typed).then((res) => ({
      avatar: url,
      nickname: res && res.saved ? typed : ""
    }));
  });
}

function takeAvatar(url, keepQuiet) {
  if (!url) return false;
  store.saveProfile({ avatarLocal: url });
  if (!keepQuiet) wx.showToast({ title: "头像已换成微信的", icon: "none" });
  return true;
}

function takeNickname(name) {
  const nickname = String(name == null ? "" : name).replace(/[\u0000-\u001f<>]/g, "").trim();
  if (!nickname) return Promise.resolve({ saved: false });
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
    return r;
  });
}

const ASK = {
  login: () => ({
    title: "登录",
    confirmText: "登录"
  }),
  wechat: () => ({
    title: "换成微信的",
    content: "头像和昵称换成微信里的那一份。\n\n"
      + "头像只留在这台手机上，不同步、也不上传。",
    confirmText: "换掉"
  }),
  nickname: () => ({
    title: "填一个昵称",
    editable: true,
    placeholderText: "键盘上方可以选微信昵称",
    confirmText: "好"
  })
};

function ask(box) {
  return new Promise((resolve) => {
    wx.showModal({
      title: box.title,
      content: box.content,
      editable: box.editable,
      placeholderText: box.placeholderText,
      confirmText: box.confirmText,
      cancelText: "取消",
      success: (r) => resolve(r && r.confirm ? (box.editable ? String(r.content || "") : true) : ""),
      fail: () => resolve("")
    });
  });
}

function askWechat(page) {
  if (!auth.logged()) return Promise.resolve(false);
  return ask(ASK.wechat()).then((ok) => (ok ? goIdentity(page) : false));
}

function goIdentity(page) {
  if (page && typeof page.showIdentity === "function") {
    page.showIdentity();
    return true;
  }
  wx.showToast({ title: "在「我的」点一下头像圆", icon: "none", duration: 2500 });
  return false;
}

function start(page, action) {
  if (!action || !auth.logged()) return Promise.resolve(null);
  return share(action, page);
}

function askLogin(page) {
  if (auth.logged()) return Promise.resolve(null);
  const host = revive(page) || page;
  return ask(ASK.login()).then((ok) => (ok ? run(host) : null));
}

function identityHost(page) {
  const at = page || {};
  if (typeof at.wechatBind === "function") return at;
  const panel = typeof at.selectComponent === "function" ? at.selectComponent("#login") : null;
  return panel && typeof panel.wechatBind === "function" ? panel : null;
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
  const resumed = resume(page);
  const back = backTo(page);
  if (back && !resumed) tabPage.back(back);
  return res;
}

function revive(page) {
  const host = identityHost(page);
  if (host && typeof host.done === "function") host.done();
  return host;
}

function run(page) {
  const at = revive(page) || page;
  wx.showLoading({ title: "登录中" });
  return auth
    .login()
    .then((res) => {
      wx.hideLoading();
      done(res);
      return askWechat(at).then((asked) => {
        res.wechatAsked = asked;
        return settle(res, at);
      });
    })
    .catch((err) => {
      wx.hideLoading();
      prompt(err);
      resume(at);
      throw err;
    });
}

module.exports = {
  run,
  start,
  after,
  askLogin,
  settle,
  resume,
  askWechat,
  share,
  takeAvatar,
  takeNickname
};
