const store = require("../../../utils/store");
const pinyin = require("../../../utils/pinyin");
const entitlement = require("../../../utils/entitlement");
const gate = require("../../../utils/gate");
const theme = require("../../../utils/theme");
const sync = require("../../../utils/sync");

/* 图标名按 key 取（.ic-left / .ic-center），画法在 app.wxss「分段控件」一节。
   与阅读页共用同一套 —— 同一件事在两个页面图标不一样，用户会以为是两件事。 */
const ALIGNS = [
  { key: "left", label: "左对齐", icon: "left" },
  { key: "center", label: "居中", icon: "center" }
];

// 字号档位仍是 -2 ~ 4（正文那边按 size-N 类名渲染），滑动条只是换了输入方式
const FONT_MIN = -2;
const FONT_MAX = 4;

/* 注音三档：与「阅读设置」那一页同一份（key / 图标 / 文案一个不差）。
   图标名按 key 取（.ic-off / .ic-rare），画法在 app.wxss「分段控件」一节。

   ## 为什么这一页也有注音

   用户 2026-10-04：「通用设置版式里有对齐和字号，怎么没有注音的设置？」
   版式三件事（对齐 · 注音 · 字号）在正文里本来就共用一行，设置里却把
   注音单独关进另一页 —— 同一组偏好分两页，改一处要跑两趟。
   读的还是同一个 settings.pinyin，两处任何一个改了另一处立刻同步。 */
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
    /** 读音表在不在、这一档能不能注音 —— 与阅读设置同一口径 */
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
    // 与阅读设置同一口径：readiness 说「读音表在不在」，门禁说「这一档能不能用」。
    // 少判后面那个，free 档点一下照样能注音。
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
    sync.markDirty();
  },

  /* 注音：走 utils/pinyin.setMode()，不由页面自己写 store ——
     「这一档能不能用、读音表在不在」都收在那儿，阅读设置也是这么调的。
     两页各写一份自己的判断，早晚会分叉。 */
  onPinyin(e) {
    const mode = e.detail.value;
    if (!pinyin.setMode(mode)) return;
    this.setData({ pinyin: mode });
  },

  /* 「背完自动下一首」那枚开关 2026-10-04 删掉了（用户裁决）。
     它不是「先留着、以后再接上」—— 它写的那个键全项目没有第二个地方读，
     翻页照走 recite-sheet 里那 700ms。一枚按了不动的开关，
     比没有这个开关更糟：它承诺了一件不做的事。 */
});
