const icons = require("../../utils/icons");

const ROWS = [
  { key: "daily", label: "新增温习", icon: icons.add },
  { key: "pick", label: "加入自选", icon: icons.playlist },
  { key: "mark", label: "书签", icon: icons.bookmark }
];

Component({
  options: { multipleSlots: false },

  properties: {
    below: { type: Boolean, value: true },
    dailyOn: { type: Boolean, value: false },
    dailyIcon: { type: String, value: icons.add },
    pickOn: { type: Boolean, value: false },
    markOn: { type: Boolean, value: false }
  },

  data: {
    open: false,
    rows: ROWS,
    glyph: icons.actions
  },

  observers: {
    "dailyOn, dailyIcon, pickOn, markOn": function (dailyOn, dailyIcon, pickOn, markOn) {
      const on = { daily: dailyOn, pick: pickOn, mark: markOn };
      const shape = { daily: dailyIcon };
      this.setData({
        rows: ROWS.map((r) => Object.assign({}, r, {
          on: !!on[r.key],
          icon: shape[r.key] || r.icon
        }))
      });
    }
  },

  methods: {
    onToggle() {
      this.setData({ open: !this.data.open });
    },

    onClose() {
      if (!this.data.open) return;
      this.setData({ open: false });
    },

    onPick(e) {
      if (!this.data.open) return;
      const key = e.currentTarget.dataset.key;
      this.setData({ open: false });
      this.triggerEvent("act", { key: key });
    }
  }
});
