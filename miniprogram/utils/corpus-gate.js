const corpus = require("./corpus");

function open(page, scope, boot) {
  page.corpusToken = (page.corpusToken || 0) + 1;
  const token = page.corpusToken;
  if (corpus.isReady(scope)) {
    if (page.data.corpusState) page.setData({ corpusState: "" });
    boot();
    return;
  }
  page.setData({ corpusState: "loading" });
  corpus.ready(scope).then(() => {
    if (token !== page.corpusToken) return;
    page.setData({ corpusState: "" });
    boot();
  }, () => {
    if (token !== page.corpusToken) return;
    page.setData({ corpusState: "failed" });
  });
}

function close(page) {
  page.corpusToken = (page.corpusToken || 0) + 1;
}

module.exports = { open, close };
