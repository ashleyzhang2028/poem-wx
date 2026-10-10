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

  onHide() {
    if (this.syncTimer) clearTimeout(this.syncTimer);
  }
});
