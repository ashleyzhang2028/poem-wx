#!/usr/bin/env node
/**
 * 量详情页那一行（对齐 · 注音 · 字号）**在浏览器里真正的宽度**。
 *
 *   node scripts/shots/render.js            # 先生成预览页
 *   node scripts/shots/prefs-width.js       # 打一行读数
 *
 * 为什么要有这个：check.js V25 得知道这一行放不放得下（Issue #26 的最后一句
 * 是「详情页一行显示，你做到了吗」）。可**算式量不准** —— 它按
 * 「汉字 1em、非汉字查真字体度量」估，而这一行落在宋体上，宋体的
 * 「A」是 0.72em、全角减号整整一格。第一版算式算出 502rpx，
 * 浏览器里是 626rpx：差 124rpx，方向还偏窄 —— 算式说「还很宽裕」的时候，
 * 真机上可能已经折了。
 *
 * 所以真值从这里取（浏览器算出来的盒子），算式只当粗筛。
 * check.js 里那条断言是拿这份读数当上界的（「算式与浏览器量出来的数对得上」）。
 *
 * ⚠️ 不装 puppeteer-core 时**明说装不上**，不静默编一个数出来 ——
 * 一条按估算过的断言，比没有断言更糟：它会把「放不下」说成「放得下」。
 */
"use strict";
const path = require("path");
const fs = require("fs");

const PREVIEW = path.join(__dirname, "out", "preview.html");
if (!fs.existsSync(PREVIEW)) {
  console.error("✗ 没有预览页，先跑 node scripts/shots/render.js");
  process.exit(1);
}
let puppeteer;
try {
  puppeteer = require("puppeteer-core");
} catch (e) {
  console.error("✗ 没装 puppeteer-core：npm i -D puppeteer-core（截图与量尺寸都不是构建的一部分）");
  process.exit(1);
}
const CHROME = process.env.CHROME_PATH || "/usr/local/bin/chromium";
if (!fs.existsSync(CHROME)) {
  console.error("✗ 找不到 chromium：" + CHROME + "（用 CHROME_PATH 指一个）");
  process.exit(1);
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    args: ["--no-sandbox", "--disable-gpu"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1200, deviceScaleFactor: 2 });
  await page.goto("file://" + PREVIEW, { waitUntil: "networkidle0" });
  await page.evaluate(() => document.fonts.ready);

  const out = await page.evaluate(() => {
    const dev = [...document.querySelectorAll(".device")]
      .find((d) => d.getAttribute("data-screen") === "reader");
    if (!dev) return null;
    const prefs = dev.querySelector(".prefs");
    const card = dev.querySelector(".poem-card");
    if (!prefs || !card) return null;
    const cs = getComputedStyle(card);
    const inner =
      card.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    // px → rpx：**用 render.js 自己那把尺子换算**，不拿机壳宽度算 ——
    // .device 外面还有 8px 的描边，390px 里那 16px 不是页面的。
    // （render.js 里 RPX = 390/750，与它在 <style> 里摊平 wxss 时用的是同一个数。）
    const unit = 390 / 750;
    const rpx = (px) => +(px / unit).toFixed(1);
    // 一行 = 七个段 + 两道竖线；逐个段报出来，改文案时好对账。
    // ⚠️ 一行真正的宽度是「两端之间的距离」，**不是** .prefs 的盒子宽 ——
    // .prefs 是 flex:center，盒子里被 justify-content 甩出来的空白不算进这一行。
    // 第一版拿盒子宽当行宽，于是「左 909.2 → 右 1168.8」量成 595.5（盒子），
    // 而七个段其实是 499 —— 平白多算了一整行，还把结论说成「余 0、贴着边」。
    const kids = [...prefs.children];
    const first = kids[0].getBoundingClientRect();
    const last = kids[kids.length - 1].getBoundingClientRect();
    const parts = kids.map((el) => ({
      cls: el.className,
      w: rpx(el.getBoundingClientRect().width),
      text: (el.innerText || "").replace(/\s+/g, ""),
    }));
    return {
      cardInner: rpx(inner),
      rowW: rpx(last.right - first.left),
      parts,
    };
  });
  await browser.close();

  if (!out) {
    console.error("✗ 预览里没有 data-screen=\"reader\" 那一屏");
    process.exit(1);
  }

  // 上面吐出来的已经是 rpx（换算在页面里做，用页面根字号那把尺子）
  console.log("详情页那一行（data-screen=reader）");
  out.parts.forEach((p) => {
    console.log("  " + (p.text || p.cls).padEnd(14) + p.w.toFixed(1) + "rpx");
  });
  const slack = out.cardInner - out.rowW;
  console.log("");
  console.log("  一行合计   " + out.rowW.toFixed(1) + "rpx");
  console.log("  卡片内容宽 " + out.cardInner.toFixed(1) + "rpx");
  console.log("  余        " + slack.toFixed(1) + "rpx"
    + (slack < 0 ? "  ← 负的，已经在折了" : ""));
})();
