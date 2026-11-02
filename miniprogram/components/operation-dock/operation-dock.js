const icons = require("../../utils/icons");

const DRAG_SLOP = 8;

const EDGE = 24;

function viewport() {
  try {
    if (typeof wx.getWindowInfo === "function") return wx.getWindowInfo();
  } catch (e) {}
  return wx.getSystemInfoSync();
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

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
    glyph: icons.actions,
    lift: 0,
    shift: 0
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
    onTouchStart(e) {
      const t = (e.touches || [])[0];
      if (!t) return;
      this.from = { x: t.clientX, y: t.clientY, lift: this.data.lift, shift: this.data.shift };
      this.moved = false;
    },

    onTouchMove(e) {
      const t = (e.touches || [])[0];
      if (!t || !this.from) return;
      const dx = t.clientX - this.from.x;
      const dy = t.clientY - this.from.y;
      if (!this.moved && Math.abs(dx) < DRAG_SLOP && Math.abs(dy) < DRAG_SLOP) return;
      this.moved = true;
      if (this.data.open) this.setData({ open: false });
      const win = viewport();
      const width = Number(win.windowWidth) || 375;
      const height = Number(win.windowHeight) || 667;
      const size = 46;
      this.setData({
        lift: clamp(this.from.lift - dy, EDGE, Math.max(EDGE, height - size - EDGE)),
        shift: clamp(this.from.shift - dx, EDGE, Math.max(EDGE, width - size - EDGE))
      });
    },

    onTouchEnd() {
      this.from = null;
      if (this.moved) this.moved = false;
    },

    onToggle() {
      if (this.moved) return;
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
