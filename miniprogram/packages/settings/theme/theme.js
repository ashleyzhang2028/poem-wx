const theme = require("../../../utils/theme");
const font = require("../../../utils/font");
const gate = require("../../../utils/gate");
const tabbar = require("../../../utils/tabbar");
const tiers = require("../../../utils/tiers");

Page({
  data: {
    themeStyle: "",
    barBelow: true,
    locked: false,

    banner: theme.BANNER,

    groups: theme.groups(),
    theme: theme.DEFAULT,

    fonts: [],
    font: font.DEFAULT,
    fontLocked: true,
    fontTier: "pro"
  },

  onShow() {
    theme.apply(this);
    this.setData({ barBelow: tabbar.below(this), banner: theme.bannerOf(theme.current()) });
    if (!gate.logged()) {
      this.setData({ locked: true });
      return;
    }
    this.setData(Object.assign({ locked: false }, this.view()));
  },

  view() {
    const pickable = font.pickable();
    return {
      groups: theme.groups(),
      theme: theme.current(),
      fonts: font.options().map((f) => Object.assign({}, f, { locked: !pickable && f.key !== font.DEFAULT })),
      font: font.current(),
      fontLocked: !pickable,
      fontTier: font.tier()
    };
  },


  onPick(e) {
    const key = e.currentTarget.dataset.key;
    if (key === this.data.theme) return;
    theme.set(key);
    theme.apply(this);
    this.setData({ theme: theme.current(), banner: theme.bannerOf(theme.current()) });
    wx.vibrateShort && wx.vibrateShort({ type: "light" });
  },

  onFont(e) {
    const key = e.currentTarget.dataset.key;
    const r = font.set(key);
    if (!r.ok) {
      const title = r.reason === "tier" ? tiers.nameOf(font.tier()) + " 起可用" : "这款字体不存在";
      wx.showToast({ title, icon: "none" });
      this.setData(this.view());
      return;
    }
    if (!r.changed) return;
    this.setData(this.view());
    font.load().catch(() => {});
    font.loadAll();
    wx.vibrateShort && wx.vibrateShort({ type: "light" });
  }
});
