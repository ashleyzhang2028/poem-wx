"use strict";

var TTL_MS = 5 * 60 * 1000;

var COURSE_BOOK = "poems";

var memo = {};

function packer(keys) {
  var dict = {};
  var seen = {};
  keys.forEach(function (k) { dict[k] = []; });
  return {
    dict: dict,
    put: function (key, v) {
      if (!v) return -1;
      var at = key + "\u0000" + v;
      if (seen[at] === undefined) {
        dict[key].push(v);
        seen[at] = dict[key].length - 1;
      }
      return seen[at];
    }
  };
}

function text(v) {
  return v === null || v === undefined ? "" : String(v);
}

function aliasesOf(raw) {
  if (!raw) return null;
  try {
    var list = JSON.parse(raw);
    return Array.isArray(list) && list.length ? list : null;
  } catch (e) {
    return null;
  }
}

function packBooks(books) {
  return {
    books: books.map(function (b) {
      var out = { id: text(b.book_id), name: text(b.name), page: text(b.page), unit: text(b.unit), count: Number(b.total) || 0 };
      if (b.kind === "catalog") {
        out.prefix = text(b.prefix);
        out.remote = true;
      }
      return out;
    })
  };
}

function packPoems(poems) {
  var pack = packer(["d", "g", "sel", "s"]);
  var rows = poems.map(function (p) {
    var alt = text(p.author_alt);
    return [
      text(p.id),
      text(p.title),
      text(p.author) || alt || null,
      pack.put("d", text(p.dynasty)),
      pack.put("s", text(p.source)),
      pack.put("g", text(p.grade_group)),
      pack.put("sel", text(p.selection)),
      Number(p.grade) || 0,
      Number(p.term) || 0,
      alt || null,
      aliasesOf(p.aliases)
    ];
  });
  return { dict: pack.dict, rows: rows };
}

function packCatalog(catalog) {
  var pack = packer(["a", "d"]);
  var rows = {};
  catalog.forEach(function (r) {
    var id = text(r.book_id);
    (rows[id] = rows[id] || []).push([text(r.title), pack.put("a", text(r.author)), pack.put("d", text(r.note)), Number(r.in_course) === 1 ? 1 : 0]);
  });
  return { dict: pack.dict, rows: rows };
}

function packAuthors(authors) {
  var era = {};
  authors.forEach(function (a) {
    era[text(a.name)] = { era: text(a.era), at: Number(a.era_at) || 0 };
  });
  return { era: era };
}

function packTexts(list) {
  var pack = packer(["s"]);
  var rows = {};
  (list || []).forEach(function (t) {
    var id = text(t.book_id);
    (rows[id] = rows[id] || []).push([
      Number(t.pos) || 0,
      text(t.title),
      text(t.sid),
      text(t.text),
      text(t.translation),
      pack.put("s", text(t.translation_src))
    ]);
  });
  return { dict: pack.dict, rows: rows };
}

function packGloss(list) {
  var rows = {};
  (list || []).forEach(function (g) {
    var id = text(g.book_id);
    var items = g.gloss;
    if (typeof items === "string") {
      try { items = JSON.parse(items); } catch (e) { items = null; }
    }
    if (!Array.isArray(items) || !items.length) return;
    (rows[id] = rows[id] || []).push([Number(g.pos) || 0, text(g.title), items]);
  });
  return { dict: {}, rows: rows };
}

var PARTS = {
  books: function (store) {
    return Promise.resolve(store.listCorpusBooks()).then(function (books) {
      return books.length ? packBooks(books) : null;
    });
  },
  poems: function (store) {
    return Promise.resolve(store.listCorpusPoems(COURSE_BOOK)).then(function (poems) {
      return poems.length ? packPoems(poems) : null;
    });
  },
  catalogs: function (store) {
    return Promise.resolve(store.listCorpusCatalog()).then(function (catalog) {
      return catalog.length ? packCatalog(catalog) : null;
    });
  },
  authors: function (store) {
    return Promise.resolve(store.listCorpusAuthors()).then(function (authors) {
      return authors.length ? packAuthors(authors) : null;
    });
  },
  texts: function (store, query) {
    return Promise.resolve(store.listCorpusTexts(text((query && query.book) || ""))).then(function (texts) {
      return texts.length ? packTexts(texts) : null;
    });
  },
  gloss: function (store, query) {
    return Promise.resolve(store.listCorpusGloss(text((query && query.book) || ""))).then(function (list) {
      return list.length ? packGloss(list) : null;
    });
  }
};

function revOf(data) {
  var raw = JSON.stringify(data);
  var h = 2166136261;
  for (var i = 0; i < raw.length; i += 1) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16) + "-" + raw.length.toString(16);
}

var PACK = { books: packBooks, poems: packPoems, catalogs: packCatalog, authors: packAuthors, texts: packTexts, gloss: packGloss };

function payload(part, rows) {
  var data = PACK[part](rows);
  return Object.assign({ rev: revOf(data) }, data);
}

function load(deps, part, query) {
  var key = part + "\u0000" + text((query && query.book) || "");
  var hit = memo[key];
  var now = deps.now();
  if (hit && hit.store === deps.store && now - hit.at < TTL_MS) return Promise.resolve(hit.value);
  return PARTS[part](deps.store, query).then(function (data) {
    var value = data ? Object.assign({ rev: revOf(data) }, data) : null;
    if (value) memo[key] = { store: deps.store, at: now, value: value };
    return value;
  });
}

function reset() {
  memo = {};
}

function corpusPublic(deps, part, query) {
  if (!Object.prototype.hasOwnProperty.call(PARTS, part)) {
    return Promise.resolve({ status: 404, body: { code: "E_CORPUS_PART", message: "没有这一份语料：" + part } });
  }
  if (SCOPED[part] && !text(query && query.book)) {
    return Promise.resolve({ status: 400, body: { code: "E_CORPUS_BOOK", message: "语料「" + part + "」要带 book 参数" } });
  }
  return load(deps, part, query).then(function (value) {
    if (!value) {
      return { status: 404, body: { code: "E_CORPUS_EMPTY", message: "语料「" + part + "」还没有入库" } };
    }
    var since = String((query && query.rev) || "");
    return { status: 200, body: since === value.rev ? { rev: value.rev, same: true } : value };
  });
}

var SCOPED = { texts: true, gloss: true };

module.exports = { PARTS: Object.keys(PARTS), SCOPED: SCOPED, corpusPublic: corpusPublic, payload: payload, reset: reset };
