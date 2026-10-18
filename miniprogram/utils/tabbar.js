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

function show(page) {
  const bar = barOf(page);
  if (bar && typeof bar.show === "function") bar.show();
}

function hide(page) {
  const bar = barOf(page);
  if (bar && typeof bar.hide === "function") bar.hide();
}

function pick(page) {
  const bar = sync(page, 2);
  show(page);
  return bar;
}

function exists() {
  const pages = getCurrentPages();
  const page = pages[pages.length - 1];
  return !!barOf(page);
}

module.exports = { sync, show, hide, pick, exists };
