const tiers = require("./tiers");

function shown(tag, current) {
  return tiers.rank(tag) > tiers.rank(current);
}

function textOf(tag) {
  return tiers.nameOf(tag) + " 起";
}

module.exports = { shown, textOf };
