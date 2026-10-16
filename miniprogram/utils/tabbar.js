function sync(page, index) {
  if (typeof page.getTabBar !== "function") return null;
  const bar = page.getTabBar();
  if (!bar || typeof bar.setActive !== "function") return null;
  bar.setActive(index);
  return bar;
}

function exists() {
  const pages = getCurrentPages();
  const page = pages[pages.length - 1];
  return !!sync(page, 0);
}

module.exports = { sync, exists };
