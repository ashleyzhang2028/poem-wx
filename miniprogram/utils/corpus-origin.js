const MARK = { pack: "PAC", mysql: "SQL", mirror: "MIR" };

function originOf(src) {
  const key = String(src == null ? "" : src);
  if (key === "pack") return MARK.pack;
  if (key === "mysql") return MARK.mysql;
  if (key === "mirror") return MARK.mirror;
  return "";
}

module.exports = { MARK, originOf };
