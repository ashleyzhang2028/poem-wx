const entitlement = require("../../../utils/entitlement");
const view = require("../../../utils/tier-view");
const theme = require("../../../utils/theme");

Page({
  data: {
    themeStyle: "",
    logged: false,
    status: {},
    heads: [],
    compareGroups: [],
    compareSummary: [],
    stats: { caps: 0, enabled: 0 }
  },

  onShow() {
    theme.apply(this);
    this.refresh();
  },

  refresh() {
    const snap = entitlement.snapshot();

    this.setData({
      logged: snap.logged,
      status: snap,
      heads: entitlement.compareCols(snap),
      compareGroups: entitlement.compareGroups(snap),
      compareSummary: entitlement.compareSummary(snap),
      stats: view.stats()
    });
  },

  onLogin() {
    require("../../../utils/tab-page").mine();
  }
});
