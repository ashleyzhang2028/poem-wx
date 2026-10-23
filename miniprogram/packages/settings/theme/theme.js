const theme = require("../../../utils/theme");
const tone = require("../../../utils/color-tone");
const custom = require("../../../utils/custom-banner");
const font = require("../../../utils/font");
const gate = require("../../../utils/gate");
const tabbar = require("../../../utils/tabbar");
const tiers = require("../../../utils/tiers");
const loginFlow = require("../../../utils/login-flow");

Page({
  data: {
    themeStyle: "",
    barBelow: true,
    locked: false,

    banner: theme.BANNER,
    own: theme.OWN,
    ownSet: false,

    groups: theme.groups(),
    theme: theme.DEFAULT,
    ownLocked: true,

    toneView: {},
    toneLocked: true,

    fonts: [],
    font: font.DEFAULT,
    fontSample: font.PREVIEW,
    previewFamilyOf: "Kuibu Preview " + font.DEFAULT,
    fontLocked: true,
    fontTier: "pro"
  },

  onShow() {
    theme.apply(this);
    this.setData({ barBelow: tabbar.below(this), banner: theme.bannerSrc(), toneView: theme.toneData() });
    if (!gate.logged()) {
      this.setData({ locked: true });
      return;
    }
    this.setData(Object.assign({ locked: false }, this.view()));
    this.warmPreview();
  },

  warmPreview() {
    font.options().forEach((f) => { font.preview(f.key).catch(() => {}); });
  },

  view() {
    const pickable = font.pickable();
    return {
      groups: theme.groups(),
      ownSet: theme.ownSwatchData().set,
      theme: theme.current(),
      fonts: font.options().map((f) => Object.assign({}, f, {
        locked: !pickable && f.key !== font.DEFAULT,
        previewFamily: "Kuibu Preview " + f.key
      })),
      font: font.current(),
      previewFamilyOf: font.face().previewFamily,
      fontLocked: !pickable,
      fontTier: font.tier(),
      ownLocked: !theme.groupOpen(theme.GROUPS.filter((g) => g.key === theme.OWN)[0]),
      toneLocked: !theme.groupOpen(theme.GROUPS.filter((g) => g.key === theme.OWN)[0]),
      toneView: theme.toneData()
    };
  },


  onPick(e) {
    const key = e.currentTarget.dataset.key;
    if (key === this.data.theme) return;
    theme.set(key);
    this.paint();
  },

  paint() {
    theme.apply(this);
    const swatch = theme.ownSwatchData();
    this.setData({
      theme: theme.current(),
      banner: theme.bannerSrc(),
      groups: theme.groups(),
      ownSet: swatch.set,
      ownLocked: !theme.groupOpen(theme.GROUPS.filter((g) => g.key === theme.OWN)[0]),
      toneLocked: !theme.groupOpen(theme.GROUPS.filter((g) => g.key === theme.OWN)[0]),
      toneView: theme.toneData()
    });
  },

  toneBlocked() {
    if (theme.groupOpen(theme.GROUPS.filter((g) => g.key === theme.OWN)[0])) return false;
    wx.showToast({ title: tiers.nameOf("max") + " 起可用", icon: "none" });
    return true;
  },

  onTonePick(e) {
    if (this.toneBlocked()) return;
    tone.set(e.currentTarget.dataset.hex);
    this.claim();
  },

  onToneHex(e) {
    if (this.toneBlocked()) return;
    const v = String(e.detail.value == null ? "" : e.detail.value).trim();
    if (!tone.parseHex(v)) {
      wx.showToast({ title: "HEX 要写成 #8C2F2D", icon: "none" });
      this.setData({ toneView: theme.toneData() });
      return;
    }
    tone.set(v);
    this.claim();
  },

  onToneReset() {
    if (!tone.current()) {
      wx.showToast({ title: "还没选过主题色", icon: "none" });
      return;
    }
    if (theme.groupOpen(theme.GROUPS.filter((g) => g.key === theme.OWN)[0])) tone.clear();
    this.paint();
    wx.showToast({ title: "已恢复默认主题色", icon: "none" });
  },

  claim() {
    this.paint();
    wx.vibrateShort && wx.vibrateShort({ type: "light" });
  },

  onOwnPick() {
    const item = theme.ownSwatchData();
    if (!item.set) {
      wx.showToast({ title: "先选图", icon: "none" });
      return;
    }
    if (!theme.ownUsable()) {
      wx.showToast({ title: tiers.nameOf("max") + " 起可用", icon: "none" });
      return;
    }
    if (this.data.theme === theme.OWN_KEY) return;
    theme.set(theme.OWN_KEY);
    this.paint();
    wx.vibrateShort && wx.vibrateShort({ type: "light" });
  },

  onOwnUpload() {
    if (!theme.groupOpen(theme.GROUPS.filter((g) => g.key === theme.OWN)[0])) {
      wx.showToast({ title: tiers.nameOf("max") + " 起可用", icon: "none" });
      return;
    }
    custom.choose().then((r) => {
      if (!r.ok) {
        if (r.reason !== "cancel") wx.showToast({ title: "这张图读不出来，换一张试试", icon: "none" });
        return;
      }
      const crop = this.selectComponent("#crop");
      if (!crop) return;
      crop.open(r);
    });
  },

  onCropDone(e) {
    const r = e.detail || {};
    if (!r.ok) {
      wx.showToast({ title: "这张图截不出来，换一张试试", icon: "none" });
      return;
    }
    theme.set(theme.OWN_KEY);
    this.paint();
    wx.showToast({ title: "已换成这一张", icon: "none" });
  },

  onOwnClear() {
    theme.clearOwn();
    this.paint();
    wx.showToast({ title: "已恢复默认 banner", icon: "none" });
  },

  onLogin() {
    loginFlow.run(this);
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
    this.warmPreview();
    wx.vibrateShort && wx.vibrateShort({ type: "light" });
  }
});
