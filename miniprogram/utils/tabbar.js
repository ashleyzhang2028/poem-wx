function sync(page, index) {
  if (typeof page.getTabBar !== "function") return;
  const bar = page.getTabBar();
  if (bar && typeof bar.setActive === "function") bar.setActive(index);
}

module.exports = { sync };
