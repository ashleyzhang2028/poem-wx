const entitlement = require("./entitlement");

function stats() {
  const s = entitlement.snapshot();
  let ok = 0;
  Object.keys(s.caps).forEach((k) => {
    if (s.caps[k].ok) ok += 1;
  });
  const caps = Object.keys(s.caps).length;

  return { caps, enabled: ok, percent: caps ? Math.round((ok / caps) * 100) : 0 };
}

module.exports = { stats };
