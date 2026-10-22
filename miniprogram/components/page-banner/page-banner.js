const nav = require("../../utils/nav");

const RATIO = 916 / 1717;

const MAX_H = 360;

function width() {
  const read = (fn) => {
    try {
      return Number(fn().windowWidth) || 0;
    } catch (e) {
      return 0;
    }
  };
  return (wx.getWindowInfo && read(wx.getWindowInfo))
    || read(wx.getSystemInfoSync)
    || 375;
}

Component({
  properties: {
    src: { type: String, value: "" }
  },

  data: {
    barHeight: 0,
    imageHeight: 0
  },

  attached() {
    const box = nav.top();
    this.setData({
      barHeight: box.statusBarHeight + box.navHeight,
      imageHeight: Math.min(Math.round(width() * RATIO), MAX_H)
    });
  }
});
