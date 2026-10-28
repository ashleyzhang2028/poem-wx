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
      if (!font.globalOn()) {
        this.setData({ font: font.STACK });
        return;
      }
      font.registerHere().then((family) => {
        this.setData({ font: family && font.globalOn() ? font.groupOf(family) : font.STACK });
      }).catch(() => {});
    },

    onBack() {
      navbar.back();
    }
  }
});
