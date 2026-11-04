const MIN = -3;
const MAX = 7;

const GAP_GAP = [7, 7, 7, 7, 8, 8, 9, 9, 10, 11, 12];

const GAP_MIN = -1;
const GAP_MAX = 3;
const GAP_DEFAULT = 0;

const GAP_STEPS = [0.08, 0.16, 0.24, 0.34];

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

function clampGap(step) {
  return Math.max(GAP_MIN, Math.min(GAP_MAX, Math.round(Number(step) || 0)));
}

function gapStep(step) {
  const n = clampGap(step) - GAP_DEFAULT;
  if (n === 0) return 1;
  if (n < 0) return 1 - GAP_STEPS[-n - 1];
  return 1 + GAP_STEPS[n - 1];
}

function gapFlags(step) {
  const n = clampGap(step);
  return { gapDown: n > GAP_MIN, gapUp: n < GAP_MAX };
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

module.exports = {
  alignKey, alignOf, MIN, MAX, clamp, at, flags, gap,
  GAP_MIN, GAP_MAX, GAP_DEFAULT, clampGap, gapStep, gapFlags
};
