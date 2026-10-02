#!/usr/bin/env node
/**
 * 逐屏截图：把 preview.html 里的每一屏裁成一张 PNG。
 *
 *   node scripts/shots/render.js          # 先生成预览页
 *   node scripts/shots/shoot.js           # 26 屏全截
 *   node scripts/shots/shoot.js reader    # 只截名字里含 reader 的
 *
 * 输出到 scripts/shots/out/shots/<key>.png（不入库）。
 *
 * 为什么不是一个 --screenshot 一个进程：那要重开 26 次浏览器，两分钟起步。
 * 这里开一次、量出每屏的位置、按位置裁 —— 位置由浏览器算，不靠目测。
 *
 * 依赖 puppeteer-core + 本机 chromium。装不上就明说装不上，不静默退化成
 * 「截了个整页」——半张图被当成一整屏看，比没有图更糟。
 */
"use strict";
const path = require("path");
const fs = require("fs");

const HERE = __dirname;
const PREVIEW = path.join(HERE, "out", "preview.html");
const OUT = path.join(HERE, "out", "shots");

function fail(msg) {
  console.error("✗ " + msg);
  process.exit(1);
}

let puppeteer;
try {
  puppeteer = require("puppeteer-core");
} catch (e) {
  fail("没装 puppeteer-core。装一个：npm i -D puppeteer-core（截图不是构建的一部分，所以没进 dependencies）");
}

const CHROME = process.env.CHROME_PATH || "/usr/local/bin/chromium";
if (!fs.existsSync(CHROME)) fail("找不到 chromium：" + CHROME + "（用 CHROME_PATH 指一个）");
if (!fs.existsSync(PREVIEW)) fail("没有预览页，先跑 node scripts/shots/render.js");

(async () => {
  const only = process.argv.slice(2);
  fs.mkdirSync(OUT, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    args: ["--no-sandbox", "--disable-gpu", "--hide-scrollbars"],
  });
  const page = await browser.newPage();
  // 2 倍图：小字（注音 18rpx）在 1 倍下会糊，看不清是不是真的对上了
  await page.setViewport({ width: 1600, height: 1200, deviceScaleFactor: 2 });
  await page.goto("file://" + PREVIEW, { waitUntil: "networkidle0" });
  // 等字体就位：篇名宋体是 @font-face 注入的，不等就会截到回退字形
  await page.evaluate(() => document.fonts.ready);

  const screens = await page.$$eval(".device", (els) => els.map((el) => {
    const r = el.getBoundingClientRect();
    return {
      key: el.getAttribute("data-screen"),
      x: r.x + window.scrollX, y: r.y + window.scrollY,
      w: r.width, h: r.height,
    };
  }));

  const wanted = only.length ? screens.filter((s) => only.some((k) => s.key.indexOf(k) >= 0)) : screens;
  if (!wanted.length) fail("没有匹配的屏：" + only.join(", "));

  for (const s of wanted) {
    await page.screenshot({ path: path.join(OUT, s.key + ".png"),
      clip: { x: s.x, y: s.y, width: s.w, height: s.h } });
    console.log("✓ " + s.key + "  " + Math.round(s.w) + "x" + Math.round(s.h));
  }
  await browser.close();
  console.log("写出 " + wanted.length + " 屏 → scripts/shots/out/shots/");
})();
