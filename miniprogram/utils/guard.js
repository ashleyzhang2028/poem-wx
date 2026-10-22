const GAP = 800;

const lastAt = {};

const jobs = {};

function now() {
  return Date.now();
}

function busy(key) {
  return !!jobs[key];
}

function enter(key) {
  if (!key || jobs[key]) return false;
  jobs[key] = true;
  return true;
}

function leave(key) {
  if (key) jobs[key] = false;
}

function once(key, job, fail) {
  if (!enter(key)) return Promise.resolve({ skipped: true });
  return Promise.resolve()
    .then(job)
    .then(
      (res) => {
        leave(key);
        return res;
      },
      (err) => {
        leave(key);
        if (fail) fail(err);
        return { skipped: true, error: err };
      }
    );
}

function gap(key, ms) {
  const at = lastAt[key] || 0;
  return now() - at < (ms === undefined ? GAP : ms);
}

function mark(key) {
  lastAt[key] = now();
}

function reset(key) {
  lastAt[key] = 0;
  leave(key);
}

module.exports = { GAP, busy, enter, leave, once, gap, mark, reset };
