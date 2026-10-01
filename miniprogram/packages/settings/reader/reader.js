const store = require("../../../utils/store");
const E = require("../../../utils/entitlement");

const MODES = [
  { key: "off", label: "不注音" },
  { key: "rare", label: "生字" },
  { key: "all", label: "全文" }
];

Page({
  data: { modes: MODES, pinyin: "rare", logged: false },

  onShow() {
    this.setData({ pinyin: store.settings().pinyin, logged: E.signedIn() });
  },

  onLoginGate() {
    wx.switchTab({ url: "/pages/mine/mine" });
  },

  onMode(e) {
    if (!E.block("pinyin.helper", { page: this })) return;
    const pinyin = e.currentTarget.dataset.k;
    store.saveSettings({ pinyin });
    this.setData({ pinyin });
  },

  onSpeakTest() {
    if (!E.block("read.aloud", { page: this })) return;
    wx.showToast({ title: "朗读需要接入 TTS 服务", icon: "none" });
  }
});
