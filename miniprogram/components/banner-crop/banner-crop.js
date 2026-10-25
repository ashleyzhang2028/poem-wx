const custom = require("../../utils/custom-banner");
const theme = require("../../utils/theme");

const ZOOM_STEP = 1.3;

const C = "crop";

const RATIO_W = custom.RATIO_W;

const RATIO_H = custom.RATIO_H;

const DESIGN_W = 750;

const PANEL_SIDE = 96;

const PANEL_MAX = 560;

const MIN_STAGE = 200;

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function sideOf(width) {
  return 32 * width / DESIGN_W;
}

function stageOf(win, img) {
  const width = Math.min(Number(win && win.width) || 0, Number(win && win.height) || 0) || 375;
  const panel = Math.min(width - PANEL_SIDE * width / DESIGN_W, PANEL_MAX);
  const stageW = Math.max(MIN_STAGE, Math.floor(panel - 2 * sideOf(width)));
  const stageH = Math.round(stageW * RATIO_H / RATIO_W);
  const base = Math.max(stageW / img.w, stageH / img.h);
  return { stageW: stageW, stageH: stageH, imgW: img.w * base, imgH: img.h * base, base: base };
}

function distanceOf(touches) {
  const a = touches[0], b = touches[1];
  return Math.sqrt(Math.pow(a.clientX - b.clientX, 2) + Math.pow(a.clientY - b.clientY, 2));
}

function centerOf(touches) {
  const a = touches[0], b = touches[1];
  return { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 };
}

function define() {
  Component({
    options: {
      addGlobalClass: true
    },

    data: {
      canvasId: C,
      themeStyle: "",
      name: "",
      open: false,
      src: "",
      ratioW: RATIO_W,
      ratioH: RATIO_H,
      stageW: 0,
      stageH: 0,
      busy: false,
      imgW: 0,
      imgH: 0,
      imgX: 0,
      imgY: 0
    },

    attached() {
      this.setData({ themeStyle: theme.style(), name: theme.name() });
    },

    methods: {
      open(pick) {
        this.pick = pick;
        this.photo = pick.img;
        this.offset = { x: 0, y: 0 };
        this.laying = null;
        this.pinch = null;
        this.pan = null;
        this.setData({ open: true, src: pick.path, busy: false }, () => this.fit());
      },

      fit() {
        const win = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
        const stage = stageOf({ width: win.windowWidth, height: win.windowHeight }, this.photo);
        this.base = stage.base;
        this.span = 1;
        this.maxSpan = Math.max(1, 1 / this.base);
        this.setData({ stageW: stage.stageW, stageH: stage.stageH }, () => this.lay());
      },

      onLock() {},

      lay() {
        const p = this.photo;
        const sw = this.data.stageW, sh = this.data.stageH;
        if (!p || !sw || !this.base) return;
        this.span = clamp(this.span, 1, this.maxSpan);
        const k = this.base * this.span;
        const w = p.w * k, h = p.h * k;
        const x = clamp((sw - w) / 2 + this.offset.x, sw - w, 0);
        const y = clamp((sh - h) / 2 + this.offset.y, sh - h, 0);
        this.offset = { x: x - (sw - w) / 2, y: y - (sh - h) / 2 };
        this.setData({ imgW: w, imgH: h, imgX: x, imgY: y });
      },

      zoom(factor) {
        if (!this.photo) return;
        this.span *= factor;
        this.laying = true;
        this.lay();
      },

      onZoomIn() {
        this.zoom(ZOOM_STEP);
      },

      onZoomOut() {
        this.zoom(1 / ZOOM_STEP);
      },

      onTouchStart(e) {
        const touches = e.touches || [];
        if (touches.length >= 2) {
          this.pinch = { dist: distanceOf(touches), center: centerOf(touches), span: this.span };
          this.pan = null;
          return;
        }
        if (!touches.length) return;
        this.pinch = null;
        this.pan = { x: touches[0].clientX, y: touches[0].clientY };
      },

      onTouchMove(e) {
        const touches = e.touches || [];
        if (touches.length >= 2 && this.pinch) {
          const center = centerOf(touches);
          this.offset.x += center.x - this.pinch.center.x;
          this.offset.y += center.y - this.pinch.center.y;
          this.pinch.center = center;
          if (this.pinch.dist > 0) this.span = this.pinch.span * distanceOf(touches) / this.pinch.dist;
          this.laying = true;
          this.lay();
          return;
        }
        if (!touches.length || !this.pan) return;
        const t = touches[0];
        this.offset.x += t.clientX - this.pan.x;
        this.offset.y += t.clientY - this.pan.y;
        this.pan = { x: t.clientX, y: t.clientY };
        this.laying = true;
        this.lay();
      },

      onTouchEnd(e) {
        const touches = e.touches || [];
        if (touches.length === 1) {
          this.pinch = null;
          this.pan = { x: touches[0].clientX, y: touches[0].clientY };
          return;
        }
        this.pinch = null;
        this.pan = null;
      },

      onCancel() {
        this.close();
      },

      onConfirm() {
        if (!this.photo || this.data.busy) return;
        this.laying = true;
        this.setData({ busy: true });
        const w = this.data.imgW, h = this.data.imgH;
        const box = {
          sx: -this.data.imgX / w,
          sy: -this.data.imgY / h,
          sw: this.data.stageW / w,
          sh: this.data.stageH / h
        };
        custom.put(this.pick.path, this.photo, this, C, box).then((r) => {
          this.setData({ busy: false });
          if (r.ok) this.close();
          this.triggerEvent("done", r);
        });
      },

      close() {
        this.setData({ open: false, src: "" });
      }
    }
  });
}

if (typeof Component === "function") define();

if (typeof module !== "undefined" && module.exports) {
  module.exports = { stageOf: stageOf, RATIO_W: RATIO_W, RATIO_H: RATIO_H };
}
