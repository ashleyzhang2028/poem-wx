const theme = require("../../../utils/theme");
const gate = require("../../../utils/gate");

Page({
  data: {
    items: theme.all(),
    theme: theme.DEFAULT,
    themeStyle: "",
    currentName: "",
    locked: false,

    showPreview: false
  },

  onShow() {

    this.setData({
      currentName: theme.currentTheme().name,
      locked: !gate.logged()
    });
    theme.apply(this);
  },

  onTogglePreview() {
    this.setData({ showPreview: !this.data.showPreview });
  },

  onPick(e) {
    const key = e.currentTarget.dataset.key;
    if (key === this.data.theme) return;
    const picked = theme.set(key);

    theme.apply(this);
    this.setData({ currentName: picked.name });
    wx.vibrateShort && wx.vibrateShort({ type: "light" });
  }
});
