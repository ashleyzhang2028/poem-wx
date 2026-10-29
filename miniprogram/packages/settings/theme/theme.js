const theme = require("../../../utils/theme");
const tone = require("../../../utils/color-tone");
const picker = require("../../../utils/color-picker");
const custom = require("../../../utils/custom-banner");
const font = require("../../../utils/font");
const gate = require("../../../utils/gate");
const tabbar = require("../../../utils/tabbar");
const tiers = require("../../../utils/tiers");
const loginFlow = require("../../../utils/login-flow");

Page({
  data: {
    themeStyle: "",
    name: "",
    barBelow: true,
    locked: false,

    banner: theme.BANNER,
    own: theme.OWN,
    ownSet: false,

    groups: theme.groups(),
    theme: theme.DEFAULT,

    toneView: {},
    toneLocked: true,

    fonts: [],
    font: font.DEFAULT,
    fontSample: font.SAMPLE,
    fontLocked: true,
    fontTier: "pro"
  },

  onShow() {
    theme.apply(this);
    this.setData({ barBelow: tabbar.below(this), banner: theme.bannerSrc(), toneView: theme.toneData() });
    this.setData(Object.assign({ locked: !gate.logged() }, this.view()));
    this.warmPreview();
  },

  warmPreview() {
    font.preview().catch(() => {});
  },

  view() {
    const pickable = font.pickable();
    return {
      groups: theme.groups(),
      ownSet: theme.ownSwatchData().set,
      toneLocked: !theme.reachable(theme.OWN_KEY),
      theme: theme.current(),
      fonts: font.options().map((f) => Object.assign({}, f, {
        locked: !pickable && f.key !== font.DEFAULT,
        previewFamily: font.face(f.key).previewFamily
      })),
      font: font.current(),
      fontLocked: !pickable,
      fontTier: font.tier(),
      toneView: theme.toneData()
    };
  },


  onPick(e) {
    const key = e.currentTarget.dataset.key;
    if (key === this.data.theme && !tone.current()) return;
    tone.clear();
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
      toneLocked: !theme.reachable(theme.OWN_KEY),
      toneView: theme.toneData()
    });
  },

  toneBlocked() {
    if (theme.groupOpen(theme.GROUPS.filter((g) => g.key === theme.OWN)[0])) return false;
    wx.showToast({ title: tiers.nameOf("max") + " 起可用", icon: "none" });
    return true;
  },

  onToneDrag(e) {
    if (this.toneBlocked()) return;
    const axis = String(e.currentTarget.dataset.axis || "");
    const touch = (e.touches || [])[0] || (e.changedTouches || [])[0];
    if (!touch || !picker.AXES[axis]) return;
    const end = e.type === "touchend" || e.type === "touchcancel";
    const apply = (box) => {
      const hex = picker.fromAxis(axis, (touch.clientX - box.left) / box.width, tone.current());
      if (!hex || hex.toLowerCase() === String(tone.current()).toLowerCase()) return;
      tone.set(hex);
      this.paint();
      if (end && wx.vibrateShort) wx.vibrateShort({ type: "light" });
    };
    wx.createSelectorQuery().in(this).select("#tone-" + axis).boundingClientRect((r) => {
      if (r && r.width) apply(r);
    }).exec();
  },

  onToneHex(e) {
    if (this.toneBlocked()) return;
    const v = String(e.detail.value == null ? "" : e.detail.value).trim();
    if (!tone.parseHex(v)) {
      if (e.type === "blur" || e.type === "confirm") {
        wx.showToast({ title: "HEX 要写成 #8C2F2D", icon: "none" });
      }
      this.setData({ toneView: theme.toneData() });
      return;
    }
    if (String(tone.current()).toLowerCase() === v.toLowerCase()) return;
    tone.set(v);
    this.paint();
    if (e.type === "confirm") wx.vibrateShort && wx.vibrateShort({ type: "light" });
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
    this.setData({ font: font.current() });
    wx.vibrateShort && wx.vibrateShort({ type: "light" });
  }
});
