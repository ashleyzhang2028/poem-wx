const fs = require("fs");
const path = require("path");
const vm = require("vm");

const FILE = path.join(__dirname, "corpus", "data", "poems-seasonal.js");

const BOOK_META = {
  tangshi: { name: "唐诗", page: "/tangshi/" },
  gushi: { name: "古诗「非唐代」", page: "/gushi/" },
  songci: { name: "词", page: "/songci/" },
  jinxiandai: { name: "近现代诗词", page: "/jinxiandai/" },
  guwen: { name: "古文观止", page: "/guwen/" }
};

function load(file) {
  const sandbox = { window: {}, console: console };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(file || FILE, "utf8"), sandbox, { filename: "poems-seasonal.js" });
  return sandbox.POEMS_SEASONAL || {};
}

function siteRows(W, extra) {
  const added = extra || load();
  const books = (W.SITE_BOOKS_DEF || []).concat(W.SITE_BOOKS || []);
  const rows = [];
  Object.keys(added).forEach(function (book) {
    const meta = books.filter(function (b) { return b.id === book; })[0]
      || BOOK_META[book] || { id: book, name: book };
    (added[book] || []).forEach(function (p) {
      rows.push({
        id: p.id,
        originId: p.id.split("-").slice(1).join("-"),
        title: p.title,
        author: p.author,
        authorName: "",
        dynasty: p.dynasty,
        source: p.source,
        selection: "",
        meaning: "",
        gloss: "",
        grade: 0,
        term: 0,
        gradeGroup: p.group || "",
        aliases: null,
        text: p.text,
        translation: "",
        translationSource: "",
        book: book,
        bookName: meta.name,
        page: meta.page
      });
    });
  });
  return rows;
}

function attach(W, extra) {
  const site = W.SITE_INDEX || (W.SITE_INDEX = []);
  const have = {};
  site.forEach(function (p) { have[p.id] = true; });
  siteRows(W, extra).forEach(function (p) {
    if (have[p.id]) return;
    have[p.id] = true;
    site.push(p);
  });
  return W;
}

module.exports = { FILE, BOOK_META, load, siteRows, attach };
