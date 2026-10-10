const store = require("../../../utils/store");
const sfx = require("../../../utils/sfx");
const gate = require("../../../utils/gate");
const theme = require("../../../utils/theme");

Page({
  data: {
    themeStyle: "",
    sfxVisible: false,
    sfxOn: true,
    locked: false
  },

  onShow() {
    theme.apply(this);

    if (!gate.logged()) {
      this.setData({ locked: true, sfxVisible: false });
      return;
    }
    const fx = sfx.readiness();

    this.setData({ locked: false, sfxVisible: fx.visible, sfxOn: sfx.enabled() });
  },

  onLogin() {
    wx.navigateTo({ url: "/pages/mine/mine?login=1" });
  },

  onSfx(e) {
    this.setData({ sfxOn: sfx.setEnabled(e.detail.value) });
  },

  onSfxTest() {
    if (!sfx.preview()) {
      wx.showToast({ title: "这台设备出不了声", icon: "none" });
    }
  }
});
