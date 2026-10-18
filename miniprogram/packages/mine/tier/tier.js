const theme = require("../../../utils/theme");
const tabbar = require("../../../utils/tabbar");
const tabPage = require("../../../utils/tab-page");
const entitlement = require("../../../utils/entitlement");

Page({
  data: { themeStyle: "" },

  onShow() {
    theme.apply(this);
    this.setData({ barBelow: tabbar.below(this) });
  },

  onLogin() {
    tabPage.mine();
  },

  onTierGate() {}
});
