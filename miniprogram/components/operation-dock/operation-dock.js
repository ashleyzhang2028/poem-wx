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
  { key: "mark", label: "书签", icon: icons.bookmark }
];

Component({
  options: { multipleSlots: false },

  properties: {
    swatches: { type: Array, value: [] },
    bg: { type: String, value: "" },
    align: { type: String, value: "center" },
    fontDown: { type: Boolean, value: false },
    fontUp: { type: Boolean, value: true },
    pinyinOn: { type: Boolean, value: false },
    pinyinMode: { type: String, value: "off" },
    dailyOn: { type: Boolean, value: false },
    dailyIcon: { type: String, value: icons.add },
    markOn: { type: Boolean, value: false }
  },

  data: {
    open: false,
    rows: ROWS,
    glyph: icons.actions,
    dragging: false,
    alignGlyph: icons.center,
    pinyinGlyph: icons.off,
    zoomOut: icons.zoomOut,
    zoomIn: icons.zoomIn,
    lift: 0,
    shift: 0
  },

  observers: {
    "align, pinyinMode": function (align, pinyinMode) {
      this.setData({
        alignGlyph: align === "center" ? icons.center : icons.left,
        pinyinGlyph: pinyinMode === "all" ? icons.all : icons.off
      });
    },

    "dailyOn, dailyIcon, markOn": function (dailyOn, dailyIcon, markOn) {
      const on = { daily: dailyOn, mark: markOn };
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
      this.setData({ dragging: true, open: false });
      const win = viewport();
      const width = Number(win.windowWidth) || 375;
      const height = Number(win.windowHeight) || 667;
      const unit = width / 750;
      const size = 92 * unit;
      const baseRight = 32 * unit;
      const baseBottom = 112 * unit + Math.max(0, height - ((win.safeArea || {}).bottom || height)) + 32 * unit;
      const stack = 3 * (size + 16 * unit);
      this.setData({
        lift: clamp(this.from.lift - dy, EDGE - baseBottom,Math.max(0, height - baseBottom - size - stack - EDGE)),
        shift: clamp(this.from.shift - dx, EDGE - baseRight, Math.max(0, width - baseRight - size - EDGE))
      });
    },

    onTouchEnd() {
      this.from = null;
      if (this.data.dragging) this.setData({ dragging: false });
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

    onSwatch(e) {
      if (!this.data.open) return;
      this.triggerEvent("bg", { id: e.currentTarget.dataset.id });
    },

    onTool(e) {
      if (!this.data.open) return;
      this.triggerEvent("act", { key: e.currentTarget.dataset.key });
    },

    onPick(e) {
      if (!this.data.open) return;
      const key = e.currentTarget.dataset.key;
      this.setData({ open: false });
      this.triggerEvent("act", { key: key });
    }
  }
});
