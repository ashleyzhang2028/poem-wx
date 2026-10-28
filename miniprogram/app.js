const store = require("./utils/store");
const corpus = require("./utils/corpus");
const sync = require("./utils/sync");
const entitlement = require("./utils/entitlement");
const gate = require("./utils/gate");
const font = require("./utils/font");
const loginFlow = require("./utils/login-flow");
const sfx = require("./utils/sfx");

App({
  globalData: {

    pending: null
  },

  onLaunch() {
    store.migrate();
    this.stampBuild();

    corpus.course();
    corpus.dropLegacy();

    console.info(
      "[跬步] 版本 " + (corpus.stamp().rev || "本地打开 · 未上传") +
      " · 语料 " + (corpus.hasData() ? "已载入" : "没进这个包")
    );

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
    getCurrentPages().forEach((page) => {
      if (page && typeof page.applyFont === "function") page.applyFont();
    });
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
