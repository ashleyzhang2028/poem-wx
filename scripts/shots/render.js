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

/* 预览用哪个主题色。
   Issue #26 里用户说「选个天青色看看页面效果」—— 主题是运行时设置，
   预览得能换着看，所以给一个环境变量入口：
     THEME=tianqing node scripts/shots/render.js
   不设就是默认那支墨，观感与平时一致。 */
const THEME = process.env.THEME || "";

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
    /* 页面根字号：预览把 rpx 折成 rem，而 rem 的根字号在真机上来自
       wx.getAppBaseInfo().fontSizeScaleFactor（微信跟随系统的「字体大小」）。
       不接这一段它就是个空值 —— 页面根字号落回默认，所有 rpx 都小一档半，
       「一行多宽、字距多少」跟着错。真机上它是个常数，预览也得是个常数。 */
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
      /* 组件：预览认不得自定义组件的运行时，所以 selectComponent 给一个
         **最小替身** —— 它只回答「这一页确实拿到了那个组件」，
         再把 open() 记进 page.data.sheetOpen，供 expandReciteSheet() 摆开。
         真机走的仍是组件自己那一份；这里只是让截图能拍到那张卡。 */
      page.selectComponent = function (sel) {
        /* 「今日加背」那张卡：给它一个**真会算的**替身 —— 它调的是真组件
           那一份 onInput / paint，所以预览里的建议列表与真机同源。
           （recite-sheet 那个替身不一样：弹层只需要「摆不摆开」，版式
           由 pickSheetPoem() 现拼一句诗，不必真跑组件。） */
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
          // 回调要真调：组件里 onInput 是「setData(keyword, () => paint())」，
          // 吞掉回调，那一屏就是「搜了没反应」—— 而截图里看不出是替身的错
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
  // 背诵弹层是首页那张浮层，样式同样要进预览 —— 漏了它，截图里就只剩一屏
  // 「点了没反应」的列表，而这一轮改的恰好就是它
  + flattenCss(path.join(ROOT, "components/recite-sheet/recite-sheet.wxss"))
  // 首页那张「今日加背」卡同样是组件，漏了它就是一条没样式的搜索框
  + flattenCss(path.join(ROOT, "components/daily-extra/daily-extra.wxss"))
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

/* 预览里那条「已知的继承字号」。
   它不是设计值：page{} 里定了字号令牌、页面样式表也各自给自己的字号，
   真正靠**继承**的只有 `.poem-clause`（字在 .tk-ch 上）。而它一旦继承到
   浏览器/系统给的字号（这一台是 18.72px），量字号、量字距读到的就是
   一台机器一个数 —— 曾经差点把 18.72px 当成一条规格写进样式表。
   挂在机壳那一层，页面样式表谁也压不到它。 */
const DEVICE_FONT_SIZE = ".device{font-size:16px}";

function expandComponents(node, data, P) { return node; }

/**
 * 底栏预览：照 custom-tab-bar/index.wxml 的**结构**生成同一份标记。
 *
 * 这里刻意手写而不是去解析组件 wxml —— 组件里的图标是 CSS 画的
 * （.tab-ico-book 这些类来自 custom-tab-bar/index.wxss，已并进 COMP_CSS），
 * 只要类名对得上，形状就是真的。V 组断言守着两边类名一致。
 */
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
  // 真机上底栏组件自己在 attached/setActive 里读主题（见 custom-tab-bar/index.js）。
  // 预览这一份是照结构手写的，所以主题也得手写传进来 —— 少传一次，
  // 截图里底栏就永远是墨黑，「换了主题底栏跟不跟」这件事看不见。
  return `<div class="tabbar" style="${themeStyle || ""}">${items}</div>`;
}

/** 页面 data 里那份主题内联样式（theme.js 的 apply 塞进去的），预览底栏照抄一份 */
function themeStyleOf(data) {
  return (data && data.themeStyle) || "";
}

/**
 * 把 <recite-sheet> 展开成组件自己的 WXML。
 *
 * 预览的编译器不认自定义组件（README「它不是什么」第 2 条），而这一轮
 * 改的恰好是首页那张弹层 —— 不展开，截图里就只有一屏「点了没反应」的列表。
 *
 * 展开时要带三样：
 *   1. 组件自己的 data（`sheet` 在下面现算一份），与页面 data 合成一个作用域
 *   2. queue 这个 property 绑的是页面 data 里的 plan —— 组件读它
 *   3. wx:if="{{open}}" 那一层要能按 `do` 里调的 openSheet 决定显不显
 *
 * ⚠️ 这里刻意**不**模拟组件的完整生命周期：预览只回答「长什么样」，
 * 所以它把组件最外层那个 wx:if 直接按「要不要摆开」写死，内部字段照抄
 * recite-sheet.js 的 data 默认值。改组件 data 时这一份不会自动跟 ——
 * 但真机看到的是组件自己那一份，截图只是看一眼版式。
 */
function expandReciteSheet(wxml, data) {
  if (wxml.indexOf("<recite-sheet") < 0) return wxml;
  const comp = fs.readFileSync(path.join(ROOT, "components/recite-sheet/recite-sheet.wxml"), "utf8");
  // 组件的作用域：页面 data 之上压一层组件自己的字段
  const merged = Object.assign({}, data, {
    // 组件里这一格来自 store（首页那一份 data 里没有它）——
    // 不给默认值，弹层里那枚加背按钮就会画成一个**空圆圈**：
    // 图还在、位置也对，只有字没了，看着像「按钮做坏了」。
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
  // 组件自己的字段名与页面撞车时（title / author / id…），组件那一份优先 ——
  // 弹层里排的是「当前这一首」，页面 data 里那一份是首页自己的
  const cur = pickSheetPoem(data);
  Object.keys(cur).forEach((k) => { merged[k] = cur[k]; });
  Object.keys(merged).forEach((k) => { data[k] = merged[k]; });
  return wxml.replace(/<recite-sheet[^>]*\/>/g, comp);
}

/** 预览里弹层排哪一首。
 *
 * 刻意**不**去跑组件的 loadCurrent()：那需要一套组件运行时，而这一份
 * 替身只回答「版式对不对」。所以正文用一个固定的四行绝句 ——
 * `paras` 的**形状必须是真的**：`[[行, 行], …]`，行是「句」的数组。
 * 形状错了（比如少一层）预览会静默什么都不渲染，看着像「正文没做」。
 */
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

/**
 * 展开「今日加背」那张卡。
 *
 * 与 recite-sheet 同一个理由：预览的编译器不认自定义组件，不展开的话
 * 首页上只剩一张写着「今日加背」的空卡 —— 而这一轮改的就是它。
 *
 * 组件自己的字段（keyword / rows / count / searched）现算一份：
 * `rows` **按页面 data 里那份 `extraRows` 取**（预览里没有组件运行时，
 * 真实的搜索结果是页面那一步 do 调出来的，见 home.js 的 onExtraInput）。
 * 没给就按空列表画 —— 空列表是首页的常态（还没搜），不是异常。
 */
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
    /* 这里手抄了一份组件结构 —— 抄错就会「预览里有、真机没有」。
       上一版凭空多拼了一行 <text class="lock-foot">不积跬步…</text>，
       真机组件里从来没有这个元素，于是门禁卡的间距在预览里看着挤成一团
       （Issue #49 走查时差点当 bug 报）。现在与 components/lock-card/lock-card.wxml
       逐元素对齐：mark / title / note（有才出）/ 按钮。
       check.js V32 有一条守着两边的元素清单一致。 */
    return `<view${cond} class="card lock-card"><text class="lock-mark">${mark}</text><text class="lock-title">${title}</text>`
      + (note ? `<text class="lock-note">${note}</text>` : "")
      + `<button class="btn primary block lock-btn">微信登录</button></view>`;
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
  wxml = expandDailyExtra(wxml, data);
  wxml = expandReciteSheet(wxml, data);
  const body = compile(wxml, data);
  const pageCss = flattenCss(path.join(ROOT, cfg.page + ".wxss"));
  const screenCssStr = screenCss(cfg, pageCss);
  return `<div class="device" data-screen="${cfg.key}">
  <div class="navbar">${cfg.back ? '<span class="back">‹</span>' : ""}${cfg.title}${cfg.menu ? '<span class="menu"><i></i><i></i><i></i></span>' : ""}</div>
  <div class="screen"><style>${screenCssStr}</style>${body}</div>
  <div class="caption">${cfg.key}</div>
  ${cfg.tab ? tabBarHtml(cfg.tab, themeStyleOf(data)) : ""}
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
    /* 预览主题，**两处来源，屏幕自己那份优先**：
       · pages.json 里某一屏写了 settings.theme（例如 home-tianqing）—— 那一屏就那个色
       · THEME 环境变量是**没写 theme 的那些屏**的默认值
       踩过的一个坑：原来这里是无条件 `if (THEME) saveSettings({theme: THEME})`，
       于是只要外面带上 THEME，pages.json 里那几屏**各自指定的主题全被盖掉** ——
       `THEME=zhuhong node render.js` 之后，home-minghuang 那屏其实画的是朱红。
       图还照样出得来、caption 也写着 minghuang，只有颜色是错的 ——
       这种「图在、名字对、内容是别的」比没有图更糟，所以这里按屏判一次。 */
    const screenTheme = (cfg.settings && cfg.settings.theme) || THEME;
    storeMod.saveSettings({ theme: screenTheme });
    /* 今日加背：预览要能拍到「已经加了几首」的样子（首页那张卡的读数、
       设置页的管理列表）。别的屏一律清空 —— 不清的话，上一屏加的几首
       会漏到下一屏的今日安排里，而那张图的 caption 还写着自己那个名字。 */
    if (cfg.dailyExtra) storeMod.setDailyExtra(cfg.dailyExtra);
    else storeMod.clearDailyExtra();
    /* 同步状态：预览里没有网，所以「已经同步过」这件事得显式摆进去 ——
       靠 data 里那个 lastSyncAt。不清的话，上一屏同步过的状态会漏到下一屏。 */
    if (cfg.syncedAt) storeMod.saveSettings({ lastSyncAt: cfg.syncedAt });
    else storeMod.saveSettings({ lastSyncAt: 0 });
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
  `<!doctype html><html><head><meta charset="utf-8"><style>${SHELL_CSS}</style><style>${DEVICE_FONT_SIZE}</style><style>${FONT_CSS}</style></head><body>${html.join("\n")}</body></html>`);
console.log("写出 " + html.length + " 屏 → scripts/shots/out/preview.html");
