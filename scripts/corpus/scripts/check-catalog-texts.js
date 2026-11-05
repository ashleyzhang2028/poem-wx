"use strict";

const seed = require("../../corpus-seed");

const BOOKS = ["tangshi300", "songci300", "tongxin"];

const SAME_POEM = 0.8;

const HOLES = [
  "tangshi300#102", "tangshi300#177", "tangshi300#189", "tangshi300#206", "tangshi300#213",
  "tangshi300#219", "tangshi300#233", "tangshi300#253", "tangshi300#273"
];

function hanOnly(text) {
  return String(text || "").replace(/[^\u3400-\u9fff]/g, "");
}

function sayings(text) {
  return String(text || "").split(/[\n。！？；]/).map(hanOnly).filter(Boolean);
}

function said(own, ref) {
  const mine = hanOnly(own);
  const other = hanOnly(ref);
  if (!mine) return !other;
  if (!other) return true;
  if (mine === other) return true;
  const quotes = sayings(own).filter(function (line) {
    return line.length >= 6;
  });
  if (!quotes.length) return true;
  const hit = quotes.filter(function (line) {
    return other.indexOf(line) >= 0;
  }).length;
  return hit * 2 >= quotes.length;
}

function overlaps(a, b) {
  const grams = function (text) {
    const out = new Set();
    for (let i = 0; i < text.length - 1; i += 1) out.add(text.slice(i, i + 2));
    return out;
  };
  const mine = grams(hanOnly(a));
  const other = grams(hanOnly(b));
  let hit = 0;
  mine.forEach(function (g) {
    if (other.has(g)) hit += 1;
  });
  return mine.size ? hit / mine.size : 0;
}

function masterIndex(W) {
  const byRef = new Map();
  const list = [];
  (W.TEXT_MASTER || []).forEach(function (m) {
    if (!m || !m.text) return;
    list.push(m);
    (m.entries || []).forEach(function (id) {
      byRef.set(id, m);
    });
  });
  return { byRef: byRef, list: list };
}

function check(W, rows) {
  const master = masterIndex(W);
  const bad = [];

  const nearest = function (text) {
    let best = null;
    master.list.forEach(function (m) {
      const score = overlaps(text, m.text);
      if (!best || score > best.score) best = { m: m, score: score };
    });
    return best;
  };

  BOOKS.forEach(function (book) {
    const catalog = (W.SITE_CATALOGS || {})[book];
    if (!catalog) {
      bad.push(book + " 不在 site-catalogs.js 里");
      return;
    }
    const texts = rows.texts.filter(function (r) {
      return r.book_id === book;
    });
    const byPos = new Map();
    texts.forEach(function (r) {
      byPos.set(r.pos, r);
    });

    catalog.rows.forEach(function (row, i) {
      const pos = i + 1;
      const where = book + " #" + pos + "《" + row[0] + "》";
      const own = byPos.get(pos);
      if (!own) {
        if (HOLES.indexOf(book + "#" + pos) < 0) bad.push(where + " 目录有、正文没有");
        return;
      }
      if (own.title !== row[0]) {
        bad.push(where + " 表里挂的标题是《" + own.title + "》");
      }

      const ref = master.byRef.get(own.sid);
      if (ref) {
        const body = hanOnly(own.text);
        if (body.indexOf(hanOnly(ref.text)) < 0 && hanOnly(ref.text).indexOf(body) < 0) {
          bad.push(where + " 正文与 sid " + own.sid + "（《" + ref.title + "》）不是同一篇");
        }
        if (!said(own.translation, ref.translation)) {
          bad.push(where + " 译文与 sid " + own.sid + "（《" + ref.title + "》）不是同一篇");
        }
        return;
      }

      if (book !== "tongxin") {
        const near = nearest(own.text);
        if (near && near.score >= SAME_POEM) {
          bad.push(where + " 正文与语料里已有的《" + near.m.title + "》撞了（" + near.score.toFixed(2) + "）");
        }
      }
    });

    texts.forEach(function (r) {
      if (r.pos >= 1 && r.pos <= catalog.rows.length) return;
      bad.push(book + " 正文 #" + r.pos + "《" + r.title + "》不在目录里");
    });

    rows.gloss.filter(function (r) {
      return r.book_id === book;
    }).forEach(function (r) {
      const text = byPos.get(r.pos);
      const where = book + " #" + r.pos + "《" + r.title + "》注释";
      if (!text) {
        bad.push(where + " 挂在一篇没有正文的目录上");
        return;
      }
      if (!Array.isArray(r.gloss) || !r.gloss.length) {
        bad.push(where + " 是空的");
        return;
      }
      const body = hanOnly(text.text);
      r.gloss.forEach(function (it) {
        const raw = String((it || [])[0] || "").trim();
        const word = hanOnly(raw);
        if (!word) bad.push(where + " 有空词条");
        else if (body.indexOf(word) < 0) bad.push(where + "「" + raw + "」不在正文里");
      });
    });
  });

  return bad;
}

module.exports = { BOOKS: BOOKS, check: check };

if (require.main === module) {
  const W = seed.loadCorpus();
  const rows = seed.seedRows(W);
  const bad = check(W, rows);
  const counts = BOOKS.map(function (book) {
    const texts = rows.texts.filter(function (r) { return r.book_id === book; }).length;
    const gloss = rows.gloss.filter(function (r) { return r.book_id === book; }).length;
    return book + " 正文 " + texts + " 篇 / 注释 " + gloss + " 篇";
  });
  if (bad.length) {
    console.log("✗ 目录正文对不上 " + bad.length + " 处：");
    bad.slice(0, 40).forEach(function (b) {
      console.log("  · " + b);
    });
    process.exit(1);
  }
  const holes = HOLES.length;
  console.log("✓ 目录、正文、译文、注释逐条对得上：" + counts.join("，") +
    (holes ? "；另有 " + holes + " 篇目录条目语料里没有正文，按空缺跳过" : ""));
}
