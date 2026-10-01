const store = require("../../../utils/store");
const speech = require("../../../utils/speech");
const pinyin = require("../../../utils/pinyin");
const entitlement = require("../../../utils/entitlement");
const gate = require("../../../utils/gate");

const MODES = [
  { key: "off", label: "不注音", desc: "正文不带拼音" },
  { key: "rare", label: "生字", desc: "只给生僻字与多音字标音" },
  { key: "all", label: "全文", desc: "逐字标音" }
];

const RATES = [
  { key: 0.8, label: "慢" },
  { key: 1, label: "正常" },
  { key: 1.2, label: "快" }
];

Page({
  data: {
    modes: MODES,
    pinyin: "rare",
    pinyinOn: false,
    pinyinNote: "",
    rates: RATES,
    speechRate: 1,
    speechAutoNext: true,
    speakVisible: false,
    speakReady: false,
    speakState: "denied",
    speakReason: "",
    locked: false
  },

  onShow() {
    if (!gate.logged()) {
      this.setData({ locked: true });
      return;
    }
    this.setData({ locked: false });
    const settings = store.settings();
    // 与阅读页同一口径：readiness 说「读音表在不在」，门禁说「这一档能不能用」。
    // 少判后面那个，free 档点一下照样能注音。
    const pr = pinyin.readiness();
    const prOn = pr.usable && entitlement.can("pinyin");
    const sr = speech.readiness();

    this.setData({
      pinyin: prOn ? settings.pinyin : "off",
      pinyinOn: prOn,
      pinyinNote: prOn
        ? ""
        : pr.usable
          ? "注音要登录并且档位够才开。"
          : "读音表（data/pinyin-table.json）还没生成。跑一次 build-data.js 就会带上，"
            + "生成前这一栏整个不显示 —— 免得留个点了没反应的开关。",
      speechRate: settings.speechRate,
      speechAutoNext: settings.speechAutoNext,
      speakVisible: sr.visible,
      speakReady: sr.usable,
      speakState: sr.state,
      speakReason: sr.reason
    });
  },

  onLogin() {
    wx.navigateTo({ url: "/pages/mine/mine?login=1" });
  },

  onMode(e) {
    const mode = e.detail.value;
    if (!pinyin.setMode(mode)) return;
    this.setData({ pinyin: mode });
  },

  onRate(e) {
    const speechRate = Number(e.detail.value);
    store.saveSettings({ speechRate });
    speech.savePrefs({ rate: speechRate });
    this.setData({ speechRate });
  },

  onAutoNext(e) {
    const speechAutoNext = e.detail.value;
    store.saveSettings({ speechAutoNext });
    this.setData({ speechAutoNext });
  },

  onSpeakTest() {
    const sr = speech.readiness();
    // 就绪判定在上游做过一遍（不就绪时这个按钮根本不渲染）。
    // 这里只兜住「刚好在这一刻掉线」：给一句人话，不是静默失败。
    if (!sr.usable) {
      wx.showToast({ title: sr.reason || "朗读通道没就绪", icon: "none", duration: 2500 });
      return;
    }

    wx.showLoading({ title: "合成中" });
    const player = speech.create({
      onFinish: () => wx.hideLoading(),
      onError: (err) => {
        wx.hideLoading();
        wx.showToast({ title: err.message || "合成失败", icon: "none" });
      }
    });
    player.load([{ text: "床前明月光，疑是地上霜。" }]);
    player.start();
    setTimeout(() => wx.hideLoading(), 120);
  }
});
