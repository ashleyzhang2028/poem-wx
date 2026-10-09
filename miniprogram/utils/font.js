/**
 * 篇名宋体：系统找不到时，外挂一份子集。
 *
 * 为什么要有这个文件
 * ----------------
 * 「古诗词标题一律用宋体」这件事，在本机是靠 --font-poem 那一串系统字名
 * 去命中的（iOS 的 Songti SC、Windows 的 SimSun、Android 各 ROM 的
 * 思源宋体……）。多数机器够了，但有两类机器不行：
 *
 *   1. 定制 ROM 把这些字名改掉了，整串一个都命中不上；
 *   2. WebView 版本老，通用族 serif 也落不到中文字形上。
 * 这两种情况的表现是**静默退回黑体** —— 用户看得到「不像宋体」，
 * 我们却收不到任何信号。所以这里补一层外挂。
 *
 * 为什么只做「篇名子集」
 * --------------------
 * 一整套中文宋体（NotoSerifSC）woff2 有 3MB，主包只剩不到 400KB，
 * **塞不下**。而篇名与作者名加起来只有 3074 个不同的字（全站 5599 篇
 * 统计出来的），子集化之后 1.2MB —— 还是塞不进而外挂本来就是要走网络。
 *
 * 所以口径是：
 *   - **先系统**：--font-poem 里那一串系统字名（Songti SC / SimSun / 思源宋体…）
 *   - **后外挂**：整串都没命中时，拉一份篇名子集，注册成 "Kuibu Serif"
 *
 * ⚠️ "Kuibu Serif" 在字体链里排**第一位**（见 styles/tokens.wxss）。
 * 这样排不矛盾：CSS 找不到这个 family 时自动往下一个名字走，
 * 所以「注册了但没下载成功」不会让任何字变成豆腐块 —— 只是退回系统的宋体。
 * 反过来若排在链尾，一次没下载成功就永远轮不上它，外挂就白写了。
 *
 * 命中判定做不到精确（loadFontFace 只报「下载成没成」，不报「系统有没有」），
 * 所以策略是**不判、直接注册**，让回退链自己决定。代价是：
 * 系统本来就有宋体的机器会多下载一次 —— 但只有没配 CDN 时才完全不做，
 * 因为那时它必然失败。
 *
 * 与「能力不可用就不显示」那条口径一致：没配 fontUrl 就整个不发起，
 * 不留一个「加载中」的假状态。
 */
const store = require("./store");

/** 注册名。CSS 里 --font-poem 的第一个名字，改这里要同步改令牌 */
const FAMILY = "Kuibu Serif";

/** 一次会话只试一次：字体加载失败再试也不会成，反复重试只会白耗流量 */
let tried = false;

/**
 * 取外挂字体的地址。
 *
 * 现在返回空字符串 —— 正文分片虽然已经走腾讯云 COS + CDN，
 * 但**字体文件还没传上去**，也没有备案好的域名（见 docs/todo.md）。
 * 空串的语义是「这条通道没就绪」，不是「加载失败了」：
 * 前者一笔不发起，后者会留下一个半截的字体名。
 *
 * 要启用：把子集 woff2 传到与正文分片同一个 CDN，在这里填上 https 地址，
 * 并把该域名加进微信公众平台的「downloadFile 合法域名」（wx.loadFontFace
 * 走的是这个白名单，不是 request 那条）。scripts/font-subset.js 负责生成子集。
 */
function url() {
  const auth = store.read(store.KEYS.auth, {}) || {};
  return String(auth.fontUrl || "");
}

/**
 * 就绪判据。**同步返回**，与 utils/speech.js 的 readiness() 同一形状 ——
 * 界面要在渲染那一刻就知道该不该等它。
 */
function readiness() {
  const u = url();
  if (!u) {
    return { visible: false, usable: false, state: "unsupported", reason: "未配置篇名子集字体" };
  }
  return { visible: true, usable: true, state: "ready", reason: "" };
}

/**
 * 注册篇名宋体。**失败一律吞掉** —— 这是观感增强，不是功能，
 * 加载不到就退回系统宋体，用户不该因此看到任何提示。
 *
 * @returns {Promise<boolean>} 是否注册成功（仅用于日志，界面不依赖它）
 */
function load() {
  const r = readiness();
  if (!r.usable || tried) return Promise.resolve(false);
  tried = true;

  // 开发者工具与部分基础库没有 loadFontFace，没有就安静地跳过
  if (typeof wx.loadFontFace !== "function") return Promise.resolve(false);

  return new Promise((resolve) => {
    wx.loadFontFace({
      family: FAMILY,
      source: 'url("' + url() + '")',
      // 全局生效：所有页面共用一份，不必每页各注册一次
      global: true,
      scopes: ["webview"],
      success: () => resolve(true),
      // 失败不提示：系统宋体仍在，界面上看不出差别就说明它确实不必存在
      fail: () => resolve(false)
    });
  });
}

module.exports = { FAMILY, readiness, load, url };
