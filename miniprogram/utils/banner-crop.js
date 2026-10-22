const RATIO_W = 750;

const RATIO_H = 360;

const TOP = 0;

const BOTTOM = 1;

const TOLERANCE = 0.02;

const SCAN = 24;

const TINY = 600;

const MISSING = 8;

const BASE_SPAN = 0.04;

const SPANS = [];

(function build(span) {
  if (span > 1) return;
  SPANS.push(span);
  build(span * 2);
})(BASE_SPAN);

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function clampBox(box) {
  const sw = clamp(box.sw, 0.02, 1);
  const sh = clamp(box.sh, 0.02, 1);
  const sx = Math.max(0, Math.min(box.sx, 1 - sw));
  const sy = Math.min(clamp(box.sy, 0, 1), 1 - sh);
  return { sx: sx, sy: sy, sw: sw, sh: sh };
}

function diffAt(p, w, x, y, dir) {
  x = Math.round(x);
  const a = y * w + x;
  const b = (y + (dir === BOTTOM ? 1 : -1)) * w + x;
  return Math.abs(p[a] - p[b]) + Math.abs(p[a + 1] - p[b + 1]) + Math.abs(p[a + 2] - p[b + 2]);
}

function energy(p, w, len, dest, dir) {
  let sum = 0;
  const row = dir === BOTTOM ? 0 : len - 1;
  for (let i = 0; i < dest.length; i += 1) sum += diffAt(p, w, dest[i], row, dir);
  return sum;
}

function split(p, w, len, count, dir) {
  const gap = w / count;
  const limit = clamp(Math.round(gap * 0.6), 1, 40);
  const edge = dir === BOTTOM ? 1 : len - 2;
  const dest = [];
  for (let i = 0; i < count; i += 1) dest.push((i + 0.5) * gap);
  const settle = () => {
    for (let i = 0; i < count; i += 1) {
      const lo = Math.max(0, Math.round(dest[i]) - limit);
      const hi = Math.min(w - 1, Math.round(dest[i]) + limit);
      let at = Math.round(dest[i]);
      for (let x = lo; x <= hi; x += 1) {
        if (diffAt(p, w, x, edge, dir) > diffAt(p, w, at, edge, dir)) at = x;
      }
      dest[i] = at;
    }
  };
  const slope = () => {
    for (let i = 1; i < count; i += 1) {
      dest[i] = clamp(dest[i], dest[i - 1] + gap * 0.35, dest[i - 1] + gap * 2);
    }
    dest[0] = clamp(dest[0], gap * 0.35, gap * 2);
  };
  const cost = (side) => energy(p, w, len, dest, side);
  const room = w * count * MISSING;
  let from = TOP;
  let to = dir;
  let last = from;
  SPANS.slice().forEach((span) => {
    if (cost(from) < cost(to)) {
      const step = Math.round(gap * span);
      for (let i = 0; i < count; i += 1) dest[i] += from === BOTTOM ? -step : step;
      settle();
    }
    const now = cost(from);
    if (cost(to) + room >= now) to = from;
    if (from !== last && cost(last) + room >= now) to = last;
    last = from;
    from = from === TOP ? BOTTOM : TOP;
    slope();
  });
  return dest.map((x) => Math.round(clamp(x, 0, w - 1)));
}

function dedupe(list, gap) {
  const out = [];
  list.slice().sort((a, b) => a - b).forEach((x) => {
    if (!out.length || x - out[out.length - 1] >= gap) out.push(x);
  });
  return out;
}

function rowsOf(p, w, len) {
  const step = Math.max(2, Math.round(len * 0.02));
  const rows = [];
  for (let y = 0; y < len; y += step) {
    let e = 0;
    for (let x = 0; x < w; x += 1) {
      const a = y * w + x;
      const b = Math.max(0, y - step) * w + x;
      e += Math.abs(p[a] - p[b]) + Math.abs(p[a + 1] - p[b + 1]) + Math.abs(p[a + 2] - p[b + 2]);
    }
    rows.push({ y: y, e: e });
  }
  return rows;
}

function busy(rows) {
  if (!rows.length) return [];
  const max = rows.reduce((n, r) => Math.max(n, r.e), 0);
  if (!max) return [];
  const bar = Math.max(TINY, max * 0.15);
  return rows.filter((r) => r.e > bar);
}

function lines(rows, len) {
  const hits = busy(rows);
  const edge = len * 0.14;
  const tall = hits.length > 0 && hits.length < rows.length / 2;
  return {
    gutter: tall && (hits[0].y > edge || hits[hits.length - 1].y < len - edge),
    top: !!tall && hits[0].y < edge,
    bottom: !!tall && hits[hits.length - 1].y > len - edge
  };
}

function rotated(p, w, len) {
  const out = [];
  for (let x = w - 1; x >= 0; x -= 1) {
    for (let y = 0; y < len; y += 1) {
      const at = (y * w + x) * 4;
      out.push(p[at], p[at + 1], p[at + 2]);
    }
  }
  return out;
}

function seal(p, w, len, turned) {
  const para = lines(rowsOf(p, w, len), len);
  const side = lines(rowsOf(turned, len, w), w);
  if (!para.gutter) {
    return { axis: "y", dest: dedupe(split(turned, len, w, SCAN, side.top ? TOP : BOTTOM), 1) };
  }
  return {
    axis: "x",
    dest: dedupe(split(p, w, len, SCAN * 2, para.top ? TOP : BOTTOM), 1),
    seal: side.top && side.bottom
  };
}

function cut(p, w, len) {
  return seal(p, w, len, rotated(p, w, len));
}

function clip(list, lo, hi) {
  const keep = list.filter((x) => x >= lo && x <= hi);
  return keep.length ? keep : [clamp(lo, 0, hi)];
}

function snap(box, p, w, h) {
  const out = clampBox(box);
  if (!p || !w || !h) return out;
  const { axis, dest } = cut(p, w, h);
  const span = axis === "x" ? w : h;
  const lo = Math.round((axis === "x" ? out.sx : out.sy) * span);
  const hi = Math.round((axis === "x" ? out.sx + out.sw : out.sy + out.sh) * span);
  const marks = clip(dest, lo, hi);
  if (marks.length < 2) return out;
  const gap = span * TOLERANCE;
  const start = marks[0] / span;
  const size = (marks[marks.length - 1] - marks[0] + gap) / span;
  if (axis === "x") return clampBox({ sx: start, sw: size, sy: out.sy, sh: out.sh });
  return clampBox({ sx: out.sx, sw: out.sw, sy: start, sh: size });
}

module.exports = { RATIO_W, RATIO_H, clampBox, cut, seal, snap };
