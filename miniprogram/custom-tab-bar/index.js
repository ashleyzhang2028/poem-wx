const theme = require("../utils/theme");
const icons = require("../utils/icons");
const gate = require("../utils/gate");
const tabPage = require("../utils/tab-page");

Component({
  data: {
    active: 0,
    themeStyle: "",
    list: [
      { pagePath: "/pages/home/home", text: "今日", icon: icons.home },
      { pagePath: "/pages/library/library", text: "课外", icon: icons.library, login: true },
      { pagePath: "/packages/game/index/index", text: "大会", icon: icons.conference, login: true, noSwitch: true },
      { pagePath: "/pages/search/search", text: "搜索", icon: icons.search, login: true },
      { pagePath: "/pages/mine/mine", text: "我的", icon: icons.mine }
    ]
  },

  attached() {
    this.painted = theme.current();
    this.setData(this.paint());
  },

  methods: {
    setActive(index) {
      const patch = {};
      if (this.data.active !== index) patch.active = index;

      const key = theme.current();
      if (this.painted !== key) {
        this.painted = key;
        Object.assign(patch, this.paint());
      }
      if (Object.keys(patch).length) this.setData(patch);
    },

    paint() {
      return { themeStyle: theme.style() };
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
