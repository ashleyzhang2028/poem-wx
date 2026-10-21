const store = require("./utils/store");
const corpus = require("./utils/corpus");
const sync = require("./utils/sync");
const entitlement = require("./utils/entitlement");
const gate = require("./utils/gate");
const font = require("./utils/font");
const sfx = require("./utils/sfx");

App({
  globalData: {

    pending: null
  },

  onLaunch() {
    store.migrate();
    this.stampBuild();

    corpus.course();
    corpus.manifest();

    console.info(
      "[跬步] 版本 " + (corpus.stamp().rev || "本地打开 · 未上传") +
      " · 语料 " + (corpus.hasData() ? "已载入" : "没进这个包")
    );

    font.load().catch(() => {});
    font.loadAll();
    this.watchFont();
    sfx.warm();

    if (gate.logged()) entitlement.sync().catch(() => {});

    this.syncTimer = setTimeout(() => {
      if (gate.logged()) sync.now().catch(() => {});
    }, 3000);
  },

  onShow() {
    store.touchDaily();
    this.refreshTierHourly();
  },

  refreshTierHourly() {
    if (!gate.logged() || !store.tierDue()) return;
    entitlement
      .sync()
      .then(() => store.touchTier())
      .catch(() => {});
  },

  watchFont() {
    let last = font.face().key + " " + entitlement.status().tier;
    this.fontTimer = setInterval(() => {
      const now = font.face().key + " " + entitlement.status().tier;
      if (now === last) return;
      last = now;
      font.load().catch(() => {});
      font.loadAll();
    }, 2000);
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
    if (this.fontTimer) clearInterval(this.fontTimer);
    if (gate.logged()) sync.flush().catch(() => {});
  }
});
