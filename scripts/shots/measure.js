#!/usr/bin/env node
/**
 * 量一量选项格的「两侧还剩多少」。
 *
 *   node scripts/shots/measure.js            量全部选项格 / 标签
 *   node scripts/shots/measure.js 随机       只看名字里含「随机」的
 *
 * 起因：「选项内文字左右 padding 和它自己的边界太近了」这句话，
 * 靠眼睛量不出来 —— 三列里当时那个 7 字名「小学+初中随机」两侧只剩 4.8px，
 * 看截图只觉得「有点紧」，说数字才知道紧到什么程度
 * （该名已按 Issue #26 收成「小初随机」，尺子留着，量的是列数这件事）。
 *
 * 它读的是 preview.html（先跑 render.js），量的是**浏览器算出来的**
 * 盒子，不是我从令牌里再推一遍 —— 推的那份写在 check.js V23 里，
 * 两者互为反证：算式说够、浏览器说不够，就是这类 bug。
 */
"use strict";
const path = require("path");
const fs = require("fs");

const PREVIEW = path.join(__dirname, "out", "preview.html");
let puppeteer;
try {
  puppeteer = require("puppeteer-core");
} catch (e) {
  console.error("✗ 没装 puppeteer-core：npm i -D puppeteer-core");
  process.exit(1);
}
const CHROME = process.env.CHROME_PATH || "/usr/local/bin/chromium";
if (!fs.existsSync(PREVIEW)) {
  console.error("✗ 没有预览页，先跑 node scripts/shots/render.js");
  process.exit(1);
}

/**
 * 把「一个字有多宽」从浏览器里导出来，给 check.js 的宽度算式用。
 *
 * 为什么要导：中文手机字体里汉字不是整整 1em，标点更窄。check.js 里
 * 凭「一个字 1em」估，会把 7 个字的选项名算得比格子还宽 —— 算式说放不下、
 * 眼睛说放着，那条断言就没人信了。
 *
 * 导出的是**字体自己的度量**（advance width / em），不是某一次的渲染结果，
 * 所以能跟 --ui-scale 一起缩放，也不会因为换字号而失效。
 */
async function dumpMetrics(page) {
  // 按**样式组合**分别导出，不是一个字体一把尺。
  //
  // 栽过：第一版只量了 .chip-t（黑体 600），拿它去算 .opt-name ——
  // 而选项名走 --font-poem（宋体 400），「+」在两边宽度不同（0.584 vs 0.564），
  // check.js 因此比浏览器少算 6.5rpx。字体不同，尺就不同。
  const combos = await page.evaluate(() => {
    const picks = [".chip-t", ".opt-name", ".opt-desc", ".tag"];
    const seen = {};
    picks.forEach((sel) => {
      const el = document.querySelector(sel);
      if (!el) return;
      const cs = getComputedStyle(el);
      seen[sel] = {
        fontFamily: cs.fontFamily,
        fontWeight: cs.fontWeight,
        fontSize: cs.fontSize
      };
    });
    return seen;
  });

  // 要量的字符：既有选项名里那些字，也有别的样式的标签会用到的
  // （「A－ / A＋」里那个全角减号是 Issue #26 详情页那一行加的 ——
  //  少了它，check.js V25 只能按一个汉字猜，算出来比真值窄 6rpx）。
  const chars = [...new Set(
    "一二三四五六七八九十年级上下学期本册及之前小初中高全部随机＋－+·-0123456789ABCDFGIKLMNPRSy"
      .split("")
  )];
  const out = {};
  for (const [sel, style] of Object.entries(combos)) {
    out[sel] = await page.evaluate(
      ({ style, chars }) => {
        const cv = document.createElement("canvas");
        const ctx = cv.getContext("2d");
        ctx.font = style.fontWeight + " " + style.fontSize + " " + style.fontFamily;
        const em = parseFloat(style.fontSize);
        const m = {};
        chars.forEach((c) => { m[c] = +(ctx.measureText(c).width / em).toFixed(4); });
        return m;
      },
      { style, chars }
    );
  }
  return out;
}

(async () => {
  const only = process.argv[2] || "";
  if (only === "--metrics") {
    const browser = await puppeteer.launch({
      executablePath: CHROME,
      headless: "new",
      args: ["--no-sandbox", "--disable-gpu"]
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 900, height: 1200 });
    await page.goto("file://" + PREVIEW);
    const m = await dumpMetrics(page);
    await browser.close();
    const out = path.join(__dirname, "font-metrics.json");
    fs.writeFileSync(out, JSON.stringify(m, null, 1));
    console.log("✓ 字体度量 → " + out + "："
      + Object.entries(m).map(([k, v]) => k + "(" + Object.keys(v).length + " 字)").join(" / "));
    return;
  }
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    args: ["--no-sandbox", "--disable-gpu"]
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 900, height: 1200 });
  await page.goto("file://" + PREVIEW);

  const rows = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll(".opt-row, .chip, .tag").forEach((el) => {
      const name = el.querySelector(".opt-name, .chip-t") || el;
      const box = el.getBoundingClientRect();
      const tb = name.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const screen = el.closest("[data-screen]");
      out.push({
        screen: screen ? screen.getAttribute("data-screen") : "?",
        cls: el.className.split(" ")[0],
        text: (name.textContent || "").trim().slice(0, 14),
        cellW: +box.width.toFixed(1),
        textW: +tb.width.toFixed(1),
        gapL: +(tb.left - box.left).toFixed(1),
        gapR: +(box.right - tb.right).toFixed(1),
        padX: cs.paddingLeft,
        radius: cs.borderRadius,
        // 文字有没有被挤到折行 / 溢出
        wrapped: name.scrollWidth > name.clientWidth + 1
      });
    });
    return out;
  });
  await browser.close();

  const hit = rows.filter((r) => !only || r.text.includes(only));
  console.log("屏 / 类 / 文字          格宽  文字宽  左  右  圆角  折行");
  hit.forEach((r) => {
    console.log([
      r.screen.padEnd(20), r.cls.padEnd(8), r.text.padEnd(14),
      String(r.cellW).padStart(6), String(r.textW).padStart(7),
      String(r.gapL).padStart(5), String(r.gapR).padStart(5),
      r.radius.padStart(7), r.wrapped ? "  ⚠折" : "    "
    ].join(" "));
  });

  const worst = hit.reduce((a, b) => (b.gapL < a.gapL ? b : a), hit[0]);
  if (worst) {
    console.log("");
    console.log("最紧的一处：" + worst.screen + " 「" + worst.text + "」两侧各 " + worst.gapL + "px");
  }
})();
