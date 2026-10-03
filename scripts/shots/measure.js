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
/**
 * 让预览按**真机的比例**量长度。
 *
 * 预览把 rpx 按 390 宽折算（1rpx = 0.52px），而浏览器给 15px 以下的字兜着最小字号 ——
 * 25rpx 在预览里量出来比真机宽。注入 `html{font-size:100px;--ui-scale:1}` 之后，
 * 1rpx 就是 0.5 × --ui-scale px，跟真机同一把尺子（容器边框再吃掉几十像素，
 * 与 rpx 折算无关）。--layout-w 用同一比例反推，于是「一行放不放得下」量的是真机。
 */
async function injectRealScale(page) {
  const uiScale = Number(process.env.UI_SCALE || 1);
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
  }, uiScale);
}

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

  const chars = [...new Set(
    "一二三四五六七八九十年级上下学期本册及之前小初中高全部随机＋+·-0123456789ABCDFGIKLMNPRSy"
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
    await injectRealScale(page);
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
  await injectRealScale(page);

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

  /* ---------- 详情页那一行：注音 ｜ 对齐 ｜ 字号 ----------
     用户这一轮的话是「详情页一行显示」。一行放不放得下**必须量** ——
     上一版就是凭估的（把字号当 1em 宽，按 25rpx 算），排出来顶出卡片 46rpx。
     这里把这一行的可用宽度与实际内容宽度一起打出来，溢出会标 ⚠。 */
  await page.evaluate(() => {}).catch(() => {});
  const rows2 = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll(".prefs").forEach((el) => {
      const scr = el.closest("[data-screen]");
      const cs = getComputedStyle(el);
      const kids = [...el.children].map((c) => {
        const r = c.getBoundingClientRect();
        return {
          cls: c.className.split(" ").slice(0, 2).join(" "),
          text: (c.textContent || "").trim().slice(0, 12),
          w: +r.width.toFixed(1),
          h: +r.height.toFixed(1),
        };
      });
      const inner = kids.reduce((a, b) => a + b.w, 0)
        + (kids.length - 1) * (parseFloat(cs.columnGap) || 0);
      // 内容宽度按**每个孩子自己的外框**加起来量：不在 flex 里靠 scrollWidth
      // （写了 overflow 的容器 scrollWidth 会等于 clientWidth，漏报）
      const contentW = kids.length ? Math.max(
        kids.reduce((a, b) => a + b.w, 0),
        el.scrollWidth
      ) : 0;
      const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
      out.push({
        screen: scr ? scr.getAttribute("data-screen") : "?",
        availW: +(el.clientWidth - padX).toFixed(1),
        sumW: +(kids.reduce((a, b) => a + b.w, 0)).toFixed(1),
        scrollW: el.scrollWidth,
        clientW: el.clientWidth,
        // 溢出：孩子的右边界有没有越过容器的右边界（各自量，不看 scrollWidth）
        overflow: kids.length
          ? +(Math.max(...[...el.children].map((c) => c.getBoundingClientRect().right))
              - el.getBoundingClientRect().right).toFixed(1)
          : 0,
        minSegH: Math.min(...kids.filter((k) => k.cls.indexOf("seg") >= 0).map((k) => k.h), 99),
        kids,
      });
    });
    return out;
  });

  console.log("");
  console.log("详情页那一行（.prefs）：可用宽 / 内容宽 / 溢出");
  rows2.forEach((r) => {
    console.log("  " + r.screen.padEnd(20)
      + "可用 " + String(r.availW).padStart(6)
      + " · 内容 " + String(r.sumW).padStart(6)
      + " · 右边界超出 " + String(r.overflow).padStart(5) + "px"
      + (r.overflow > 0.5 ? "  ⚠ 溢出一行" : "  ✓ 一行放得下"));
    console.log("    " + r.kids.map((k) => k.cls + "(" + k.w + ")").join(" | "));
  });

  await browser.close();
})();
