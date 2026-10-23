const navbar = require("./nav-bar");

const COVER = 0.2;

const SP_3 = 24;

function coverOf() {
  return Number((navbar.box().row * COVER).toFixed(2));
}

function pagePadding() {
  const read = (fn) => {
    try {
      return Number(fn().windowWidth) || 0;
    } catch (e) {
      return 0;
    }
  };
  const width = (wx.getWindowInfo && read(wx.getWindowInfo))
    || read(wx.getSystemInfoSync)
    || 375;
  return Number((SP_3 * width / 750).toFixed(2));
}

module.exports = { coverOf, pagePadding };
