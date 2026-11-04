const store = require("./utils/store");
const corpus = require("./utils/corpus");
const sync = require("./utils/sync");
const entitlement = require("./utils/entitlement");
const gate = require("./utils/gate");
const font = require("./utils/font");
const theme = require("./utils/theme");
const loginFlow = require("./utils/login-flow");
const sfx = require("./utils/sfx");
const errors = require("./utils/error-log");
const pageStack = require("./utils/page-stack");

App({
  globalData: {

    pending: null
  },

  onError(err) {
    const detail = errors.say(err);
    errors.add("error", detail.split("\n")[0], detail);
    console.error("[app] 未捕获异常", detail);
  },

  onUnhandledRejection(res) {
    const detail = errors.say(res && res.reason);
    errors.add("rejection", detail.split("\n")[0], detail);
    console.error("[app] 未处理的失败", detail);
  },

  onPageNotFound(res) {
    errors.add("route", "页面不存在：" + ((res && res.path) || ""));
  },

  onLaunch() {
    store.migrate();
    this.stampBuild();

    corpus.warm();
    corpus.dropLegacy();

    this.reloadFont();
    loginFlow.watch(() => this.reloadFont());
    sfx.warm();

    if (gate.logged()) entitlement.sync().then(() => this.reloadFont()).catch(() => {});

    this.syncTimer = setTimeout(() => {
      if (gate.logged()) sync.now().catch(() => {});
    }, 3000);
  },

  onShow() {
    store.touchDaily();
    font.restore();
    this.reloadFont();
    this.refreshTierHourly();
  },

  refreshTierHourly() {
    if (!gate.logged() || !store.tierDue()) return;
    entitlement
      .sync()
      .then(() => {
        store.touchTier();
        this.reloadFont();
      })
      .catch(() => {});
  },

  reloadFont() {
    font.refresh();
  },

  repaintFont(epoch) {
    if (epoch !== font.scope()) return;
    const themeStyle = theme.style();
    pageStack.list().forEach((page) => {
      if (!page) return;
      if (typeof page.applyFont === "function") page.applyFont();
      else if (page.data && page.data.themeStyle !== undefined) page.setData({ themeStyle });
    });
  },

  onPageShow() {
    if (!font.globalOn()) return;
    font.registerHere().catch(() => {});
  },

  stampBuild() {
    let info = null;
    try {
      info = (wx.getAccountInfoSync() || {}).miniProgram || null;
    } catch (e) {
      info = null;
    }
    corpus.stamp(info && info.version);
  },

  onHide() {
    if (this.syncTimer) clearTimeout(this.syncTimer);
    if (gate.logged()) sync.flush().catch(() => {});
  }
});
