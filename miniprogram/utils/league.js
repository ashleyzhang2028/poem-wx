const store = require("./store");
const entitlement = require("./entitlement");

const CAP = "league";

function canJoin() {
  return entitlement.can(CAP);
}

function optedIn() {
  return canJoin() && store.settings().leagueBoard !== false;
}

function canSwitch() {
  return entitlement.can(CAP);
}

function switched() {
  return canSwitch() && store.settings().leagueBoard === false;
}

function setOn(on) {
  if (!canSwitch()) return entitlement.decide(CAP);
  store.saveSettings({ leagueBoard: !!on });
  return { ok: true, reason: "ok", name: CAP, login: false };
}

function tier() {
  return entitlement.tierOf(CAP);
}

module.exports = { CAP, canJoin, optedIn, canSwitch, switched, setOn, tier };
