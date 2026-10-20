const store = require("../../../utils/store");
const pinyin = require("../../../utils/pinyin");
const entitlement = require("../../../utils/entitlement");
const gate = require("../../../utils/gate");
const theme = require("../../../utils/theme");
const tabbar = require("../../../utils/tabbar");
const sync = require("../../../utils/sync");
const sfx = require("../../../utils/sfx");
const seasonal = require("../../../utils/seasonal");
const tabPage = require("../../../utils/tab-page");
const icons = require("../../../utils/icons");

const ALIGNS = [
  { key: "left", label: "左对齐", icon: icons.left },
  { key: "center", label: "居中", icon: icons.center }
];

const FONT_MIN = -2;
const FONT_MAX = 4;

const PINYIN_MODES = [
  { key: "off", label: "不注音", icon: icons.off, desc: "正文不带拼音" },
  { key: "all", label: "全文", icon: icons.all, desc: "逐字标音" }
];

Page({
  data: {
    themeStyle: "",
    barBelow: true,
    aligns: ALIGNS,
    align: "center",
    fontSize: 0,
    fontMin: FONT_MIN,
    fontMax: FONT_MAX,
    pinyinModes: PINYIN_MODES,
    pinyin: "off",

    pinyinOn: false,
    pinyinNote: "",
    locked: false,

    themeColor: theme.currentTheme().rgba,

    sfxVisible: false,
    sfxOn: true,

    seasonalOn: true,
    seasonalLock: false,
    seasonalNote: ""
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
    const prOn = pr.usable && entitlement.can("pinyin");
    const fx = sfx.readiness();
    this.setData(
      Object.assign({ locked: false }, settings, {
        themeColor: theme.currentTheme().rgba,
        sfxVisible: fx.visible,
        sfxOn: sfx.enabled(),
        seasonalOn: !seasonal.switched(),
        seasonalLock: !seasonal.canSwitch(),
        seasonalNote: seasonal.canSwitch() ? "" : seasonal.hintOf(),
        pinyin: prOn ? settings.pinyin : "off",
        pinyinOn: prOn,
        pinyinNote: prOn
          ? ""
          : pr.usable
            ? "注音要登录并且档位够才开。"
            : "读音表还没生成。跑一次 build-data.js 就会带上 —— 生成前这一栏不显示，"
              + "免得留个点了没反应的控件。"
      })
    );
  },

  onLogin() {
    tabPage.mine();
  },

  onAlign(e) {
    const align = e.detail.value;
    store.saveSettings({ align });
    this.setData({ align });
    sync.markDirty();
  },

  onFontSlide(e) {
    const fontSize = Math.max(FONT_MIN, Math.min(FONT_MAX, Number(e.detail.value)));
    if (fontSize === this.data.fontSize) return;
    store.saveSettings({ fontSize });
    this.setData({ fontSize });
    sync.markDirty();
  },

  onPinyin(e) {
    const mode = e.detail.value;
    if (!pinyin.setMode(mode)) return;
    this.setData({ pinyin: mode });
  },

  onSeasonal(e) {
    const r = seasonal.setOn(e.detail.value);
    if (!r.ok) {
      wx.showToast({ title: seasonal.hintOf(), icon: "none" });
    }
    this.setData({ seasonalOn: !seasonal.switched(), seasonalLock: !seasonal.canSwitch() });
    if (r.ok) sync.markDirty();
  },

  onSfx(e) {
    this.setData({ sfxOn: sfx.setEnabled(e.detail.value) });
  },

  onSfxTest() {
    if (!sfx.preview()) {
      wx.showToast({ title: "这台设备出不了声", icon: "none" });
    }
  },

  onClearData() {
    wx.showModal({
      title: "清空数据",
      content: "背诵进度、已读标记、今日加背都会删掉，本机与云端的记录一起清，且无法恢复。",
      confirmText: "清空",
      cancelText: "取消",
      confirmColor: "#a83b32",
      success: (res) => {
        if (!res.confirm) return;
        store.clearProgress();
        sync.markDirty();
        wx.showToast({ title: "已清空", icon: "success" });
      }
    });
  }

});
