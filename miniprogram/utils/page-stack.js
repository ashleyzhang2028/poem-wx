function list() {
  if (typeof getCurrentPages !== "function") return [];
  const pages = getCurrentPages();
  return Array.isArray(pages) ? pages : [];
}

function top() {
  const pages = list();
  return pages.length ? pages[pages.length - 1] : null;
}

function route() {
  const page = top();
  return (page && page.route) || "";
}

module.exports = { list, top, route };
