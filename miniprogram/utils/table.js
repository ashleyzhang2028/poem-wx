const RULE = /^[\s\u3000]*[┌├└][─┬┼┴]+[┐┤┘][\s\u3000]*$/;

const EDGE_LEFT = /[│┌├└]/;
const EDGE_RIGHT = /[│┐┤┘]/;

const HAN = /[\u3400-\u4dbf\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/;

const FULL_STOP = /[，。；：、！？）」』】》〉”’…]/;

const MIN_WIDTH = 14;

const MIN_COLUMN = 24;

const MAX_COLUMN = 120;

const TABLE_MAX = 300;

const MIN_TABLE = 160;

function isRule(line) {
  return RULE.test(String(line || ""));
}

function hasTable(text) {
  const lines = String(text == null ? "" : text).split("\n");
  for (let i = 0; i < lines.length; i++) if (isRule(lines[i])) return true;
  return false;
}

function colWidth(ch) {
  return HAN.test(ch) ? 2 : 1;
}

function textWidth(s) {
  let w = 0;
  for (const ch of String(s || "")) w += colWidth(ch);
  return w;
}

function pad(s) {
  return String(s || "").replace(/^\s+|\s+$/g, "");
}

function splitRow(line) {
  const s = String(line || "").replace(/^\s+/, "");
  const start = s.search(EDGE_LEFT);
  if (start < 0) return null;
  const rest = s.slice(start + 1);
  const parts = [];
  let buf = "";
  for (const ch of rest) {
    if (EDGE_RIGHT.test(ch)) {
      parts.push(pad(buf));
      buf = "";
      continue;
    }
    if (ch !== "│") buf += ch;
    else buf += "│";
  }
  if (parts.length < 2) return null;
  return parts;
}

function columnsOf(line) {
  if (isRule(line)) {
    const cells = String(line).split(/[┬┼┴]/);
    return cells.length;
  }
  const row = splitRow(line);
  return row ? row.length : 0;
}

function toRows(lines) {
  const rows = [];
  let cells = null;
  const flush = () => {
    if (cells) rows.push(cells);
    cells = null;
  };

  lines.forEach(function (line) {
    if (isRule(line)) {
      flush();
      return;
    }
    const row = splitRow(line);
    if (!row) return;
    if (cells && row.every(function (c) { return !c; })) {
      cells = cells.map(function (c, i) { return pad(c + row[i]); });
      return;
    }
    flush();
    cells = row;
  });
  flush();
  return rows;
}

function ruleColumns(lines) {
  let best = 0;
  lines.forEach(function (line) {
    if (isRule(line)) best = Math.max(best, columnsOf(line));
  });
  return best;
}

function cut(s, limit) {
  const chars = [...String(s || "")];
  let w = 0;
  let n = 0;
  for (; n < chars.length; n++) {
    const cw = colWidth(chars[n]);
    if (w + cw > limit) break;
    w += cw;
  }
  if (n >= chars.length) return s;
  for (let i = n - 1; i > 0 && i > n - 4; i--) {
    if (FULL_STOP.test(chars[i])) return chars.slice(0, i + 1).join("");
  }
  return chars.slice(0, Math.max(1, n)).join("");
}

function fragments(raw, anchors, widths) {
  const chars = [...raw];
  const cols = [];
  anchors.forEach(function (at, i) {
    const end = i + 1 < anchors.length ? anchors[i + 1] : chars.length;
    const cell = chars.slice(at, end).join("").replace(/[│┌├└┬┼┴┐┤┘─]/g, " ");
    cols.push({ at: at, text: cell, w: widths[i] * 2 });
  });

  const head = [];
  const body = [];
  cols.forEach(function (c) {
    if (c.at > 0 && !body.length) head.push(c.text);
    else body.push(c);
  });

  const rows = [];
  const lead = pad(head.join(""));
  if (lead) rows.push({ at: 0, text: lead });
  body.forEach(function (c) {
    wrap(c.text, c.w).forEach(function (p, i) {
      rows.push({ at: i === 0 ? c.at : 1, text: p });
    });
  });
  return rows;
}

function wrap(text, limit) {
  const s = pad(text);
  if (!s) return [];
  const out = [];
  let rest = s;
  while (rest) {
    const piece = cut(rest, limit);
    out.push(piece);
    rest = pad([...rest].slice([...piece].length).join(""));
  }
  return out;
}

function nonEmpty(rows) {
  return rows.filter(function (r) {
    return r.some(function (c) { return !!c; });
  });
}

function fromAnchors(lines) {
  const widths = lines
    .filter(function (l) { return isRule(l); })
    .map(function (l) {
      return String(l).split(/[┬┼┴]/).map(textWidth);
    })
    .reduce(function (a, b) { return b.length > a.length ? b : a; }, []);

  const probes = lines.filter(function (l) { return l.indexOf("│") >= 0; });
  const maxLen = probes.reduce(function (m, l) {
    return Math.max(m, [...String(l)].length);
  }, 0);

  const anchors = [];
  let from = 0;
  for (let c = 0; c < widths.length; c++) {
    let best = -1;
    let bestScore = 0;
    for (let at = from; at < maxLen; at++) {
      let hits = 0;
      probes.forEach(function (l) {
        const chars = [...String(l)];
        if (chars[at] && /[│┌├└]/.test(chars[at])) hits += 1;
      });
      const want = c === 0 ? 0 : anchors[c - 1] + widths[c - 1];
      const score = hits * 1000 - Math.abs(at - want);
      if (score > bestScore) {
        bestScore = score;
        best = at;
      }
    }
    if (best < 0) return null;
    anchors.push(best);
    from = best + 1;
  }

  const table = probes.map(function (l) {
    return { cells: fragments(l, anchors, widths) };
  });
  return { widths: widths, rows: table };
}

function fromCells(lines) {
  const rows = nonEmpty(toRows(lines));
  if (!rows.length) return null;
  const cols = rows.reduce(function (m, r) { return Math.max(m, r.length); }, 0);
  const widths = [];
  for (let c = 0; c < cols; c++) {
    widths.push(
      rows.reduce(function (m, r) {
        return Math.max(m, textWidth(r[c]));
      }, 0) + 2
    );
  }
  return {
    widths: widths,
    rows: rows.map(function (r) {
      return {
        cells: r.map(function (cell, i) {
          return { at: i * (MIN_COLUMN + 1), text: cell };
        })
      };
    })
  };
}

function fitWidths(widths) {
  const natural = widths.map(function (w) {
    return Math.max(MIN_WIDTH, Math.min(MAX_COLUMN, w));
  });
  const total = natural.reduce(function (a, b) { return a + b; }, 0);
  if (total >= MIN_TABLE && total <= TABLE_MAX) return natural;

  const scale = (total > TABLE_MAX ? TABLE_MAX : MIN_TABLE) / total;
  const out = natural.map(function (w) {
    return Math.max(MIN_WIDTH, Math.round(w * scale));
  });

  let rest = (total > TABLE_MAX ? TABLE_MAX : MIN_TABLE) - out.reduce(function (a, b) { return a + b; }, 0);
  for (let i = 0; rest !== 0 && i < out.length * 4; i++) {
    const at = i % out.length;
    if (rest > 0) {
      out[at] += 1;
      rest -= 1;
    } else if (out[at] > MIN_WIDTH) {
      out[at] -= 1;
      rest += 1;
    }
  }
  return out;
}

function parse(lines) {
  const lines2 = lines.filter(function (l) {
    return isRule(l) || l.indexOf("│") >= 0;
  });
  if (!lines2.length) return null;

  let built = null;
  if (ruleColumns(lines2) >= 2) built = fromAnchors(lines2);
  if (!built) built = fromCells(lines2);
  if (!built || !built.rows.length) return null;

  const widths = fitWidths(built.widths);
  const rows = built.rows.map(function (r) {
    return {
      cells: r.cells.map(function (c, i) {
        return { at: c.at, text: wrap(c.text, widths[i] * 2) };
      })
    };
  });

  return { widths: widths, rows: rows };
}

function isTableLine(line) {
  return isRule(line) || String(line || "").indexOf("│") >= 0;
}

function looksLikeTable(line) {
  if (isRule(line)) return true;
  const s = String(line || "");
  if (!/^\s*[│┌├└]/.test(s)) return false;
  return (s.match(/[│┌├└]/g) || []).length >= 2;
}

function parseText(text) {
  const lines = String(text == null ? "" : text).split("\n");
  if (!lines.some(looksLikeTable)) return null;

  const parts = [];
  const blocks = [];
  let buf = [];

  const flush = () => {
    if (!buf.length) return;
    const t = parse(buf);
    if (t) {
      parts.push({ k: "table", i: blocks.length });
      blocks.push(t);
    } else {
      buf.forEach(function (l) { parts.push({ k: "p", s: l }); });
    }
    buf = [];
  };

  lines.forEach(function (line) {
    if (isTableLine(line)) {
      buf.push(line);
      return;
    }
    if (buf.length && !pad(line)) {
      buf.push(line);
      return;
    }
    flush();
    parts.push({ k: "p", s: line });
  });
  flush();

  if (!blocks.length) return null;
  return { parts: parts, blocks: blocks };
}

module.exports = { parseText, parse, hasTable, looksLikeTable, isRule };
