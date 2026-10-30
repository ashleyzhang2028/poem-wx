const MIN = -2;
const MAX = 6;

function clamp(size) {
  return Math.max(MIN, Math.min(MAX, Number(size) || 0));
}

function flags(size) {
  const size2 = clamp(size);
  return { fontDown: size2 > MIN, fontUp: size2 < MAX };
}

const GAP_MIN = -6;
const GAP_MAX = 3;
const GAP_DEFAULT = -1;

function clampGap(gap) {
  return Math.max(GAP_MIN, Math.min(GAP_MAX, Number(gap) || 0));
}

function gapFlags(gap) {
  const gap2 = clampGap(gap);
  return { lineDown: gap2 > GAP_MIN, lineUp: gap2 < GAP_MAX };
}

module.exports = { MIN, MAX, clamp, flags, GAP_DEFAULT, clampGap, gapFlags };
