const MINE = "/pages/mine/mine";

function go(url) {
  wx.switchTab({ url: url });
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

module.exports = { go, mine, back };
