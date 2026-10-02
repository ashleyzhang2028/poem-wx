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
      return page.data;
    },
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
  + flattenCss(path.join(ROOT, "components/skeleton/skeleton.wxss"));

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
.n-radio,.n-checkbox{width:23px;height:23px;border-radius:50%;border:1px solid #d6c8ad;background:#fff;display:inline-flex;align-items:center;justify-content:center;font-size:13px;color:#fff;flex:none}
.n-checkbox{border-radius:4px}
.n-radio.on{border-color:#2f6055;border-width:7px}
.n-checkbox.on{background:#2f6055;border-color:#2f6055}
.n-radio.dis,.n-checkbox.dis{opacity:.5}
/* 页面样式表里凡按**标签名**写的规则，这里按 class 补一份等价项。
   少补一条，预览就会比真机好看一点 —— 而问题恰好藏在那一丁点里。 */
.native-label .n-radio,.native-label .n-checkbox,
.pref-item .n-radio,.pref-item .n-checkbox,
.opt-row .n-radio,.opt-row .n-checkbox{margin-right:var(--sp-2)}
.native-group.grid .native-label .n-radio,.native-group.grid .native-label .n-checkbox{margin-right:var(--sp-1)}
.opt-row .n-radio,.opt-row .n-checkbox{flex:none;align-self:flex-start;margin-top:2rpx;transform:scale(.86);transform-origin:left top}
.opt-row.active .n-radio,.opt-row.active .n-checkbox{margin-left:6rpx}
.pref-item .n-radio,.pref-item .n-checkbox{transform:scale(.8)}
.char .n-radio{position:absolute;right:2rpx;top:2rpx;transform:scale(.56);transform-origin:right top;margin-right:0}
.n-switch{width:51px;height:31px;border-radius:31px;background:#e5e5e5;position:relative;flex:none}
.n-switch.on{background:#2f6055}
.n-switch-k{position:absolute;top:2px;left:2px;width:27px;height:27px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.2);transition:left .2s}
.n-switch.on .n-switch-k{left:22px}
.n-slider{position:relative;height:28px;display:flex;align-items:center;width:100%}
.n-slider::before{content:"";position:absolute;left:0;right:0;height:4px;border-radius:2px;background:#ece3d2}
.n-slider-fill{position:absolute;left:0;height:4px;border-radius:2px;background:#2f6055}
.n-slider-knob{position:absolute;width:20px;height:20px;border-radius:50%;background:#fff;border:1px solid #e0d8c8;box-shadow:0 1px 4px rgba(0,0,0,.18);transform:translateX(-50%)}
.n-ph{color:#b3a795}
.n-input{display:flex;align-items:center;font-size:14px;color:#241d18;min-height:22px;width:100%}
.n-image{width:56px;height:56px;border-radius:50%;background:#e6efe9}
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
.device{width:390px;background:#f6f1e3;border-radius:38px;box-shadow:0 10px 40px rgba(0,0,0,.18);overflow:hidden;border:8px solid #1b1b1d;position:relative}
.navbar{background:#2f6055;color:#fff;height:64px;display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:500;letter-spacing:1px;position:relative}
.navbar .back{position:absolute;left:14px;font-size:22px;opacity:.9}
.navbar .menu{position:absolute;right:12px;top:8px;width:78px;height:28px;border-radius:14px;border:1px solid rgba(255,255,255,.35);display:flex;align-items:center;justify-content:space-around;opacity:.6}
.navbar .menu i{width:4px;height:4px;border-radius:50%;background:#fff;display:block}
.screen{height:760px;overflow-y:auto;overflow-x:hidden}
.tabbar{height:52px;background:#fcfaf3;border-top:1px solid #ece3d2;display:flex;align-items:center;font-size:11px;color:#8a7a68}
.tabbar div{flex:1;text-align:center}
.tabbar .on{color:#2f6055;font-weight:600}
.caption{font-size:12px;color:#5a5a5a;text-align:center;margin-top:8px}
`;

/** page{} 那套变量与底色，得挂到 .screen 上才生效 */
function screenCss(cfg, pageCss) {
  const raw = TOKENS + APP_CSS + COMP_CSS + NATIVE_CSS + pageCss;
  // page{} 是小程序的根选择器，预览里对应 .screen
  const scoped = raw.replace(/\bpage\s*\{/g, ".screen{");
  return rpx2px(scoped);
}

function expandComponents(node, data, P) { return node; }

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
  return `<div class="device">
  <div class="navbar">${cfg.back ? '<span class="back">‹</span>' : ""}${cfg.title}${cfg.menu ? '<span class="menu"><i></i><i></i><i></i></span>' : ""}</div>
  <div class="screen"><style>${screenCssStr}</style>${body}</div>
  ${cfg.tab ? `<div class="tabbar">${["背诵", "课外", "搜索", "我的"].map((t, i) => `<div class="${i === cfg.tab - 1 ? "on" : ""}">${t}</div>`).join("")}</div>` : ""}
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
  cases.push(cfg);
});

const html = [];
cases.forEach((cfg) => {
  try {
    saveProfile(cfg.saveProfile || { logged: !!cfg.logged, nickname: cfg.logged ? "张敏" : "", avatarUrl: "" });
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
    html.push(pageHtml(cfg, data));
  } catch (e) {
    console.log("✗ " + cfg.page + " —— " + e.message);
  }
});
rt.done();

fs.writeFileSync(path.join(__dirname, "out", "preview.html"),
  `<!doctype html><html><head><meta charset="utf-8"><style>${SHELL_CSS}</style></head><body>${html.join("\n")}</body></html>`);
console.log("写出 " + html.length + " 屏 → scripts/shots/out/preview.html");
