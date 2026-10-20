const theme = require("../../../utils/theme");
const gate = require("../../../utils/gate");
const tabbar = require("../../../utils/tabbar");
const tabPage = require("../../../utils/tab-page");

Page({
  data: {
    themeStyle: "",
    barBelow: true,
    locked: false,

    items: theme.palette(),
    theme: theme.DEFAULT
  },

  onShow() {
    theme.apply(this);
    this.setData({ barBelow: tabbar.below(this) });
    if (!gate.logged()) {
      this.setData({ locked: true });
      return;
    }
    this.setData({ locked: false, theme: theme.current() });
  },

  onLogin() {
    tabPage.mine();
  },

  onPick(e) {
    const key = e.currentTarget.dataset.key;
    if (key === this.data.theme) return;
    const picked = theme.set(key);
    theme.apply(this);
    this.setData({ theme: picked.key });
    wx.vibrateShort && wx.vibrateShort({ type: "light" });
  }
});
