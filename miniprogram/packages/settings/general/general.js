const store = require("../../../utils/store");
const entitlement = require("../../../utils/entitlement");
const gate = require("../../../utils/gate");
const theme = require("../../../utils/theme");
const font = require("../../../utils/font");
const tabbar = require("../../../utils/tabbar");
const sync = require("../../../utils/sync");
const sfx = require("../../../utils/sfx");
const seasonal = require("../../../utils/seasonal");
const league = require("../../../utils/league");
const scale = require("../../../utils/type-scale");
const tiers = require("../../../utils/tiers");
const cols = require("../../../utils/collections");

Page({
  data: {
    themeStyle: "",
    name: "",
    barBelow: true,
    fontSize: 0,
    fontMin: scale.MIN,
    fontMax: scale.MAX,
    locked: false,

    themeColor: theme.currentTheme().rgba,

    sfxVisible: false,
    sfxOn: true,

    seasonalOn: true,
    seasonalLock: false,
    seasonalTier: "pro",

    leagueBoardOn: true,
    leagueLock: false,
    leagueTier: "max"
  },

  applyFont() {
    const hit = font.bind(theme.style());
    this.setData({ themeStyle: hit.page.themeStyle });
  },

  onShow() {
    this.applyFont();
    this.setData({ barBelow: tabbar.below(this) });
    if (!gate.logged()) {
      this.setData({ locked: true });
      return;
    }

    const settings = store.settings();
    const fx = sfx.readiness();
    this.setData({
      locked: false,
      fontSize: scale.clamp(settings.fontSize),
      themeColor: theme.currentTheme().rgba,
      sfxVisible: fx.visible,
      sfxOn: sfx.enabled(),
      seasonalOn: !seasonal.switched(),
      seasonalLock: seasonal.locked(),
      seasonalTier: seasonal.tier(),
      leagueBoardOn: league.canJoin() && settings.leagueBoard !== false,
      leagueLock: league.locked(),
      leagueTier: league.tier()
    });
  },

  onFontSlide(e) {
    const fontSize = scale.clamp(e.detail.value);
    if (fontSize === this.data.fontSize) return;
    store.saveSettings({ fontSize });
    this.setData({ fontSize });
    sync.markDirty();
  },

  onSeasonal(e) {
    const r = seasonal.setOn(e.detail.value);
    if (!r.ok) {
      wx.showToast({ title: tiers.nameOf(seasonal.tier()) + " 起可用", icon: "none" });
    }
    this.setData({ seasonalOn: !seasonal.switched(), seasonalLock: seasonal.locked() });
    if (r.ok) sync.markDirty();
  },

  onLeagueBoard(e) {
    const r = league.setOn(e.detail.value);
    if (!r.ok) wx.showToast({ title: league.tier() + " 起可用", icon: "none" });
    this.setData({ leagueBoardOn: league.canJoin() && !league.switched(), leagueLock: league.locked() });
    if (r.ok) sync.markDirty();
  },

  onSfx(e) {
    this.setData({ sfxOn: sfx.setEnabled(e.detail.value) });
  },

  onSfxTest() {
    if (!sfx.preview()) {
      wx.showToast({ title: "本设备无法发声", icon: "none" });
    }
  },

  onClearData() {
    wx.showModal({
      title: "清空数据",
      content: "背诵进度、已读标记、今日加背及自选集合里的篇目将被删除，本机与云端记录一并清除，且不可恢复。",
      confirmText: "清空",
      cancelText: "取消",
      confirmColor: "#a83b32",
      success: (res) => {
        if (!res.confirm) return;
        store.clearProgress();
        cols.prune();
        sync.markDirty();
        wx.showToast({ title: "已清空", icon: "success" });
      }
    });
  }

});
