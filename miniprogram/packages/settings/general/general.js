const store = require("../../../utils/store");
const pinyin = require("../../../utils/pinyin");
const entitlement = require("../../../utils/entitlement");
const gate = require("../../../utils/gate");
const theme = require("../../../utils/theme");
const sync = require("../../../utils/sync");

const ALIGNS = [
  { key: "left", label: "左对齐", icon: "left" },
  { key: "center", label: "居中", icon: "center" }
];

const FONT_MIN = -2;
const FONT_MAX = 4;

const PINYIN_MODES = [
  { key: "off", label: "不注音", icon: "off", desc: "正文不带拼音" },
  { key: "rare", label: "生字", icon: "rare", desc: "只给生僻字与多音字标音" },
  { key: "all", label: "全文", icon: "all", desc: "逐字标音" }
];

Page({
  data: {
    aligns: ALIGNS,
    align: "center",
    fontSize: 0,
    fontMin: FONT_MIN,
    fontMax: FONT_MAX,
    pinyinModes: PINYIN_MODES,
    pinyin: "rare",

    pinyinOn: false,
    pinyinNote: "",
    locked: false
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
    this.setData(
      Object.assign({ locked: false }, settings, {
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
    wx.navigateTo({ url: "/pages/mine/mine?login=1" });
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

});
