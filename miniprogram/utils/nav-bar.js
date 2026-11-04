const nav = require("./nav");
const tabPage = require("./tab-page");
const pageStack = require("./page-stack");

function box() {
  const t = nav.top();
  return {
    height: t.statusBarHeight + t.navHeight,
    top: t.navTop,
    row: t.navBottom - t.navTop
  };
}

function back() {
  const pages = pageStack.list();
  if (pages.length > 1) wx.navigateBack();
  else tabPage.mine();
}

module.exports = { box, back };
