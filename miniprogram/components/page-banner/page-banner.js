const bannerPage = require("../../utils/page-banner");

const RATIO = 916 / 1717;

const MAX_H = 360;

let memo = null;

function windowWidth() {
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

function imageHeight() {
  if (memo === null) memo = Math.min(Math.round(windowWidth() * RATIO), MAX_H);
  return memo;
}

Component({
  properties: {
    src: { type: String, value: "" }
  },

  data: {
    full: false,
    pagePadding: 0,
    cover: 0,
    imageHeight: 0
  },

  attached() {
    const pages = typeof getCurrentPages === "function" ? getCurrentPages() : [];
    const page = pages[pages.length - 1];
    const full = !!page && pages.length === 1;
    this.setData({ full, pagePadding: bannerPage.pagePadding(), cover: full ? bannerPage.coverOf() : 0, imageHeight: imageHeight() });
  }
});
