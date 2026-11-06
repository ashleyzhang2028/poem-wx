const scale = require("./type-scale");

const RPX_PER_PX = 2;

const LINE_BASE_RPX = 14;

const STANZA_GAP_RPX = 24;

function paraOf(raw) {
  const n = Math.round(Number(raw && raw.p) || 0);
  return n > 0 ? n : 0;
}

function offsetOf(raw) {
  const n = Number(raw && raw.y) || 0;
  return n > 0 ? Math.round(n) : 0;
}

function lineRpx(fontSize) {
  return (scale.clamp(fontSize) - scale.MIN) + scale.gap(fontSize) + LINE_BASE_RPX;
}

function pitch(fontSize) {
  return lineRpx(fontSize) / RPX_PER_PX;
}

function rowsOf(paras, index) {
  const rows = paras && paras[index];
  return Array.isArray(rows) && rows.length ? rows.length : 1;
}

function spanRpx(paras, index, line) {
  return line * rowsOf(paras, index) + (index > 0 ? STANZA_GAP_RPX : 0);
}

function startRpx(paras, index, line) {
  let top = 0;
  for (let i = 0; i < index; i++) top += spanRpx(paras, i, line);
  return top;
}

function locate(top, fontSize, paras) {
  const line = lineRpx(fontSize);
  const reach = (paras || []).length;
  const at = Math.max(0, Math.round(top * RPX_PER_PX));
  let p = 1;
  let from = 0;
  let next = spanRpx(paras, 0, line);
  while (p < reach && at >= next) {
    from = next;
    next += spanRpx(paras, p, line);
    p += 1;
  }
  return { p: p, y: Math.floor((at - from) / RPX_PER_PX) };
}

function topOf(para, offset, fontSize, paras) {
  const line = lineRpx(fontSize);
  const at = Math.max(0, Math.min(Math.round(para), (paras || []).length));
  return Math.round((startRpx(paras, at, line) + Math.max(0, offset) * RPX_PER_PX) / RPX_PER_PX);
}

module.exports = { paraOf, offsetOf, pitch, locate, topOf };
