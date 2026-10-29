const navbar = require("../../utils/nav-bar");
const font = require("../../utils/font");

Component({
  properties: {
    title: { type: String, value: "" }
  },

  data: {
    height: 64,
    top: 20,
    row: 44,
    font: ""
  },

  attached() {
    const box = navbar.box();
    this.setData({
      height: box.height,
      top: box.top,
      row: box.row,
      font: font.stack()
    });
  },

  methods: {
    onBack() {
      navbar.back();
    }
  }
});
