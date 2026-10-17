const corpus = require("./corpus");

function list() {
  const books = corpus.books().filter((b) => b.id !== "poems");
  return [{ id: "", name: "课内诗词" }].concat(books.map((b) => ({ id: b.id, name: b.name })));
}

function nameOf(scopes, id) {
  const hit = (scopes || []).find((s) => s.id === id);
  return hit ? hit.name : (scopes && scopes[0] ? scopes[0].name : "");
}

module.exports = { list, nameOf };
