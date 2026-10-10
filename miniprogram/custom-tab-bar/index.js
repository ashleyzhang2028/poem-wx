const theme = require("../utils/theme");

Component({
  data: {

    active: 0,

    themeStyle: "",
    list: [
      { pagePath: "/pages/home/home", text: "背诵", icon: "book" },
      { pagePath: "/pages/library/library", text: "课外", icon: "stack" },
      { pagePath: "/pages/search/search", text: "搜索", icon: "search" },
      { pagePath: "/pages/mine/mine", text: "我的", icon: "person" }
    ]
  },

  attached() {
    this.setData({ themeStyle: theme.style() });
  },

  methods: {
    setActive(index) {

      const themeStyle = theme.style();
      const patch = { themeStyle };
      if (this.data.active !== index) patch.active = index;
      this.setData(patch);
    },

    onTap(e) {
      const i = Number(e.currentTarget.dataset.index);
      const item = this.data.list[i];
      if (!item) return;
      if (i === this.data.active) return;
      wx.switchTab({ url: item.pagePath });
    }
  }
});
