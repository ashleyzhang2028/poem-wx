const store = require("../../../utils/store");
const pinyin = require("../../../utils/pinyin");
const entitlement = require("../../../utils/entitlement");
const gate = require("../../../utils/gate");
const theme = require("../../../utils/theme");
const tabbar = require("../../../utils/tabbar");
const sync = require("../../../utils/sync");
const sfx = require("../../../utils/sfx");
const seasonal = require("../../../utils/seasonal");
const league = require("../../../utils/league");
const icons = require("../../../utils/icons");
const scale = require("../../../utils/type-scale");
const corpus = require("../../../utils/corpus");
const tiers = require("../../../utils/tiers");
const cols = require("../../../utils/collections");

const ALIGNS = [
  { key: "left", label: "左对齐", icon: icons.left },
  { key: "center", label: "居中", icon: icons.center }
];

const SAMPLE = "举头望明月，低头思故乡。";

const PINYIN_MODES = [
  { key: "off", label: "不注音", icon: icons.off, desc: "正文不带拼音" },
  { key: "all", label: "全文", icon: icons.all, desc: "逐字标音" }
];

Page({
  data: {
    themeStyle: "",
    name: "",
    barBelow: true,
    aligns: ALIGNS,
    align: "center",
    fontSize: 0,
    fontMin: scale.MIN,
    fontMax: scale.MAX,
    pinyinModes: PINYIN_MODES,
    pinyin: "off",

    pinyinOn: false,
    sampleTokens: [],
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

  onShow() {
    theme.apply(this);
    this.setData({ barBelow: tabbar.below(this) });
    if (!gate.logged()) {
      this.setData({ locked: true });
      return;
    }

    const settings = store.settings();
    const pr = pinyin.readiness();
    const size = scale.clamp(settings.fontSize);
    const prOn = pr.usable && entitlement.can("pinyin");
    const fx = sfx.readiness();
    this.setData(
      Object.assign({ locked: false }, settings, {
        themeColor: theme.currentTheme().rgba,
        sfxVisible: fx.visible,
        sfxOn: sfx.enabled(),
        seasonalOn: !seasonal.switched(),
        seasonalLock: seasonal.locked(),
        seasonalTier: seasonal.tier(),
        leagueBoardOn: league.canJoin() && settings.leagueBoard !== false,
        leagueLock: league.locked(),
        leagueTier: league.tier(),
        pinyin: prOn ? settings.pinyin : "off",
        pinyinOn: prOn,
        sampleTokens: this.sample(prOn ? settings.pinyin : "off", size)
      })
    );
  },


  sample(mode, size) {
    return pinyin.render(corpus.layout(SAMPLE, { size, pinyin: mode === "all" }).paras, mode);
  },

  onAlign(e) {
    const align = e.detail.value;
    store.saveSettings({ align });
    this.setData({ align });
    sync.markDirty();
  },

  onFontSlide(e) {
    const fontSize = scale.clamp(e.detail.value);
    if (fontSize === this.data.fontSize) return;
    store.saveSettings({ fontSize });
    this.setData({ fontSize, sampleTokens: this.sample(this.data.pinyin, fontSize) });
    sync.markDirty();
  },

  onPinyin(e) {
    const mode = e.detail.value;
    if (!pinyin.setMode(mode)) return;
    this.setData({ pinyin: mode, sampleTokens: this.sample(mode, this.data.fontSize) });
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
