const theme = require("../../../utils/theme");
const tabPage = require("../../../utils/tab-page");
const entitlement = require("../../../utils/entitlement");

Page({
  data: { themeStyle: "" },

  onShow() {
    theme.apply(this);
  },

  onLogin() {
    tabPage.mine();
  },

  onTierGate() {}
});
