const RULE = /^[\s\u3000]*[┌├└][─┬┼┴]+[┐┤┘][\s\u3000]*$/;

const EDGE_LEFT = /[│┌├└]/;
const EDGE_RIGHT = /[│┐┤┘]/;

const HAN = /[\u3400-\u4dbf\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/;

const FULL_STOP = /[，。；：、！？）」』】》〉”’…]/;

const MIN_WIDTH = 14;

const MAX_COLUMN = 120;

const TABLE_MAX = 300;

const MIN_TABLE = 160;

const LABEL_MAX = 40;

const LABEL_WIDTH = 64;

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
    buf += ch;
  }
  if (parts.length < 2) return null;
  return parts;
}

function ruleWidths(lines) {
  let best = null;
  lines.forEach(function (line) {
    if (!isRule(line)) return;
    const cells = String(line)
      .replace(/^[\s\u3000]*[┌├└]/, "")
      .replace(/[┐┤┘][\s\u3000]*$/, "")
      .split(/[┬┼┴]/);
    if (!best || cells.length > best.length) best = cells;
  });
  return best ? best.map(function (c) { return textWidth(c) + 1; }) : null;
}

function byBars(lines) {
  const widths = ruleWidths(lines);
  if (!widths || widths.length < 2) return null;

  const rows = [];
  lines.forEach(function (line) {
    if (isRule(line)) return;
    const row = splitRow(line);
    if (row && row.length === widths.length) rows.push(row);
  });
  return rows.length ? { widths: widths, rows: rows } : null;
}

function splitByWidth(cell, widths) {
  const chars = [...String(cell || "")];
  const width = widths[widths.length - 1];
  const out = [];
  let buf = "";
  let used = 0;
  chars.forEach(function (ch) {
    const w = colWidth(ch);
    if (buf && used + w > width) {
      out.push(pad(buf));
      buf = "";
      used = 0;
    }
    buf += ch;
    used += w;
  });
  if (pad(buf)) out.push(pad(buf));
  return out;
}

function byRule(lines) {
  const widths = ruleWidths(lines);
  if (!widths || widths.length < 2) return null;

  const rows = [];
  lines.forEach(function (line) {
    if (isRule(line)) return;
    const row = splitRow(line);
    if (!row) return;

    const lead = row.slice(0, widths.length - 1);
    const tail = splitByWidth(row.slice(widths.length - 1).join(" "), widths);
    const cells = lead.map(pad);
    cells[cells.length - 1] = cells[cells.length - 1] + " " + (tail[0] || "");
    rows.push(cells.map(pad).concat(tail.slice(1)));
  });
  return rows.length ? { widths: widths, rows: rows } : null;
}

function ragged(rows) {
  return rows.filter(function (r) {
    return r.length !== rows[0].length;
  }).length;
}

function fromCells(lines) {
  const rows = nonEmpty(lines.map(splitRow).filter(Boolean));
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
  return { widths: widths, rows: rows };
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

function labelTable(rows) {
  return rows.map(function (r) {
    return r.slice(0, 1).concat(r.slice(1).join(" "));
  });
}

function widthFor(widths) {
  const total = widths.reduce(function (a, b) { return a + b; }, 0);
  return Math.max(total, MIN_TABLE);
}

function layoutRows(built) {
  const widths = fitWidths(built.widths);
  const wide = widths.length === 2 && widths[1] > LABEL_MAX;
  const rows = wide ? labelTable(built.rows) : built.rows;
  const colWidths = wide
    ? [Math.min(widths[0], LABEL_MAX), widthFor(widths) - Math.min(widths[0], LABEL_MAX)]
    : widths;
  return {
    widths: colWidths,
    rows: rows.map(function (r) {
      return {
        cells: r.map(function (cell, i) {
          return { at: 0, text: wrap(cell, colWidths[i] * 2) };
        })
      };
    })
  };
}

function parse(lines) {
  const table = lines.filter(function (l) {
    return isRule(l) || l.indexOf("│") >= 0;
  });
  if (!table.length) return null;

  const bars = byBars(table);
  const built = bars && !ragged(bars.rows) ? bars : byRule(table) || fromCells(table);
  if (!built || !built.rows.length) return null;

  return layoutRows(built);
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

function nonEmpty(rows) {
  return rows.filter(function (r) {
    return r.some(function (c) { return !!c; });
  });
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
    if (isTableLine(line) || (buf.length && !pad(line))) {
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
