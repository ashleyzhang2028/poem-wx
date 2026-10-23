const navbar = require("./nav-bar");

const COVER = 0.2;

function coverOf() {
  return Number((navbar.box().row * COVER).toFixed(2));
}

module.exports = { coverOf };
