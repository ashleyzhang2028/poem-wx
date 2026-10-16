const theme = require("../utils/theme");
const icons = require("../utils/icons");
const gate = require("../utils/gate");
const tabPage = require("../utils/tab-page");

const OFF_INK = "#9ca3af";

function svgInk(color) {
  const rgb = /rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(String(color));
  if (!rgb) return color;
  return "#" + [1, 2, 3].map((i) => ("0" + Number(rgb[i]).toString(16)).slice(-2)).join("");
}

function paint(src, ink) {
  return String(src).replace(/currentColor/g, encodeURIComponent(svgInk(ink)));
}

Component({
  data: {

    active: 0,

    themeStyle: "",
    ink: OFF_INK,
    onInk: "#ffffff",
    list: [
      { pagePath: "/pages/home/home", text: "今日", icon: icons.home },
      { pagePath: "/pages/library/library", text: "课外", icon: icons.library, login: true },
      { pagePath: "/packages/game/index/index", text: "大会", icon: icons.conference, login: true, noSwitch: true },
      { pagePath: "/pages/search/search", text: "搜索", icon: icons.search, login: true },
      { pagePath: "/pages/mine/mine", text: "我的", icon: icons.mine }
    ]
  },

  attached() {
    this.paint();
  },

  methods: {
    setActive(index) {
      const patch = {};
      if (this.data.active !== index) patch.active = index;
      this.setData(patch);
    },

    paint() {
      const t = theme.currentTheme();
      const ink = theme.get("ink").rgba;
      const items = this.data.list.map((it) => Object.assign({}, it, {
        off: paint(it.icon, t.rgba),
        on: paint(it.icon, ink === t.rgba ? t.on : ink)
      }));
      this.setData({
        themeStyle: theme.style(),
        ink: t.rgba,
        onInk: t.on,
        list: items
      });
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
