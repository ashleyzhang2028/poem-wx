Component({
  properties: {
    title: { type: String, value: "登录后可用" },
    note: { type: String, value: "" },

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
