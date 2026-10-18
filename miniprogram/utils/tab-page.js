const MINE = "/pages/mine/mine";
const GAME = "/packages/game/index/index";

function go(url) {
  wx.switchTab({ url: url });
}

function conference() {
  wx.navigateTo({ url: GAME });
}

function mine() {
  go(MINE);
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

module.exports = { go, conference, mine, back };
