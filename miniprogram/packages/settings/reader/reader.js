const store = require("../../../utils/store");
const pinyin = require("../../../utils/pinyin");
const speech = require("../../../utils/speech");

const MODES = [
  { key: "off", label: "不注音" },
  { key: "rare", label: "生字" },
  { key: "all", label: "全文" }
];

const PROVIDERS = [
  { id: "si", name: "微信同声传译", note: "免费。要在公众平台申请插件权限，个人主体走不通" },
  { id: "remote", name: "自建 TTS", note: "收费。腾讯云 / 讯飞 / 火山，自家后端签名" }
];

Page({
  data: {
    modes: MODES,
    pinyin: "rare",
    providers: PROVIDERS,
    provider: "si",
    providerName: "",
    ttsReady: false,
    ttsReason: "",
    rate: 90,
    baseUrl: "",
    pinyinReady: false,
    sampleChars: []
  },

  onLoad() {
    const s = store.settings();
    const cfg = speech.config();
    const g = speech.gate();

    this.setData({
      pinyin: s.pinyin,
      provider: cfg.provider,
      baseUrl: cfg.baseUrl,
      rate: Math.round((cfg.rate || 0.9) * 100),
      providerName: speech.providerName(),
      ttsReady: g.ok && speech.available(),
      ttsReason: g.ok ? (speech.available() ? "" : "这个 provider 还没接通") : g.reason,
      pinyinReady: pinyin.available(),
      sampleChars: pinyin.rareChars("床前明月光，疑是地上霜。举头望明月，低头思故乡。").slice(0, 8)
    });
  },

  onMode(e) {
    const pinyinMode = e.currentTarget.dataset.k;
    store.saveSettings({ pinyin: pinyinMode });
    this.setData({ pinyin: pinyinMode });
  },

  onProvider(e) {
    const provider = e.currentTarget.dataset.p;
    speech.setConfig({ provider });
    this.setData({
      provider,
      providerName: speech.providerName(),
      ttsReady: speech.available() && speech.gate().ok,
      ttsReason: speech.available() ? "" : "这个 provider 还没接通"
    });
  },

  onBaseUrl(e) {
    this.setData({ baseUrl: e.detail.value });
  },

  onBaseUrlBlur(e) {
    const baseUrl = (e.detail.value || "").trim();
    speech.setConfig({ baseUrl });
    this.setData({
      baseUrl,
      ttsReady: speech.available() && speech.gate().ok,
      ttsReason: speech.available() ? "" : "这个 provider 还没接通"
    });
  },

  onRate(e) {
    const rate = Number(e.detail.value) || 90;
    speech.setConfig({ rate: rate / 100 });
    this.setData({ rate });
  },

  /**
   * 试听。不可用时把原因说清楚 —— 「点了没反应」是最差的一种失败。
   */
  onSpeakTest() {
    const g = speech.gate();
    if (!g.ok) {
      wx.showToast({ title: g.reason, icon: "none", duration: 2500 });
      return;
    }
    if (!speech.available()) {
      wx.showModal({
        title: "朗读还没接通",
        content:
          this.data.provider === "si"
            ? "要先去微信公众平台申请「微信同声传译」插件权限（需企业/个体户主体），然后在 app.json 里声明 plugins。申请通过后这里立刻能用，不用改代码。"
            : "填一个自建 TTS 的地址，后端返回 { url } 就能播。",
        showCancel: false,
        confirmText: "知道了"
      });
      return;
    }
    speech.sample();
  },

  onStop() {
    speech.stop();
    wx.showToast({ title: "已停止", icon: "none" });
  }
});
