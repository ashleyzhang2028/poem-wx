/**
 * 未登录时那张卡。
 *
 * 13 个页面都有这道门，措辞却各写各的 —— 用户看到的是「每页一个说法」。
 * 收成一个组件，顺带把「点不动」在视觉上也说清楚：一枚印章式圆标 + 一句人话 + 一个登录键。
 *
 * 只管长相与交互，不管判定 —— 「谁被拦」仍由各页调 gate 决定。
 */
Component({
  properties: {
    title: { type: String, value: "登录后可用" },
    note: { type: String, value: "" },
    /** 印章里的那个字，缺省取标题首字 */
    mark: { type: String, value: "" }
  },

  data: { markText: "" },

  attached() {
    this.setData({ markText: this.data.mark || this.data.title.charAt(0) });
  },

  methods: {
    onLogin() {
      wx.navigateTo({ url: "/pages/mine/mine?login=1" });
    }
  }
});
