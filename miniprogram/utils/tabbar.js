function barOf(page) {
  if (!page || typeof page.getTabBar !== "function") return null;
  const bar = page.getTabBar();
  if (!bar || typeof bar.setActive !== "function") return null;
  return bar;
}

function sync(page, index) {
  const bar = barOf(page);
  if (!bar) return null;
  bar.setActive(index);
  return bar;
}

function pick(page) {
  return sync(page, 2);
}

function below(page) {
  return !!barOf(page);
}

function exists() {
  const pages = getCurrentPages();
  const page = pages[pages.length - 1];
  return !!barOf(page);
}

module.exports = { sync, pick, below, exists };
