const store = require("../../../utils/store");
const pinyin = require("../../../utils/pinyin");
const entitlement = require("../../../utils/entitlement");
const gate = require("../../../utils/gate");
const theme = require("../../../utils/theme");
const sync = require("../../../utils/sync");
const sfx = require("../../../utils/sfx");
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

    items: theme.palette(),
    theme: theme.DEFAULT,
    themeColor: theme.currentTheme().rgba,

    sfxVisible: false,
    sfxOn: true
  },

  onShow() {
    theme.apply(this);
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
        theme: theme.currentTheme().key,
        themeColor: theme.currentTheme().rgba,
        sfxVisible: fx.visible,
        sfxOn: sfx.enabled(),
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

  onPick(e) {
    const key = e.currentTarget.dataset.key;
    if (key === this.data.theme) return;
    const picked = theme.set(key);
    theme.apply(this);
    this.setData({ themeColor: picked.rgba, theme: picked.key });
    wx.vibrateShort && wx.vibrateShort({ type: "light" });
  },

  onSfx(e) {
    this.setData({ sfxOn: sfx.setEnabled(e.detail.value) });
  },

  onSfxTest() {
    if (!sfx.preview()) {
      wx.showToast({ title: "这台设备出不了声", icon: "none" });
    }
  },

});
