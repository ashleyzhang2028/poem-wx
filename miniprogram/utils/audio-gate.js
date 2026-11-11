const audio = require("./poem-audio");
const entitlement = require("./entitlement");

const CAP_OF = { one: "audio", list: "audioloop" };

function capOf(kind) {
  return CAP_OF[kind] || CAP_OF.one;
}

function usable(kind) {
  return audio.usable() && (kind !== "list" || audio.loopable());
}

function ask(kind, ctx) {
  return entitlement.askTier(capOf(kind), ctx || {});
}

module.exports = { capOf, usable, ask };
