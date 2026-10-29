const store = require("./store");

const KEY = "kb_seen_v1";

function seen(name) {
  return Number((store.read(KEY, {}) || {})[name]) || 0;
}

function see(name, at) {
  const stamp = Number(at) || 0;
  if (stamp <= seen(name)) return;
  store.write(KEY, Object.assign({}, store.read(KEY, {}), { [name]: stamp }));
}

function fresh(name, at) {
  return (Number(at) || 0) > seen(name);
}

function newest(list, pick) {
  return (list || []).reduce((top, item) => Math.max(top, Number(pick(item)) || 0), 0);
}

module.exports = { see, fresh, newest };
