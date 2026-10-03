const theme = require("../../../utils/theme");
const gate = require("../../../utils/gate");

Page({
  data: {
    items: theme.all(),
    theme: theme.DEFAULT,
    themeStyle: "",
    currentName: "",
    locked: false
  },

  onShow() {
    // 副题那句「当前是什么色」每次进来都要重算 ——
    // 只写在 onPick 里的话，退出再进来还显示上一次的名字。
    this.setData({
      currentName: theme.currentTheme().name,
      locked: !gate.logged()
    });
    theme.apply(this);
  },

  onPick(e) {
    const key = e.currentTarget.dataset.key;
    if (key === this.data.theme) return;
    const picked = theme.set(key);
    // 就地改：这一页的 style 立刻换，下面的样例与九宫格跟着变。
    // 别的页面在各自的 onShow 里读一次 —— 小程序没有「全局变量变化通知」，
    // 用户从这一页返回时目标页会 onShow，那一拍就换上了。
    theme.apply(this);
    this.setData({ currentName: picked.name });
    wx.vibrateShort && wx.vibrateShort({ type: "light" });
  }
});
