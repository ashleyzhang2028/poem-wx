const STEP = 45;

const MAX = 20;

function paint(seq) {
  if (!seq || seq.cold) return seq;
  seq.cold = true;
  seq.page.setData({ enter: { on: true, delay: seq.delay } });
  return seq;
}

function open(page, count) {
  const n = Math.max(0, Math.min(Number(count) || 0, MAX));
  const delay = [];
  for (let i = 0; i < n; i += 1) delay.push(i * STEP);
  return paint({ page: page, on: true, delay: delay, cold: false });
}

function again(seq) {
  if (!seq) return seq;
  seq.cold = false;
  return paint(seq);
}

module.exports = { STEP, MAX, open, again, paint };
