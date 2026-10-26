const corpus = require("./corpus");
const source = require("./poem-source");

function fill(sheet, id) {
  const meta = corpus.indexById(id);
  const sid = (meta && meta.sid) || (/^\d+$/.test(String(id)) ? String(id) : "");
  if (!sheet || !sid) return;
  source.byId(sid, meta).then(
    (poem) => sheet.showText(id, source.textOf(poem), "这一篇的正文是空的，换一篇看看", source.metaOf(poem)),
    (err) => {
      console.error("[sheet] 正文取失败 sid=" + sid, "HTTP " + ((err && err.statusCode) || 0), (err && err.message) || "");
      sheet.showText(id, "");
    }
  );
}

module.exports = { fill };
