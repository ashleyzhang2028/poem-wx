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

  const uiScale = Number(process.env.UI_SCALE || 1);
  const inject = async () => {
    await page.evaluate((scale) => {
      const html = document.documentElement;
      html.style.fontSize = "100px";
      html.style.setProperty("--ui-scale", String(scale));

      const w = (600 * scale) + "px";
      document.querySelectorAll(".device").forEach((d) => {
        d.style.setProperty("--layout-w", w);
        const scr = d.querySelector(".screen");
        if (scr) scr.style.setProperty("--layout-w", w);
      });
      return document.fonts.ready;
    }, uiScale);
  };

  await page.setViewport({ width: 1600, height: 1200, deviceScaleFactor: 2 });
  await page.goto("file://" + PREVIEW, { waitUntil: "networkidle0" });

  await page.evaluate(() => document.fonts.ready);
  await inject();

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
