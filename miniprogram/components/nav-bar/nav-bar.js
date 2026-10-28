const navbar = require("../../utils/nav-bar");
const font = require("../../utils/font");

Component({
  properties: {
    title: { type: String, value: "" },
    scope: { type: Number, value: -1 }
  },

  data: {
    height: 64,
    top: 20,
    row: 44,
    font: font.STACK
  },

  attached() {
    const box = navbar.box();
    this.setData({ height: box.height, top: box.top, row: box.row });
    this.paint();
  },

  observers: {
    scope() {
      this.paint();
    }
  },

  methods: {
    paint() {
      const app = typeof getApp === "function" ? getApp() : null;
      const g = (app && app.globalData) || {};
      if (!font.globalOn() || g.fontScope !== this.data.scope) {
        this.setData({ font: font.STACK });
        return;
      }
      font.registerHere().then((family) => {
        if (family && font.globalOn()) this.setData({ font: font.groupOf(family) });
      }).catch(() => {});
    },

    onBack() {
      navbar.back();
    }
  }
});
