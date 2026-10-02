const store = require("../../../utils/store");
const gate = require("../../../utils/gate");

/* 图标名按 key 取（.ic-left / .ic-center），画法在 app.wxss「分段控件」一节。
   与阅读页共用同一套 —— 同一件事在两个页面图标不一样，用户会以为是两件事。 */
const ALIGNS = [
  { key: "left", label: "左对齐", icon: "left" },
  { key: "center", label: "居中", icon: "center" }
];

// 字号档位仍是 -2 ~ 4（正文那边按 size-N 类名渲染），滑动条只是换了输入方式
const FONT_MIN = -2;
const FONT_MAX = 4;

Page({
  data: {
    aligns: ALIGNS,
    align: "center",
    fontSize: 0,
    fontMin: FONT_MIN,
    fontMax: FONT_MAX,
    pinyin: "rare",
    autoNext: false,
    locked: false
  },

  onShow() {
    if (!gate.logged()) {
      this.setData({ locked: true });
      return;
    }
    this.setData(Object.assign({ locked: false }, store.settings()));
  },

  onLogin() {
    wx.navigateTo({ url: "/pages/mine/mine?login=1" });
  },

  onAlign(e) {
    const align = e.detail.value;
    store.saveSettings({ align });
    this.setData({ align });
  },

  /**
   * 滑动条拖动过程中就会连发 changin —— 这里不做节流是有意的：
   * 存的只是一个整数，写本机存储比一次 setData 还便宜，节流反而会把
   * 「松手那一刻的值」搞丢。下面的样张跟着即时变，所见即所得。
   */
  onFontSlide(e) {
    const fontSize = Math.max(FONT_MIN, Math.min(FONT_MAX, Number(e.detail.value)));
    if (fontSize === this.data.fontSize) return;
    store.saveSettings({ fontSize });
    this.setData({ fontSize });
  },

  onAutoNext(e) {
    const autoNext = e.detail.value;
    store.saveSettings({ autoNext });
    this.setData({ autoNext });
  }
});
