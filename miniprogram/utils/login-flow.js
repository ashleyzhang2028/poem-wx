const auth = require("./auth");
const store = require("./store");
const sync = require("./sync");
const tabPage = require("./tab-page");
const guard = require("./guard");

const NICK_TOAST_MAX = 20;

function failText(err) {
  const code = (err && err.code) || "";
  if (code === "E_NOT_CONFIGURED") {
    return {
      title: "未连接同步服务",
      content:
        "登录服务暂不可用，账号与进度仅存于本机，更换设备后将无法找回。\n\n"
        + "此问题须由服务维护方处理，联系方式见「关于」。"
    };
  }
  if (code === "E_CLOUD_OFF" || code === "E_CLOUD_INIT") {
    return {
      title: "未连接同步服务",
      content:
        "登录与同步依赖服务器，当前版本尚未配置。\n\n"
        + "此问题须由服务维护方处理，联系方式见「关于」。"
    };
  }
  if (code === "E_WX_NOT_CONFIGURED" || code === "E_WX_CONFIG" || code === "E_WX_TABLE") {
    return {
      title: "登录未成功",
      content: ((err && err.message) || "") + "\n\n此为服务端问题，请通过「关于」中的方式联系服务维护方。"
    };
  }
  return null;
}

function reenterText(err) {
  if (!sync.sessionGone(err)) return null;
  return {
    title: "登录状态已失效",
    content: "服务器不再认这台手机的登录（服务端换过 SESSION_SECRET、会话过期或已被吊销都会这样）。"
      + "点一次登录即可继续同步，本机进度仍在。"
  };
}

function sendFail(err) {
  if (err && err.cloudFail) {
    wx.showModal({
      title: "无法连接服务器",
      content: (err.message || "") + "\n\n请将以上信息完整反馈给服务维护方。",
      showCancel: false,
      confirmText: "知悉"
    });
    return true;
  }
  if (err && err.statusCode) {
    const say = err.message || "";
    const code = err.code || String(err.statusCode);
    wx.showModal({
      title: "服务器返回异常",
      content: (say || "服务器返回 " + err.statusCode) + "\n\n（" + code + "）请将以上信息完整反馈给服务维护方。",
      showCancel: false,
      confirmText: "知悉"
    });
    return true;
  }
  if (err && err.host) {
    wx.showModal({
      title: "无法访问服务器",
      content: "无法访问 " + (err.host || err.baseUrl) + "："
        + ((err.errMsg || err.message) || "无响应")
        + "\n\n可能因域名未备案或被拦截，请将以上信息反馈给服务维护方。",
      showCancel: false,
      confirmText: "知悉"
    });
    return true;
  }
  return false;
}

function prompt(err) {
  if (sendFail(err)) return;

  const box = reenterText(err) || failText(err);
  if (!box) {
    wx.showToast({ title: (err && err.message) || "登录未完成", icon: "none" });
    return;
  }
  wx.showModal({ title: box.title, content: box.content, showCancel: false, confirmText: "知悉" });
}

function done(res) {
  const title = res && res.synced ? "登录成功，进度已恢复" : "登录成功，本机记录已保留";
  wx.showToast({ title, icon: "none", duration: 2500 });
}

const listeners = [];

function watch(fn) {
  if (typeof fn !== "function" || listeners.indexOf(fn) >= 0) return fn;
  listeners.push(fn);
  return fn;
}

function unwatch(fn) {
  const at = listeners.indexOf(fn);
  if (at >= 0) listeners.splice(at, 1);
}

function report(res) {
  const box = { logged: auth.logged(), synced: !!(res && res.synced) };
  listeners.slice().forEach((fn) => {
    try {
      fn(box);
    } catch (e) {
      console.error("[login] 订阅方刷新失败", e);
    }
  });
}

function takeAvatar(url) {
  if (!url) return false;
  store.saveProfile({ avatarLocal: url });
  wx.showToast({ title: "头像已更新", icon: "none" });
  return true;
}

function takeNickname(name) {
  const nickname = String(name == null ? "" : name).replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, auth.NICK_MAX);
  if (!nickname) return Promise.resolve({ saved: false });
  const before = store.profile().nickname || "";
  store.saveProfile({ nickname });
  sync.markDirty();
  return auth.saveNickname(nickname).then((r) => {
    if (r && r.blocked) {
      store.saveProfile({ nickname: before });
      const why = String((r && r.reason) || "").trim() || "昵称不可用，请更换";
      if (why.length <= NICK_TOAST_MAX) wx.showToast({ title: why, icon: "none" });
      else wx.showModal({ title: "昵称未更新", content: why, showCancel: false, confirmText: "知悉" });
    } else {
      wx.showToast({ title: "昵称已更新", icon: "none" });
    }
    return r;
  });
}

let asking = false;

function askLogin(page) {
  if (auth.logged() || asking) return Promise.resolve(null);
  asking = true;
  return run(page).then(
    (res) => {
      asking = false;
      return res;
    },
    (err) => {
      asking = false;
      throw err;
    }
  );
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

function cancel() {
  pending = null;
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
  report(res);
  const back = backTo(page);
  if (back && !resumed) tabPage.back(back);
  return res;
}

function askReenter(page, err, drop) {
  const at = (page && typeof page.refresh === "function") ? page : null;
  const say = reenterText(err);
  if (!say || asking) return null;
  asking = true;
  if (drop || !auth.logged()) store.saveSession({ logged: false, tier: "", tierFromServer: false });
  if (at) at.refresh();
  const ui = typeof wx === "undefined" || !wx ? null : wx;
  if (!ui || typeof ui.showModal !== "function") {
    asking = false;
    return say;
  }
  ui.showModal({
    title: say.title,
    content: say.content,
    confirmText: "重新登录",
    cancelText: "取消",
    complete: () => {
      asking = false;
    },
    success: (r) => {
      sync.rearm();
      if (r && r.confirm) askLogin(null).catch(() => {});
    }
  });
  return say;
}

let shownAt = null;

function mark(page) {
  if (!page || typeof page.onShow !== "function") return;
  if (!shownAt) shownAt = { page, at: Date.now() };
}

function reboot(page) {
  const held = shownAt;
  shownAt = null;
  if (!held || held.page !== page) return false;
  page.onShow();
  return true;
}

function run(page) {
  if (guard.busy("login")) return Promise.resolve(null);
  mark(page);
  wx.showLoading({ title: "正在登录" });
  return guard
    .once("login", () => auth.login())
    .then((res) => {
      wx.hideLoading();
      if (res && res.skipped) return null;
      done(res);
      reboot(page);
      return settle(res, page);
    })
    .catch((err) => {
      wx.hideLoading();
      reboot(page);
      prompt(err);
      resume(page);
      throw err;
    });
}

module.exports = {
  run,
  after,
  cancel,
  askLogin,
  settle,
  resume,
  report,
  askReenter,
  takeAvatar,
  takeNickname,
  watch,
  unwatch
};
