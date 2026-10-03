#!/usr/bin/env node
/**
 * 离线预览：真跑页面拿 data，再把 WXML 编译成 HTML，套进手机壳截图。
 *
 * 说清它不是什么：仓库里没有微信开发者工具，所以**原生控件的外观、
 * 字体回退、安全区都是近似的**。布局、配色、文案、显隐口径是真的。
 * 真机以开发者工具为准。
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { compile } = require("./wxml.js");
const ROOT = path.join(__dirname, "..", "..", "miniprogram");

/* ---------- 0. 先把本机存储装上 ----------
   必须在 require 任何页面之前装：store.js 在模块加载时就认了 wx，
   晚一步装，页面读到的永远是空。 */
const MEM = {};
global.wx = {
  getStorageSync: (k) => (k in MEM ? MEM[k] : ""),
  setStorageSync: (k, v) => { MEM[k] = v; },
  removeStorageSync: (k) => { delete MEM[k]; },
  getStorageInfoSync: () => ({ keys: Object.keys(MEM), currentSize: 0, limitSize: 10240 })
};

/* ---------- 1. 跑页面 ---------- */
let CURRENT = null;

function runtime() {
  const saved = { Page: global.Page, Component: global.Component, getApp: global.getApp, getCurrentPages: global.getCurrentPages };
  Object.assign(global.wx, {
    showToast() {}, showModal() {}, showLoading() {}, hideLoading() {},
    showActionSheet(o) { o && o.success && o.success({ tapIndex: 0 }); },
    navigateTo() {}, switchTab() {}, redirectTo() {}, navigateBack() {},
    pageScrollTo() {}, nextTick(f) { if (f) f(); },
    setNavigationBarTitle() {}, vibrateShort() {}, stopPullDownRefresh() {},
    setClipboardData(o) { o && o.success && o.success(); },
    getSystemInfoSync: () => ({ statusBarHeight: 20, windowWidth: 375, platform: "devtools" }),
    loadFontFace() {}, login(o) { o && o.fail && o.fail({ errMsg: "no wx" }); },
    getUserProfile(o) { o && o.fail && o.fail({}); },
    request(o) { o && o.fail && o.fail({ errMsg: "offline" }); },
    downloadFile(o) { o && o.fail && o.fail({}); },
    createInnerAudioContext: () => ({ play() {}, pause() {}, stop() {}, destroy() {}, onEnded() {}, onError() {} })
  });
  global.Component = () => {};
  global.getApp = () => ({ globalData: {} });
  global.getCurrentPages = () => [];
  return {
    mount(pg, query) {
      let opt = null;
      global.Page = (o) => { opt = o; };
      const file = path.join(ROOT, pg + ".js");
      delete require.cache[require.resolve(file)];
      require(file);
      if (!opt) return null;
      const page = Object.assign({}, opt);
      page.data = JSON.parse(JSON.stringify(opt.data || {}));
      page.setData = function (obj, cb) {
        Object.keys(obj).forEach((k) => { this.data[k] = obj[k]; });
        if (cb) cb();
      };
      ["onLoad", "onShow"].forEach((fn) => { if (typeof page[fn] === "function") page[fn].call(page, query || {}); });
      CURRENT = page;
      return page.data;
    },
    /* 让预览能接着页面往下走一步（拍「答题中 / 交卷后」这类状态） */
    current() { return CURRENT; },
    done() { Object.assign(global, { Page: saved.Page, Component: saved.Component, getApp: saved.getApp, getCurrentPages: saved.getCurrentPages }); }
  };
}

const PAGE_TITLES = JSON.parse(fs.readFileSync(path.join(__dirname, "pages.json"), "utf8"));

/* ---------- 2. 样式：把 wxss 摊平成普通 CSS ---------- */
/** rpx → px：390 宽的屏上 750rpx = 390px，所以 1rpx = 0.52px */
const RPX = 390 / 750;
function rpx2px(css) {
  return css.replace(/(-?[\d.]+)rpx/g, (_, n) => (Number(n) * RPX).toFixed(3) + "px");
}

function flattenCss(file, seen) {
  seen = seen || new Set();
  if (seen.has(file) || !fs.existsSync(file)) return "";
  seen.add(file);
  let css = fs.readFileSync(file, "utf8");
  css = css.replace(/@import\s+"([^"]+)"\s*;/g, (_, rel) => {
    const p = path.resolve(path.dirname(file), rel);
    return flattenCss(p, seen);
  });
  return css;
}

const TOKENS = flattenCss(path.join(ROOT, "styles/tokens.wxss"));
const APP_CSS = flattenCss(path.join(ROOT, "app.wxss")).replace(/@import[^;]+;/g, "");
const COMP_CSS = flattenCss(path.join(ROOT, "components/lock-card/lock-card.wxss"))
  + flattenCss(path.join(ROOT, "components/skeleton/skeleton.wxss"))
  // 自绘底栏也是组件，样式同样要进预览 —— 它要是漏了，底栏在截图里
  // 就是个没有图标的灰条，看图的人会以为「图标没做」
  + flattenCss(path.join(ROOT, "custom-tab-bar/index.wxss"));

/**
 * ⚠️ 预览把 <radio> 编译成 <div class="n-radio">：页面样式表里按**标签名**
 * 写的规则（`radio { transform: scale(.86) }`）在这里一律匹配不到，
 * 预览就比真机「好看一点点」—— 而这一丁点差异，恰好是圆点被压到笔画上、
 * 被竖线切一半这类问题的藏身处。所以下面按 class 补一份等价规则。
 *
 * 加规则时记住：**这里只是让预览不发假消息**，真机的观感仍由页面样式表决定。
 */
const NATIVE_CSS = `
/* 原生控件的近似外观 —— 只为预览看得出「这里是个开关」 */
.n-radio,.n-checkbox{width:23px;height:23px;border-radius:50%;border:1px solid #c7c9cd;background:#fff;display:inline-flex;align-items:center;justify-content:center;font-size:13px;color:#fff;flex:none}
.n-checkbox{border-radius:4px}
.n-radio.on{border-color:#1c1c1e;border-width:7px}
.n-checkbox.on{background:#1c1c1e;border-color:#1c1c1e}
.n-radio.dis,.n-checkbox.dis{opacity:.5}
/* 页面样式表里凡按**标签名**写的规则，这里按 class 补一份等价项。
   少补一条，预览就会比真机好看一点 —— 而问题恰好藏在那一丁点里。 */
.pref-item .n-radio,.pref-item .n-checkbox{margin-right:var(--sp-2)}
/* 选项行（.opt-row）里的原生控件现在是**视觉隐藏**的（.opt-radio）——
   它不露脸，所以镜像里也不需要它的外观。原来那三条给
   .opt-row radio 的规则（margin-right / align-self / scale）
   到这里就失效了：再留着，守的是已经不存在的东西。 */
.pref-item .n-radio,.pref-item .n-checkbox{transform:scale(.8)}
.char .n-radio{position:absolute;right:2rpx;top:2rpx;transform:scale(.56);transform-origin:right top;margin-right:0}
/* 视觉隐藏的原生控件（.opt-radio / .seg-radio）在预览里也得**真的不占位**：
   真机上它们的宽高是 1rpx，页面的 flex 排布里等于「不存在」。
   这里如果漏了这条，预览里的每个选项都会多出 23px 的圆圈 ——
   于是「详情页那一行到底放不放得下」在预览里永远量不准
   （Issue #26 花了三次才找到这里：算式说 502、浏览器说 626）。 */
.opt-radio,.seg-radio{position:absolute;width:1rpx;height:1rpx;opacity:0;pointer-events:none}
.n-switch{width:51px;height:31px;border-radius:31px;background:#e5e5e5;position:relative;flex:none}
.n-switch.on{background:#1c1c1e}
.n-switch-k{position:absolute;top:2px;left:2px;width:27px;height:27px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.2);transition:left .2s}
.n-switch.on .n-switch-k{left:22px}
.n-slider{position:relative;height:28px;display:flex;align-items:center;width:100%;--n-slider-inset:10px}
.n-slider-track{position:relative;height:4px;border-radius:2px;background:#ececef;width:100%;margin:0 var(--n-slider-inset)}
.n-slider-fill{position:absolute;left:0;top:0;height:4px;border-radius:2px;background:#1c1c1e}
.n-slider-knob{position:absolute;top:50%;width:20px;height:20px;border-radius:50%;background:#fff;border:1px solid #e0d8c8;box-shadow:0 1px 4px rgba(0,0,0,.18);transform:translate(-50%,-50%)}
.n-ph{color:#9ca3af}
.n-input{display:flex;align-items:center;font-size:14px;color:#1c1c1e;min-height:22px;width:100%}
.n-image{width:56px;height:56px;border-radius:50%;background:#f2f2f4}
/* WXML 标签 → HTML div 之后，默认块级；但页面样式里的 display:flex
   要能压过它，所以这里用最低优先级的选择器 */
/* 文本节点没有自己的盒子，行高靠父级给 —— 预览里补一条，
   否则纯文本与 flex 子项的行高对不上 */
[data-tag]{line-height:inherit}
`;

/* ---------- 3. 组装 HTML ---------- */
const SHELL_CSS = `
*{box-sizing:border-box;margin:0;padding:0}
body{background:#e8e6e1;font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;padding:24px;display:flex;flex-wrap:wrap;gap:20px}
.device{width:390px;background:#f5f5f7;border-radius:38px;box-shadow:0 10px 40px rgba(0,0,0,.18);overflow:hidden;border:8px solid #1b1b1d;position:relative}
.navbar{background:#ffffff;color:#1c1c1e;height:64px;display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:500;letter-spacing:1px;position:relative}
.navbar .back{position:absolute;left:14px;font-size:22px;opacity:.9}
.navbar .menu{position:absolute;right:12px;top:8px;width:78px;height:28px;border-radius:14px;border:1px solid rgba(28,28,30,.2);display:flex;align-items:center;justify-content:space-around;opacity:.6}
.navbar .menu i{width:4px;height:4px;border-radius:50%;background:#1c1c1e;display:block}
.screen{height:760px;overflow-y:auto;overflow-x:hidden}
/* 预览里的底栏直接用组件自己的样式（custom-tab-bar/index.wxss 已并进 COMP_CSS），
   这里只把它的定位改成「随流」—— 真机是 fixed，预览里让它落在屏幕块的最下面 */
.device .tabbar{position:static;height:56px}
.caption{font-size:12px;color:#5a5a5a;text-align:center;margin-top:8px}
`;

/** page{} 那套变量与底色，得挂到 .screen 上才生效 */
function screenCss(cfg, pageCss) {
  const raw = TOKENS + APP_CSS + COMP_CSS + NATIVE_CSS + pageCss
    // 供 shoot.js / measure.js 覆盖的排版宽度（见 README「预览自己也会骗人」第 3 条）
    + "\n.screen{--layout-w:100%;}";
  // page{} 是小程序的根选择器，预览里对应 .screen。
  //
  // ⚠️ 这里用 (?<![\w.-]) 而不是 \b 开头，是被一个真 bug 教会的：
  // \bpage\s*\{ 里的 \b 判断的是「前一个是词字符」，而 `.page {` 的前一个字符是
  // 点，不是词字符 —— 所以 \b 成立，`.page {` 被一起改成了 `..screen{`。
  // 那是个非法选择器，浏览器整条丢掉：**预览里 .page 的 padding 与底色从来没有生效过**。
  // 后果是卡片在预览里通栏（真机是左右各留 --page-x），
  // 而「卡片通栏 + 卡缝露出灰底」看着就是一条条灰带 —— 一个假问题盖着真问题。
  // 断言 V15 守着这一类：预览里页面根选择器必须真的匹配得上。
  const scoped = raw.replace(/(?<![\w.-])page\s*\{/g, ".screen{");
  return rpx2px(scoped);
}

function expandComponents(node, data, P) { return node; }

/**
 * 底栏预览：照 custom-tab-bar/index.wxml 的**结构**生成同一份标记。
 *
 * 这里刻意手写而不是去解析组件 wxml —— 组件里的图标是 CSS 画的
 * （.tab-ico-book 这些类来自 custom-tab-bar/index.wxss，已并进 COMP_CSS），
 * 只要类名对得上，形状就是真的。V 组断言守着两边类名一致。
 */
function tabBarHtml(active) {
  const list = [
    { text: "背诵", icon: "book" },
    { text: "课外", icon: "stack" },
    { text: "搜索", icon: "search" },
    { text: "我的", icon: "person" }
  ];
  const items = list.map((it, i) =>
    `<div class="tab ${i === active - 1 ? "on" : ""}">`
    + `<div class="tab-ico tab-ico-${it.icon}"></div>`
    + `<div class="tab-text">${it.text}</div></div>`).join("");
  return `<div class="tabbar">${items}</div>`;
}

function pageHtml(cfg, data) {
  const wxmlPath = path.join(ROOT, cfg.page + ".wxml");
  let wxml = fs.readFileSync(wxmlPath, "utf8");
  // 先把组件展开成它的 wxml（保持 wx:if 包裹的结构），再交编译器
  wxml = wxml.replace(/<lock-card\b([^>]*)\/>/g, (_, a) => {
    const attrs = {};
    (a.match(/([\w:.-]+)\s*=\s*"([^"]*)"/g) || []).forEach((x) => {
      const i = x.indexOf("="); attrs[x.slice(0, i).trim()] = x.slice(i + 1).replace(/^"|"$/g, "");
    });
    const v = (s) => String(s).replace(/\{\{([\s\S]*?)\}\}/g, (_, e) => {
      try { return String(new Function(...Object.keys(data), "return (" + e + ")")(...Object.values(data))); } catch (err) { return ""; }
    });
    const title = v(attrs.title || "登录后可用");
    const note = v(attrs.note || "");
    const mark = v(attrs.mark || title.charAt(0));
    // wx:if 挂在 lock-card 自己身上，展开时要带过去
    const cond = attrs["wx:if"] ? ` wx:if="${attrs["wx:if"]}"` : "";
    return `<view${cond} class="card lock-card"><text class="lock-mark">${mark}</text><text class="lock-title">${title}</text>`
      + `<text class="hint lock-note">${note}</text><button class="btn primary block lock-btn">微信登录</button>`
      + `<text class="lock-foot">不积跬步，无以至千里</text></view>`;
  });
  wxml = wxml.replace(/<skeleton\b([^>]*)\/>/g, (_, a) => {
    const rows = /rows\s*=\s*"(\d+)"/.exec(a);
    const n = rows ? Number(rows[1]) : 3;
    const cond = /wx:if\s*=\s*"([^"]*)"/.exec(a);
    // wx:if 挂在 skeleton 自己身上，展开时要带过去
    const guard = cond ? ` wx:if="${cond[1]}"` : "";
    let s = `<view${guard} class="sk"><view class="sk-block sk-line w60"></view><view class="sk-block sk-line w40"></view><view class="sk-block sk-btn"></view>`;
    for (let i = 0; i < n; i++) s += '<view class="sk-block sk-line w80"></view>';
    return s + "</view>";
  });
  const body = compile(wxml, data);
  const pageCss = flattenCss(path.join(ROOT, cfg.page + ".wxss"));
  const screenCssStr = screenCss(cfg, pageCss);
  return `<div class="device" data-screen="${cfg.key}">
  <div class="navbar">${cfg.back ? '<span class="back">‹</span>' : ""}${cfg.title}${cfg.menu ? '<span class="menu"><i></i><i></i><i></i></span>' : ""}</div>
  <div class="screen"><style>${screenCssStr}</style>${body}</div>
  <div class="caption">${cfg.key}</div>
  ${cfg.tab ? tabBarHtml(cfg.tab) : ""}
  </div>`;
}

/* ---------- main ---------- */
const only = process.argv[2];
const rt = runtime();
const storeMod = require(path.join(ROOT, "utils", "store.js"));
const saveProfile = storeMod.saveProfile;

const cases = [];
Object.keys(PAGE_TITLES).forEach((key) => {
  if (only && key.indexOf(only) < 0) return;
  const cfg = PAGE_TITLES[key];
  cfg.key = key;
  cases.push(cfg);
});

const html = [];
cases.forEach((cfg) => {
  try {
    saveProfile(cfg.saveProfile || { logged: !!cfg.logged, nickname: cfg.logged ? "张敏" : "", avatarUrl: "" });
    // 预览要能看「注音开着 / 左对齐」这些状态：settings 直接写进本机存储
    if (cfg.settings) storeMod.saveSettings(cfg.settings); else storeMod.saveSettings({});
    // 档位走服务端那一份（本机的会被降级），默认给 max 才看得到全部页面
    const store2 = require(path.join(ROOT, "utils", "store.js"));
    if (cfg.logged) {
      const auth = store2.read(store2.KEYS.auth, {}) || {};
      auth.tier = cfg.tier || "max";
      auth.role = cfg.role || "owner";
      auth.local = false;
      store2.write(store2.KEYS.auth, auth);
    } else {
      store2.write(store2.KEYS.auth, {});
    }
    const data = rt.mount(cfg.page, cfg.query || {});
    if (!data) { console.log("skip (no Page) " + cfg.page); return; }
    /* 「答题中」这类**中途状态**得先走一步才能拍到：试卷要真出题、
       计时器要真走。不然考试页只拍得到 setup（选范围那张卡），
       而这一版改的恰好是「答题时不判对错」与「交卷后逐题摊开」两屏。
       `do` 是页面自己的方法名，按顺序调；参数用 `with` 给。 */
    if (cfg.do) {
      cfg.do.forEach((step) => {
        const page = rt.current();
        const fn = page && page[step.call];
        if (typeof fn === "function") fn.call(page, step.with || {});
      });
    }
    html.push(pageHtml(cfg, data));
  } catch (e) {
    console.log("✗ " + cfg.page + " —— " + e.message);
  }
});
rt.done();

/* 篇名宋体的预览注入。
   预览环境（Linux 容器）里没有中文宋体，--font-poem 会整串落空、
   退回文泉驿黑体 —— 那样看截图就看不出「标题是不是宋体」。
   所以若本机有 Noto Serif SC（与网页版同一套），在预览页里注册成
   "Kuibu Serif"（就是 --font-poem 的第一个名字），让截图说真话。
   真机上这条路是 wx.loadFontFace 走的，见 utils/font.js。 */
function fontFaceCss() {
  const dir = path.join(__dirname, "out");
  const faces = [[400, "serif-400.woff2"], [600, "serif-600.woff2"]]
    .filter((f) => fs.existsSync(path.join(dir, f[1])))
    .map((f) => `@font-face{font-family:"Kuibu Serif";src:url("${f[1]}") format("woff2");font-weight:${f[0]};font-display:block}`);
  return faces.length ? faces.join("\n") : "";
}

const FONT_CSS = fontFaceCss();
if (FONT_CSS) console.log("预览已注入篇名宋体（out/serif-*.woff2）—— 真机走 wx.loadFontFace");

fs.writeFileSync(path.join(__dirname, "out", "preview.html"),
  `<!doctype html><html><head><meta charset="utf-8"><style>${SHELL_CSS}</style><style>${FONT_CSS}</style></head><body>${html.join("\n")}</body></html>`);
console.log("写出 " + html.length + " 屏 → scripts/shots/out/preview.html");
