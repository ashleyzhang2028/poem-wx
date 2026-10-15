const theme = require("../utils/theme");
const gate = require("../utils/gate");
const tabPage = require("../utils/tab-page");

Component({
  data: {

    active: 0,

    themeStyle: "",
    list: [
      { pagePath: "/pages/home/home", text: "今日", icon: "book" },
      { pagePath: "/pages/library/library", text: "课外", icon: "stack", login: true },
      { pagePath: "/packages/game/index/index", text: "大会", icon: "flag", login: true, noSwitch: true },
      { pagePath: "/pages/search/search", text: "搜索", icon: "search", login: true },
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
      if (!gate.logged() && item.login) {
        tabPage.mine();
        return;
      }
      if (item.noSwitch) {
        wx.navigateTo({ url: item.pagePath });
        return;
      }
      tabPage.go(item.pagePath);
    }
  }
});
