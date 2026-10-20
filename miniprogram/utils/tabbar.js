function barOf(page) {
  if (!page) return null;
  const native = typeof page.getTabBar === "function" ? page.getTabBar() : null;
  const bar = native || (typeof page.selectComponent === "function" ? page.selectComponent("#tabbar") : null);
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
