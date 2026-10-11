"use strict";
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { compile, setImageIntrinsic } = require("./wxml.js");
const ROOT = path.join(__dirname, "..", "..", "miniprogram");

const THEME = process.env.THEME || "";

const MEM = {};
global.wx = {
  getStorageSync: (k) => (k in MEM ? MEM[k] : ""),
  setStorageSync: (k, v) => { MEM[k] = v; },
  removeStorageSync: (k) => { delete MEM[k]; },
  getStorageInfoSync: () => ({ keys: Object.keys(MEM), currentSize: 0, limitSize: 10240 })
};

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

    getAppBaseInfo: () => ({ SDKVersion: "3.5.0", language: "zh_CN", fontSizeScaleFactor: 1 }),
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

      page.selectComponent = function (sel) {

        if (sel === "#extra") {
          const mod = path.join(ROOT, "components/daily-extra/daily-extra.js");
          let opt = null;
          const savedComp = global.Component;
          global.Component = (o) => { opt = o; };
          delete require.cache[require.resolve(mod)];
          require(mod);
          global.Component = savedComp;
          if (!opt) return null;
          const comp = Object.assign({}, opt.methods);
          comp.data = JSON.parse(JSON.stringify(opt.data || {}));

          comp.setData = function (obj, cb) {
            Object.keys(obj).forEach((k) => { this.data[k] = obj[k]; });
            if (typeof cb === "function") cb.call(this);
          };
          comp.triggerEvent = function () {};
          return comp;
        }
        if (sel !== "#sheet") return null;
        const self = this;
        return {
          open(queue, id) {
            const list = Array.isArray(queue) ? queue : [];
            const idx = Math.max(0, list.findIndex((it) => it && it.id === id));
            self.data.sheetOpen = true;
            self.data.sheetIndex = idx;
          },
          onClose() { self.data.sheetOpen = false; }
        };
      };
      ["onLoad", "onShow"].forEach((fn) => { if (typeof page[fn] === "function") page[fn].call(page, query || {}); });
      CURRENT = page;
      return page.data;
    },

    current() { return CURRENT; },
    done() { Object.assign(global, { Page: saved.Page, Component: saved.Component, getApp: saved.getApp, getCurrentPages: saved.getCurrentPages }); }
  };
}

const PAGE_TITLES = JSON.parse(fs.readFileSync(path.join(__dirname, "pages.json"), "utf8"));

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

  + flattenCss(path.join(ROOT, "components/recite-sheet/recite-sheet.wxss"))

  + flattenCss(path.join(ROOT, "components/daily-extra/daily-extra.wxss"))

  + flattenCss(path.join(ROOT, "custom-tab-bar/index.wxss"));

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
.n-image{border-radius:50%;background:#f2f2f4}
/* WXML 标签 → HTML div 之后，默认块级；但页面样式里的 display:flex
   要能压过它，所以这里用最低优先级的选择器 */
/* 文本节点没有自己的盒子，行高靠父级给 —— 预览里补一条，
   否则纯文本与 flex 子项的行高对不上 */
[data-tag]{line-height:inherit}
`;

const SHELL_CSS = `
*{box-sizing:border-box;margin:0;padding:0}
body{background:#e8e6e1;font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;padding:24px;display:flex;flex-wrap:wrap;gap:20px}
.device{width:390px;background:#f5f5f7;border-radius:38px;box-shadow:0 10px 40px rgba(0,0,0,.18);overflow:hidden;border:8px solid #1b1b1d;position:relative}
/* 浮层（弹层 / 遮罩 / 自绘底栏）在真机上都是 position:fixed，而在预览里
   一个 .device 只是页面流里的一张「手机壳」—— fixed 会以**浏览器视口**为参照，
   于是首页那张弹层会盖到旁边每一屏上（截图里所有屏都蒙了一层灰）。
   所以把 .device 变成 fixed 的包含块。
   ⚠️ 用 transform 而不是 contain:paint —— transform 一定会建包含块，
   而 contain 在各版本浏览器上的行为不一致，预览的尺子不能靠它。 */
.device{transform:translateZ(0)}
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

function screenCss(cfg, pageCss) {
  const raw = TOKENS + APP_CSS + COMP_CSS + NATIVE_CSS + pageCss

    + "\n.screen{--layout-w:100%;}";

  const scoped = raw.replace(/(?<![\w.-])page\s*\{/g, ".screen{");
  return rpx2px(scoped);
}

const DEVICE_FONT_SIZE = ".device{font-size:16px}";

function expandComponents(node, data, P) { return node; }

function tabBarHtml(active, themeStyle) {
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

  return `<div class="tabbar" style="${themeStyle || ""}">${items}</div>`;
}

function themeStyleOf(data) {
  return (data && data.themeStyle) || "";
}

function expandReciteSheet(wxml, data) {
  if (wxml.indexOf("<recite-sheet") < 0) return wxml;
  const comp = fs.readFileSync(path.join(ROOT, "components/recite-sheet/recite-sheet.wxml"), "utf8");

  const merged = Object.assign({}, data, {

    dailyOn: !!data.sheetDailyOn,
    open: !!data.sheetOpen,
    index: data.sheetIndex || 0,
    total: (data.plan || []).length,
    navText: ((data.sheetIndex || 0) + 1) + " / " + ((data.plan || []).length || 1),
    queue: data.plan || [],
    master: (data.sheetMastery === undefined ? 0 : data.sheetMastery),
    hint: data.sheetHint || "",
    align: "center",
    fontSize: 0,
    fontMin: -2,
    fontMax: 4,
    aligns: [{ key: "left", label: "左对齐" }, { key: "center", label: "居中" }],
    pinyinModes: [{ key: "off", label: "不注音" }, { key: "rare", label: "生字" }, { key: "all", label: "全文" }],
    pinyinMode: "off",
    pinyinOn: false,
    results: [
      { key: "bad", label: "忘记", cls: "bad" },
      { key: "fuzzy", label: "模糊", cls: "fuzzy" },
      { key: "good", label: "记住", cls: "good" }
    ],
    themeHex: data.themeHex || "",
    themeStyle: data.themeStyle || ""
  });

  const cur = pickSheetPoem(data);
  Object.keys(cur).forEach((k) => { merged[k] = cur[k]; });
  Object.keys(merged).forEach((k) => { data[k] = merged[k]; });
  return wxml.replace(/<recite-sheet[^>]*\/>/g, comp);
}

function pickSheetPoem(data) {
  return {
    title: "咏鹅",
    author: "骆宾王",
    dynasty: "唐",
    source: "课内诗词",
    stage: "新学",
    hasTranslation: true,
    showTranslation: false,
    translation: "",
    translationSource: "",
    paras: [[["鹅，鹅，鹅，"], ["曲项向天歌。"]], [["白毛浮绿水，"], ["红掌拨清波。"]]],
    tokens: []
  };
}

function expandDailyExtra(wxml, data) {
  if (wxml.indexOf("<daily-extra") < 0) return wxml;
  const comp = fs.readFileSync(path.join(ROOT, "components/daily-extra/daily-extra.wxml"), "utf8");
  const merged = Object.assign({}, data, {
    keyword: data.extraKeyword || "",
    searched: !!data.extraRows && !!data.extraRows.length,
    rows: data.extraRows || [],
    count: data.extraCount || 0,
    max: 20,
    themeStyle: data.themeStyle || ""
  });
  Object.keys(merged).forEach((k) => { data[k] = merged[k]; });
  return wxml.replace(/<daily-extra[^>]*\/>/g, comp);
}

function imageIntrinsicResolver(pageCss) {
  const appCss = flattenCss(path.join(ROOT, "app.wxss"));
  const ruleOf = (css, cls) => {
    const m = new RegExp("\\." + cls.replace(/[-]/g, "\\-") + "\\s*\\{([^}]*)\\}").exec(css);
    return m ? m[1] : "";
  };
  return (cls) => cls.split(/\s+/).filter(Boolean).some((c) => {
    const body = ruleOf(pageCss, c) || ruleOf(appCss, c);
    return /[^-]height\s*:\s*[\d.]+%\s*;/.test(body);
  });
}

function pageHtml(cfg, data) {
  const wxmlPath = path.join(ROOT, cfg.page + ".wxml");
  let wxml = fs.readFileSync(wxmlPath, "utf8");

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

    const cond = attrs["wx:if"] ? ` wx:if="${attrs["wx:if"]}"` : "";

    return `<view${cond} class="card lock-card"><text class="lock-mark">${mark}</text><text class="lock-title">${title}</text>`
      + (note ? `<text class="lock-note">${note}</text>` : "")
      + `<button class="btn primary block lock-btn">微信登录</button></view>`;
  });
  wxml = wxml.replace(/<skeleton\b([^>]*)\/>/g, (_, a) => {
    const rows = /rows\s*=\s*"(\d+)"/.exec(a);
    const n = rows ? Number(rows[1]) : 3;
    const cond = /wx:if\s*=\s*"([^"]*)"/.exec(a);

    const guard = cond ? ` wx:if="${cond[1]}"` : "";
    let s = `<view${guard} class="sk"><view class="sk-block sk-line w60"></view><view class="sk-block sk-line w40"></view><view class="sk-block sk-btn"></view>`;
    for (let i = 0; i < n; i++) s += '<view class="sk-block sk-line w80"></view>';
    return s + "</view>";
  });
  wxml = expandDailyExtra(wxml, data);
  wxml = expandReciteSheet(wxml, data);
  const pageCss = flattenCss(path.join(ROOT, cfg.page + ".wxss"));

  setImageIntrinsic(imageIntrinsicResolver(pageCss));
  const body = compile(wxml, data);
  const screenCssStr = screenCss(cfg, pageCss);
  return `<div class="device" data-screen="${cfg.key}">
  <div class="navbar">${cfg.back ? '<span class="back">‹</span>' : ""}${cfg.title}${cfg.menu ? '<span class="menu"><i></i><i></i><i></i></span>' : ""}</div>
  <div class="screen"><style>${screenCssStr}</style>${body}</div>
  <div class="caption">${cfg.key}</div>
  ${cfg.tab ? tabBarHtml(cfg.tab, themeStyleOf(data)) : ""}
  </div>`;
}

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

    if (cfg.settings) storeMod.saveSettings(cfg.settings); else storeMod.saveSettings({});

    const screenTheme = (cfg.settings && cfg.settings.theme) || THEME;
    storeMod.saveSettings({ theme: screenTheme });

    if (cfg.dailyExtra) storeMod.setDailyExtra(cfg.dailyExtra);
    else storeMod.clearDailyExtra();

    if (cfg.syncedAt) storeMod.saveSettings({ lastSyncAt: cfg.syncedAt });
    else storeMod.saveSettings({ lastSyncAt: 0 });

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
  `<!doctype html><html><head><meta charset="utf-8"><style>${SHELL_CSS}</style><style>${DEVICE_FONT_SIZE}</style><style>${FONT_CSS}</style></head><body>${html.join("\n")}</body></html>`);
console.log("写出 " + html.length + " 屏 → scripts/shots/out/preview.html");
