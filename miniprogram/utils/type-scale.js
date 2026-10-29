const MIN = -2;
const MAX = 6;

function clamp(size) {
  return Math.max(MIN, Math.min(MAX, Number(size) || 0));
}

function flags(size) {
  const size2 = clamp(size);
  return { fontDown: size2 > MIN, fontUp: size2 < MAX };
}

module.exports = { MIN, MAX, clamp, flags };
