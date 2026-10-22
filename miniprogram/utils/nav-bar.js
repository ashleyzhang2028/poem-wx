const nav = require("./nav");
const tabPage = require("./tab-page");

function box() {
  const t = nav.top();
  return {
    height: t.statusBarHeight + t.navHeight,
    top: t.navTop,
    row: t.navBottom - t.navTop
  };
}

function back() {
  const pages = getCurrentPages();
  if (pages.length > 1) wx.navigateBack();
  else tabPage.mine();
}

module.exports = { box, back };
