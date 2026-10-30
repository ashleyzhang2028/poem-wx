const store = require("./store");

const KEY = "kb_last_read_v1";

function get() {
  const v = store.read(KEY, null);
  return v && v.id ? v : null;
}

function put(entry) {
  if (!entry || !entry.id) return;
  store.write(KEY, {
    id: String(entry.id),
    sid: String(entry.sid || ""),
    src: entry.src === true,
    t: String(entry.t || ""),
    a: String(entry.a || ""),
    n: String(entry.n || ""),
    b: String(entry.b || ""),
    at: Date.now()
  });
}

module.exports = { get, put };
