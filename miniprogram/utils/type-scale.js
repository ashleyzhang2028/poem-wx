const MIN = -3;
const MAX = 7;

const GAP_GAP = [7, 7, 7, 7, 8, 8, 9, 9, 10, 11, 12];

function clamp(size) {
  return Math.max(MIN, Math.min(MAX, Number(size) || 0));
}

function at(size) {
  return clamp(size) - MIN;
}

function flags(size) {
  const size2 = clamp(size);
  return { fontDown: size2 > MIN, fontUp: size2 < MAX };
}

function gap(size) {
  return GAP_GAP[at(size)];
}

function alignKey(laid) {
  return laid && (laid.prose || laid.loose) ? "proseAlign" : "align";
}

function alignOf(laid, settings) {
  const s = settings || {};
  if (alignKey(laid) === "proseAlign") return s.proseAlign === "center" ? "center" : "left";
  return s.align === "left" ? "left" : "center";
}

module.exports = { alignKey, alignOf, MIN, MAX, clamp, at, flags, gap };
