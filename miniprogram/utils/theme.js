/**
 * 主题色。
 *
 * 这一层只做一件事：把「主色叫什么」从一个常量，变成一个可以读写的设置。
 *
 * 为什么只需改一处：全站的「墨」本来就是**一个**令牌 —— `--ink`。
 * 按钮、选中态、列表主标题、底栏当前项、统计大数字，全都取它。
 * 所以主题色不是「给按钮和标题分别上色」，是**换掉那一支墨**。
 * 页面样式表里至今没有一处写死颜色（check.js V6 守着），
 * 这条路才走得通。
 *
 * 为什么不能只改 CSS：小程序里 `page { --ink: … }` 是静态的，
 * JS 改不了根选择器上的变量。所以做法是**页面根节点挂内联 style**：
 *     <view class="page" style="{{themeStyle}}">
 * 内联变量会盖过 page{} 里的那一份，子树里所有 var(--ink) 跟着变。
 * apply(page) 收口这件事，26 个页面各调一次。
 */

const store = require("./store");

/**
 * 九种中华传统色。
 *
 * `on` 是「压在这个色上的字色」。这一栏非有不可 —— 朱红、明黄、
 * 月白这几个的明度差得很远，一律压白字会让明黄/月白上的字看不清。
 * 判据是相对亮度：亮色配深字，暗色配白字。
 *
 * `deep` 是「比它再深一档」，只给按钮按下态用（原来那是 --ink-strong）。
 * 深色系自己就是那一档，所以多数直接取本色。
 */
const THEMES = [
  // text 是「当文字用」的那一档。深色主题它就是本色；
  // 明黄 / 月白 / 藕荷 这几个太亮，本色压在白底上根本读不出来
  // （月白对白底 1.23:1），所以另给一个同色系压深的版本，全部过 4.5:1。
  // 底色（按钮、选中块）仍用本色 —— 换个底色好看，换行字看不清。
  { key: "ink",    name: "墨",   hex: "#1C1C1E", deep: "#000000", on: "#FFFFFF", text: "#1C1C1E" },
  { key: "zhuhong", name: "朱红", hex: "#FF4C00", deep: "#D63F00", on: "#FFFFFF", text: "#C93A00" },
  { key: "minghuang", name: "明黄", hex: "#FAD069", deep: "#E8B93F", on: "#3D2E00", text: "#8A6B00" },
  { key: "tianqing", name: "天青", hex: "#228FBD", deep: "#1B769C", on: "#FFFFFF", text: "#1A7397" },
  { key: "yuebai", name: "月白", hex: "#D6ECF0", deep: "#B3D8E0", on: "#1C3A44", text: "#3A6B78" },
  { key: "yanzhi", name: "胭脂", hex: "#9D2933", deep: "#82212A", on: "#FFFFFF", text: "#9D2933" },
  { key: "zhuqing", name: "竹青", hex: "#789262", deep: "#637A51", on: "#FFFFFF", text: "#5E7649" },
  { key: "xuanse", name: "玄色", hex: "#622A1D", deep: "#4E2117", on: "#FFFFFF", text: "#622A1D" },
  { key: "yaqing", name: "鸦青", hex: "#424C50", deep: "#333B3E", on: "#FFFFFF", text: "#424C50" },
  { key: "ouhe",   name: "藕荷", hex: "#E4C6D0", deep: "#D2AEBB", on: "#4A2A35", text: "#9B5F73" }
];

/** 默认那一支墨 —— 与 tokens.wxss 里 --theme 的默认值必须一致（V27 守着） */
const DEFAULT = "ink";

const BY_KEY = {};
THEMES.forEach((t) => { BY_KEY[t.key] = t; });

function all() {
  return THEMES;
}

function get(key) {
  return BY_KEY[key] || BY_KEY[DEFAULT];
}

/** 本机当前主题（没设过或设了个不认识的，都回默认） */
function current() {
  const key = store.settings().theme;
  return BY_KEY[key] ? key : DEFAULT;
}

function currentTheme() {
  return get(current());
}

/**
 * 页面根节点那一行 style。
 *
 * 四个变量一起给：主色、按下更深的一档、压在主色上的字、淡一档的软色
 * （给标签底这类用）。只覆盖这四个，别的不动 ——
 * 页底、卡片、线依旧是中性灰，主题色不该漫到那些地方去。
 */
function style(key) {
  const t = get(key || current());
  // on 是 #RRGGBB，拆成 rgba 再压透明度 —— 不用 color-mix，
  // 低版本基础库不认它，而这一层不能有「新版才好看」的赌注。
  const on = t.on.replace("#", "");
  const soft = "rgba(" + parseInt(on.slice(0, 2), 16) + "," +
    parseInt(on.slice(2, 4), 16) + "," + parseInt(on.slice(4, 6), 16) + ",.7)";

  // ⚠️ 这里覆盖的是**最终使用的那四个变量**（--strong / --ink-strong /
  // --on-ink / --on-ink-soft），不是那个中间层 --theme。
  //
  // 为什么必须这样 —— 踩过一次：
  // 一开始只覆盖 --theme，指望 tokens 里的 `--strong: var(--theme)` 转一手。
  // 结果**内联覆盖不生效**：CSS 变量在「定义它的那个元素」上求值，
  // 而 tokens 把 --strong 定义在页面根（`page{}`）上、那儿 --theme 是默认的墨，
  // 于是 --strong 早就取成了墨黑再往下继承 —— 子元素改 --theme 已经晚了。
  // 直接给这四个，继承下来的就是换过之后的值，没有中间层可求错。
  return "--theme:" + t.hex + ";--theme-deep:" + t.deep +
    ";--on-theme:" + t.on + ";--on-theme-soft:" + soft +
    ";--strong:" + t.hex + ";--strong-text:" + t.text + ";--ink-strong:" + t.deep +
    ";--on-ink:" + t.on + ";--on-ink-soft:" + soft;
}

/** 选一个主题并落盘，返回它。页面调完自己 setData 重渲染 */
function set(key) {
  if (!BY_KEY[key]) return currentTheme();
  store.saveSettings({ theme: key });
  return get(key);
}

/**
 * 页面在 onShow / onLoad 里调一次：拿当前主题、算出 style、写进 data。
 * 页面 data 里不用自己声明 themeStyle —— 这里一次性塞进去，
 * 少一个「忘了加字段就全白」的坑。
 */
function apply(page) {
  const key = current();
  // themeHex 是给**原生控件**用的：<radio color> / <switch color> /
  // <slider activeColor> 取不到 WXSS 的 var()，只能从 WXML 给一个字面量，
  // 所以除了 CSS 变量，页面 data 里还要备一份色的十六进制。
  page.setData({ theme: key, themeStyle: style(key), themeHex: get(key).hex });
  return key;
}

module.exports = { THEMES, DEFAULT, all, get, current, currentTheme, style, set, apply };
