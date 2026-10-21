const theme = require("../utils/theme");
const store = require("../utils/store");
const icons = require("../utils/icons");
const gate = require("../utils/gate");
const loginFlow = require("../utils/login-flow");
const tabPage = require("../utils/tab-page");

Component({
  properties: {
    current: { type: String, value: "" }
  },

  data: {
    active: -1,
    themeStyle: "",
    meAvatar: "",
    meChar: "诗",
    conference: 2,
    list: [
      { pagePath: "/pages/home/home", text: "今日", icon: icons.home },
      { pagePath: "/pages/library/library", text: "课外", icon: icons.library, login: true },
      { pagePath: "/packages/game/index/index", text: "大会", icon: icons.conference, login: true },
      { pagePath: "/pages/search/search", text: "搜索", icon: icons.search, login: true },
      { pagePath: "/pages/mine/mine", text: "我的", icon: icons.mine, me: true }
    ]
  },

  attached() {
    this.painted = theme.current();
    const patch = Object.assign(this.paint(), this.paintMe());
    const fixed = parseInt(this.data.current, 10);
    if (fixed >= 0) patch.active = fixed;
    this.setData(patch);
    this.onLoginSettled = () => this.setData(this.paintMe());
    loginFlow.watch(this.onLoginSettled);
  },

  detached() {
    loginFlow.unwatch(this.onLoginSettled);
  },

  methods: {
    setActive(index) {
      const patch = {};
      if (this.data.active !== index) patch.active = index;
      Object.assign(patch, this.paintMe());

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

    paintMe() {
      return { meAvatar: store.avatarSrc(), meChar: store.avatarChar() };
    },

    onTap(e) {
      const i = Number(e.currentTarget.dataset.index);
      const item = this.data.list[i];
      if (!item) return;
      if (!gate.logged() && item.login) {
        tabPage.mine();
        return;
      }
      if (i === this.data.conference) {
        if (i === this.data.active) tabPage.hub();
        else tabPage.conference();
        return;
      }
      if (i === this.data.active) return;
      tabPage.go(item.pagePath);
    }
  }
});
