/**
 * 自绘底栏的「当前项」同步。
 *
 * 用了自定义 tabBar（app.json 里 `"custom": true`）之后，平台不再替你
 * 管高亮 —— 每个 tab 页 onShow 里必须自己告诉底栏「现在在第几项」。
 * 漏一次，切过去之后底栏还高亮着上一栏。
 *
 * 这个函数收口这一件事：拿页面上写死的序号，setActive 一次。
 * 序号与 custom-tab-bar/index.js 里的 list 顺序**一一对应**，
 * 改底栏顺序时两处一起改（自检守着：四个 tab 页各调一次）。
 */
function sync(page, index) {
  if (typeof page.getTabBar !== "function") return;
  const bar = page.getTabBar();
  if (bar && typeof bar.setActive === "function") bar.setActive(index);
}

module.exports = { sync };
