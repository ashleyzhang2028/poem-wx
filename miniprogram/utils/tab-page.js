const MINE = "/pages/mine/mine";
const GAME = "/packages/game/index/index";

function go(url) {
  wx.switchTab({ url: url });
}

function landed() {
  const pages = getCurrentPages();
  const page = pages[pages.length - 1];
  return !!page && page.route === MINE.slice(1);
}

function conference() {
  wx.navigateTo({ url: GAME });
}

function hub() {
  const pages = getCurrentPages();
  const at = pages.map((p) => p.route).lastIndexOf(GAME.slice(1));
  if (at < 0) {
    conference();
    return;
  }
  if (at < pages.length - 1) wx.navigateBack({ delta: pages.length - 1 - at });
}

function mine() {
  if (!landed()) {
    go(MINE);
    return;
  }
  const pages = getCurrentPages();
  if (pages.length > 1) wx.navigateBack({ delta: 1 });
}

function back(url) {
  if (!url) {
    mine();
    return;
  }
  wx.switchTab({
    url: url,
    fail: () => {
      wx.navigateBack({
        delta: 1,
        fail: () => mine()
      });
    }
  });
}

module.exports = { go, conference, hub, mine, back };
