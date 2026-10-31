const MIN = -3;
const MAX = 7;

const GAP_GAP = [14, 14, 15, 15, 16, 16, 17, 19, 20, 22, 25];

const GAP_GAP_PINYIN = [37, 39, 41, 44, 46, 48, 51, 56, 60, 65, 71];

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

function gap(size, pinyin) {
  const rows = pinyin ? GAP_GAP_PINYIN : GAP_GAP;
  return rows[at(size)];
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
