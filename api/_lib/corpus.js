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

var PACK = { books: packBooks, poems: packPoems, catalogs: packCatalog, authors: packAuthors };

function payload(part, rows) {
  var data = PACK[part](rows);
  return Object.assign({ rev: revOf(data) }, data);
}

function load(deps, part) {
  var hit = memo[part];
  var now = deps.now();
  if (hit && hit.store === deps.store && now - hit.at < TTL_MS) return Promise.resolve(hit.value);
  return PARTS[part](deps.store).then(function (data) {
    var value = data ? Object.assign({ rev: revOf(data) }, data) : null;
    if (value) memo[part] = { store: deps.store, at: now, value: value };
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
  return load(deps, part).then(function (value) {
    if (!value) {
      return { status: 404, body: { code: "E_CORPUS_EMPTY", message: "语料「" + part + "」还没有入库" } };
    }
    var since = String((query && query.rev) || "");
    return { status: 200, body: since === value.rev ? { rev: value.rev, same: true } : value };
  });
}

module.exports = { PARTS: Object.keys(PARTS), corpusPublic: corpusPublic, payload: payload, reset: reset };
