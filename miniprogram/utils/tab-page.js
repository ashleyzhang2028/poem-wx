const MINE = "/pages/mine/mine";

function go(url) {
  wx.switchTab({ url: url });
}

function mine() {
  go(MINE);
}

module.exports = { go, mine };
