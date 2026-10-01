const store = require("../../../utils/store");

const MODES = [
  { key: "off", label: "不注音" },
  { key: "rare", label: "生字" },
  { key: "all", label: "全文" }
];

Page({
  data: { modes: MODES, pinyin: "rare" },

  onLoad() {
    this.setData({ pinyin: store.settings().pinyin });
  },

  onMode(e) {
    const pinyin = e.currentTarget.dataset.k;
    store.saveSettings({ pinyin });
    this.setData({ pinyin });
  },

  onSpeakTest() {
    wx.showToast({ title: "朗读需要接入 TTS 服务", icon: "none" });
  }
});
