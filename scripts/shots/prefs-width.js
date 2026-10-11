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

    const unit = 390 / 750;
    const rpx = (px) => +(px / unit).toFixed(1);

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
