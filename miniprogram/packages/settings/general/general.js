const store = require("../../../utils/store");

Page({
  data: {
    align: "center",
    fontSize: 0,
    pinyin: "rare",
    autoNext: false
  },

  onLoad() {
    this.setData(store.settings());
  },

  onAlign(e) {
    const align = e.currentTarget.dataset.a;
    store.saveSettings({ align });
    this.setData({ align });
  },

  onFont(e) {
    const fontSize = Math.max(-2, Math.min(4, this.data.fontSize + Number(e.currentTarget.dataset.d)));
    store.saveSettings({ fontSize });
    this.setData({ fontSize });
  },

  onAutoNext(e) {
    const autoNext = e.detail.value;
    store.saveSettings({ autoNext });
    this.setData({ autoNext });
  }
});
