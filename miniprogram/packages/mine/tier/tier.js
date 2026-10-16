const theme = require("../../../utils/theme");
const tabPage = require("../../../utils/tab-page");

Page({
  data: { themeStyle: "" },

  onShow() {
    theme.apply(this);
  },

  onLogin() {
    tabPage.mine();
  }
});
