const theme = require("../../../utils/theme");
const tabbar = require("../../../utils/tabbar");
const entitlement = require("../../../utils/entitlement");

Page({
  data: { themeStyle: "", name: "" },

  onShow() {
    theme.apply(this);
    this.setData({ barBelow: tabbar.below(this) });
  },

  onTierGate() {}
});
