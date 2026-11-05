const SPACE = 100;
const RANGE = 32;

Component({
  properties: {
    points: { type: String, value: "" },
    color: { type: String, value: "#1c1c1e" }
  },

  lifetimes: {
    ready() {
      this.draw();
    }
  },

  observers: {
    "points, color"() {
      this.draw();
    }
  },

  methods: {
    draw() {
      this.createSelectorQuery()
        .select(".spark-cv")
        .fields({ node: true, size: true })
        .exec((res) => {
          const box = res && res[0];
          if (!box || !box.node || !box.width || !box.height) return;
          const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
          const dpr = info.pixelRatio || 2;
          const cv = box.node;
          const ctx = cv.getContext("2d");
          cv.width = box.width * dpr;
          cv.height = box.height * dpr;
          ctx.scale(dpr, dpr);
          ctx.clearRect(0, 0, box.width, box.height);
          this.stroke(ctx, box.width, box.height);
        });
    },

    stroke(ctx, w, h) {
      const pts = String(this.data.points || "")
        .split(" ")
        .map((pair) => pair.split(",").map(Number))
        .filter((p) => p.length === 2 && !isNaN(p[0]) && !isNaN(p[1]));
      if (pts.length < 2) return;
      const at = pts.map((p) => [
        (p[0] * w) / SPACE,
        Math.max(1, Math.min(h - 1, (p[1] * h) / RANGE))
      ]);
      ctx.beginPath();
      ctx.moveTo(at[0][0], at[0][1]);
      for (let i = 3; i < at.length; i += 3) {
        ctx.bezierCurveTo(at[i - 2][0], at[i - 2][1], at[i - 1][0], at[i - 1][1], at[i][0], at[i][1]);
      }
      ctx.lineWidth = 1.5;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.strokeStyle = this.data.color;
      ctx.stroke();
    }
  }
});
