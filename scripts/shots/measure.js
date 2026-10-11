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
