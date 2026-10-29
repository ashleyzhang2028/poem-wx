const theme = require("../../../utils/theme");
const font = require("../../../utils/font");
const tabbar = require("../../../utils/tabbar");
const entitlement = require("../../../utils/entitlement");

Page({
  data: { themeStyle: "", name: "" },

  onShow() {
    this.applyFont();
    theme.apply(this);
    this.setData({ barBelow: tabbar.below(this) });
  },

  applyFont() {
    const hit = font.bind(theme.style());
    this.setData({ themeStyle: hit.page.themeStyle });
    font.registerHere().catch(() => {});
  },

  onTierGate() {}
});
