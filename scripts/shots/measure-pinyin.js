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
const UI_SCALE = Number(process.env.UI_SCALE || 1);

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    args: ["--no-sandbox", "--disable-gpu"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1200, deviceScaleFactor: 1 });
  await page.goto("file://" + PREVIEW, { waitUntil: "networkidle0" });
  await page.evaluate(() => document.fonts.ready);

  const out = await page.evaluate((scale) => {

    const PER_RPX = 390 / 750;
    const rpx = (px) => +(px / PER_RPX).toFixed(2);
    const dev = [...document.querySelectorAll(".device")]
      .find((d) => d.getAttribute("data-screen") === "reader-jiangjinjiu");
    if (!dev) return { error: "预览里没有 reader-jiangjinjiu 那一屏（注音混排）" };
    dev.style.setProperty("--layout-w", 600 * scale + "px");

    const body = dev.querySelector(".poem-body");
    const lines = [...dev.querySelectorAll(".token-line")];

    function probe(sizeClass) {
      body.className = "poem-body align-left " + sizeClass;
      const rows = lines.slice(0, 10).map((l) => {
        const box = l.getBoundingClientRect();
        const chs = [...l.querySelectorAll(".tk-ch")].map((c) => c.getBoundingClientRect());
        const tks = [...l.querySelectorAll(".token")].map((c) => c.getBoundingClientRect());
        const step = [];
        const gap = [];
        for (let i = 1; i < tks.length; i++) {
          step.push(rpx(tks[i].left - tks[i - 1].left));
          gap.push(rpx(tks[i].left - tks[i - 1].right));
        }
        return {
          py: !!l.querySelector(".tk-py"),
          box: rpx(box.height),
          ink: rpx(Math.max(...chs.map((c) => c.bottom)) - Math.min(...chs.map((c) => c.top))),
          w: rpx(tks[0].width),
          step: step,
          gap: gap,
        };
      });

      const inkBox = lines.slice(0, 10).map((l) => {
        const cs = [...l.querySelectorAll(".tk-ch")].map((c) => c.getBoundingClientRect());
        return { top: Math.min(...cs.map((c) => c.top)), bot: Math.max(...cs.map((c) => c.bottom)) };
      });
      const inkGap = [];
      for (let i = 1; i < inkBox.length; i++) inkGap.push(rpx(inkBox[i].top - inkBox[i - 1].bot));
      const lineH = [];
      for (let i = 1; i < lines.length && i < 10; i++) {
        lineH.push(rpx(lines[i].getBoundingClientRect().top - lines[i - 1].getBoundingClientRect().top));
      }
      return { rows: rows, inkGap: inkGap, lineH: lineH };
    }

    const sizes = {};
    ["size--2", "size--1", "size-0", "size-1", "size-2", "size-3", "size-4"]
      .forEach((k) => { sizes[k] = probe(k); });
    return { sizes: sizes, box: body.className };
  }, UI_SCALE);
  await browser.close();

  if (out.error) { console.error("✗ " + out.error); process.exit(1); }

  let bad = 0;
  console.log("详情页注音那一路（reader-jiangjinjiu ｜ 生字注音 + 左对齐）");
  console.log("");
  console.log("  档位      字身盒   行盒(有音/无音)   步进   空隙   行距(字底→字顶)");
  Object.keys(out.sizes).forEach((k) => {
    const p = out.sizes[k];
    const py = [...new Set(p.rows.filter((r) => r.py).map((r) => r.box))];
    const no = [...new Set(p.rows.filter((r) => !r.py).map((r) => r.box))];
    const step = [...new Set(p.rows.flatMap((r) => r.step))];
    const gap = [...new Set(p.rows.flatMap((r) => r.gap))];
    const ink = [...new Set(p.inkGap)];
    const ok = py.length === 1 && no.length === 1 && py[0] === no[0] && step.length === 1
      && gap.length === 1 && ink.length === 1 && ink[0] > 0;
    if (!ok) bad++;
    console.log("  " + k.padEnd(9) + String(p.rows[0].w).padEnd(9)
      + (py.join(",") + " / " + no.join(",")).padEnd(17)
      + step.join(",").padEnd(7) + gap.join(",").padEnd(7) + ink.join(",")
      + (ok ? "" : "   ← 不齐"));
  });
  console.log("");
  if (bad) {
    console.log("  ✗ " + bad + " 个档位没齐（行盒要「有音=无音」、步进与空隙要处处相等、行距要为正）");
    process.exit(1);
  }
  console.log("  ✓ 逐档：有音无音的行盒相等；步进与空隙处处相等；行距为正且处处相等");
})();
