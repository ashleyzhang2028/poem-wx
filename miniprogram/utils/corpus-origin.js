const corpus = require("./corpus");

const MARK = { pack: "PAC", mysql: "SQL", mirror: "MIR" };

function originOf(id, src) {
  const key = String(id == null ? "" : id);
  if (!key) return "";
  if (corpus.entry(key)) return MARK.pack;
  if (!corpus.ownerOf(key)) return MARK.mirror;
  return src ? MARK.mysql : MARK.pack;
}

module.exports = { MARK, originOf };
