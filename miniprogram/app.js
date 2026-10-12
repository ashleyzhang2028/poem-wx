const store = require("./utils/store");
const corpus = require("./utils/corpus");
const sync = require("./utils/sync");
const entitlement = require("./utils/entitlement");
const gate = require("./utils/gate");
const font = require("./utils/font");

App({
  globalData: {

    pending: null
  },

  onLaunch() {
    store.migrate();
    this.stampBuild();

    corpus.course();
    corpus.manifest();

    font.load().catch(() => {});

    if (gate.logged()) entitlement.sync().catch(() => {});

    this.syncTimer = setTimeout(() => {
      if (gate.logged()) sync.now().catch(() => {});
    }, 3000);
  },

  onShow() {
    store.touchDaily();
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
  }
});
