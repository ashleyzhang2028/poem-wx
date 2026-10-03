# 离线预览

改界面时能「看见」自己改了什么，不必每轮都开微信开发者工具。

```bash
node scripts/shots/render.js       # 跑全部页面 → 编译 WXML → out/preview.html
node scripts/shots/shoot.js        # 逐屏截图到 out/shots/shots/
node scripts/shots/shoot.js reader # 只截名字里含 reader 的
node scripts/shots/measure.js      # 量每一格「两侧还剩多少」—— 挤不挤，说数字
node scripts/shots/measure.js --metrics   # 从真字体导出 font-metrics.json
node scripts/shots/prefs-width.js  # 量详情页那一行（对齐 ｜ 注音 ｜ 字号）多宽
```

`prefs-width.js` 是「**一行显示，你做到了吗**」这句话的答案（Issue #26）。
它量的不是 `.prefs` 的盒子宽 —— 那一层是 `flex:center`，被 `justify-content`
甩出来的空白不算进这一行 —— 而是**两端之间的距离**：
七个段加起来 499rpx，卡片内容宽 596rpx，余 96rpx。
`check.js` V25 那套算式只是粗筛（它算 502），真值以这份读数为准。

> 写这条时踩过两个坑，都留在脚本的注释里：一是预览把**视觉隐藏的原生
> `<radio>`** 画成了 23px 的圆圈（真机上它是 1rpx，等于不存在），
> 于是量出来多了一整圈；二是拿 `.prefs` 的盒子宽当行宽。
> **先怀疑尺子，再怀疑排版。**

**`measure.js` 是「挤」这个字的尺子。** 用户说「选项内文字左右 padding
和它自己的边界太近了」，眼睛只能看出「有点紧」；它把每一格的
格宽 / 文字宽 / 两侧余量打出来，才知道紧到 4.8px。改完再量一次，
31.6px。「多留白」这件事有数字之后才好争。

`--metrics` 导出的是**字体自己的度量**（advance width / em），按
`.chip-t` / `.opt-name` / `.tag` 分别导 —— 选项名走宋体、格子文字走黑体，
「+」在两边宽度不同（0.564 vs 0.584em），一把尺量不了两家人。
`check.js` V23 拿这张表算「最长的选项名两侧还余多少」，不装浏览器也能验。

截图要 `puppeteer-core` 与本机 chromium（`npm i -D puppeteer-core`，
chromium 路径可用 `CHROME_PATH` 指）。装不上时它**明说装不上**，
不静默退化成「截个整页」—— 半张图被当成一整屏看，比没有图更糟。

## 它是什么

把每个页面**真跑一遍**（真实的 `onShow`、代理过的 `setData`、真的本机存储），
拿到最终 `data`；再按 `wx:if` / `wx:elif` / `wx:else` / `wx:for` 把 WXML 编译成
HTML，套进一个 390×844 的手机壳。`rpx → px` 按 390/750 换算。

## 篇名宋体：预览要看得见

`--font-poem` 的第一位是外挂名 `Kuibu Serif`，真机上由 `wx.loadFontFace`
注册（见 `miniprogram/utils/font.js`）。**这个容器里没有中文宋体**，
`render.js` 若不做处理，标题会退回文泉驿黑体 —— 那样看截图就分不清
「标题到底是不是宋体」。

所以预览会把本机的 Noto Serif SC 注册成同名：

```bash
cp <poem 仓库>/fonts/NotoSerifSC-{400,600}.woff2 scripts/shots/out/serif-{400,600}.woff2
node scripts/shots/render.js   # 会打印「预览已注入篇名宋体」
```

没有这两个文件也能跑，只是标题的字形不真 —— 布局仍然是真的。
文件在 `.gitignore` 里，不入库。

## ⚠️ 预览自己也会骗人，两处已经栽过

预览是「看界面用的工具」，工具说假话比界面写错更难发现 —— 因为照着改会改坏真机。
两件真发生过的事记在这儿：

1. **`.page` 的规则被整条丢掉。** 预览把 `page{}` 改写成 `.screen{}`，用的是
   `\bpage\s*\{`；而 `\b` 判断的是「前一个字符是词字符」，`.page {` 的点不是 ——
   于是 `.page {` 被改成 `..screen{`，非法选择器，浏览器整条丢弃。
   后果：预览里页面左右内边距与底色从来没生效过，卡片通栏铺满屏（真机是左右各留
   `--page-x`），而「通栏 + 卡缝露出灰底」看着就是一条条横带 ——
   **一个假问题把真问题盖住了**。现在用 `(?<![\w.-])` 开头，`check.js` V15 守着。
2. **镜像与页面不同步。** 页面里 `.pref-item` 那几处的原生控件仍露脸、按**标签名**
   给着 `margin-right` / `transform`，而预览把 `<radio>` 编译成 `<div class="n-radio">`，
   标签名一条都匹配不到 —— 预览里的圆点与文字贴在一起、缩放也没生效，看着比真机
   「干净」。现在 `NATIVE_CSS` 里按 class 补了等价项，`check.js` 有一条逐条比对
   两边关键声明（`margin-right` / `transform`）。

**结论**：改界面之前，先确认预览自己是对的。`check.js` 跑在 `render.js` 之后会多验两条。

## 它不是什么

**不替代真机。** 布局、配色、文案、显隐口径是真的；原生控件的外观、字体回退、
安全区是近似的。改完先在这儿看一遍，再去开发者工具过。

`wxml.js` 那个编译器只够预览用（约 200 行），别拿它当构建工具 ——
它不支持模板、自定义组件（`lock-card` / `skeleton` 是在 `render.js` 里
先展开成普通标签再编译的），也不处理 `wx:key` 之外的模板语法。

## 页面清单

`pages.json` 里一页一条：跑哪个页面、导航栏写什么、是不是 tab 页、
登录与否、档位给到哪一档。默认给 `max`，否则一半页面停在门禁卡上，看不出长相。

`settings` 那一条会把本机偏好写进去（对齐 / 注音档 / 字号）——
版式是这一屏最大的变数，「左对齐 + 全文注音」与「居中 + 不注音」排出来是两张脸，
所以长诗（《琵琶行》的序）、古文（《郑伯克段于鄢》）、词（《宴山亭》）
各有一屏常驻。
