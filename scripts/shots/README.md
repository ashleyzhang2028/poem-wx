# 离线预览

改界面时能「看见」自己改了什么，不必每轮都开微信开发者工具。

```bash
node scripts/shots/render.js       # 跑 19 个页面 → 编译 WXML → out/preview.html
node scripts/shots/out/all.js      # 逐屏截图到 out/shots/
```

## 它是什么

把每个页面**真跑一遍**（真实的 `onShow`、代理过的 `setData`、真的本机存储），
拿到最终 `data`；再按 `wx:if` / `wx:elif` / `wx:else` / `wx:for` 把 WXML 编译成
HTML，套进一个 390×844 的手机壳。`rpx → px` 按 390/750 换算。

## 它不是什么

**不替代真机。** 布局、配色、文案、显隐口径是真的；原生控件的外观、字体回退、
安全区是近似的。改完先在这儿看一遍，再去开发者工具过。

`wxml.js` 那个编译器只够预览用（约 200 行），别拿它当构建工具 ——
它不支持模板、自定义组件（`lock-card` / `skeleton` 是在 `render.js` 里
先展开成普通标签再编译的），也不处理 `wx:key` 之外的模板语法。

## 页面清单

`pages.json` 里一页一条：跑哪个页面、导航栏写什么、是不是 tab 页、
登录与否、档位给到哪一档。默认给 `max`，否则一半页面停在门禁卡上，看不出长相。
