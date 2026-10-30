const store = require("../../../utils/store");
const gate = require("../../../utils/gate");
const theme = require("../../../utils/theme");
const font = require("../../../utils/font");
const tabbar = require("../../../utils/tabbar");
const sync = require("../../../utils/sync");
const sfx = require("../../../utils/sfx");
const dailyPoem = require("../../../utils/daily-poem");
const league = require("../../../utils/league");
const tiers = require("../../../utils/tiers");
const cols = require("../../../utils/collections");

Page({
  data: {
    themeStyle: "",
    name: "",
    barBelow: true,
    locked: false,

    themeColor: theme.currentTheme().rgba,

    sfxVisible: false,
    sfxOn: true,

    dailyPoemOn: true,
    dailyPoemLock: false,
    dailyPoemTier: "pro",

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
    this.setData(
      Object.assign({ locked: false }, settings, {
        themeColor: theme.currentTheme().rgba,
        sfxVisible: fx.visible,
        sfxOn: sfx.enabled(),
        dailyPoemOn: !dailyPoem.switched(),
        dailyPoemLock: dailyPoem.locked(),
        dailyPoemTier: dailyPoem.tier(),
        leagueBoardOn: league.canJoin() && settings.leagueBoard !== false,
        leagueLock: league.locked(),
        leagueTier: league.tier()
      })
    );
  },

  onDailyPoem(e) {
    const r = dailyPoem.setOn(e.detail.value);
    if (!r.ok) {
      wx.showToast({ title: tiers.nameOf(dailyPoem.tier()) + " 起可用", icon: "none" });
    }
    this.setData({ dailyPoemOn: !dailyPoem.switched(), dailyPoemLock: dailyPoem.locked() });
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

  onAbout() {
    wx.navigateTo({ url: "/packages/settings/about/about" });
  },

  onClearData() {
    wx.showModal({
      title: "清空数据",
      content: "温习进度、已读标记与新增温习将被清除，本机与云端一并删除，不可恢复。自选集合与书签不受影响。",
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
