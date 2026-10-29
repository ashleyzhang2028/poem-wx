const SEP = /^([^：:]*)[：:]([\s\S]*)$/;

const PAIRS = 2;

function rows(list) {
  const out = [];
  (list || []).forEach(function (it) {
    const word = String((it && it[0]) || "").trim();
    const note = String((it && it[1]) || "").trim();
    if (!word || !note) return;
    const hit = note.match(SEP);
    out.push({ w: word, d: hit ? hit[2].trim() : note });
  });

  const lines = [];
  for (let i = 0; i < out.length; i += PAIRS) {
    lines.push({ key: "g" + i, cells: out.slice(i, i + PAIRS) });
  }
  return lines;
}

module.exports = { rows };
