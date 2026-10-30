const source = require("../../../utils/poem-source");
const gate = require("../../../utils/gate");
const theme = require("../../../utils/theme");
const font = require("../../../utils/font");
const tabbar = require("../../../utils/tabbar");

const NO_BIO = ["", "佚名", "无名氏"];

function paragraphsOf(text) {
  return String(text || "")
    .split(/\r?\n+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

Page({
  data: {
    themeStyle: "",
    name: "",
    barBelow: true,
    locked: false,
    who: "",
    dynasty: "",
    paras: [],
    state: "loading"
  },

  onLoad(query) {
    this.who = decodeURIComponent((query && query.name) || "");
    this.authorId = (query && query.id) || "";
    this.setData({ who: this.who });
  },

  applyFont() {
    const hit = font.bind(theme.style());
    this.setData({ themeStyle: hit.page.themeStyle });
    font.registerHere().catch(() => {});
  },

  onShow() {
    this.applyFont();
    this.setData({ barBelow: tabbar.below(this) });
    if (!gate.logged()) {
      this.setData({ locked: true });
      return;
    }
    this.setData({ locked: false });
    if (this.data.state !== "ready") this.load();
  },

  idOf() {
    if (this.authorId) return Promise.resolve(this.authorId);
    return source.poems({ author: this.who, page_size: 1 }).then((r) => {
      const a = r.items[0] && r.items[0].author;
      if (!a || a.id === undefined) throw new Error("没有找到这位作者");
      return String(a.id);
    });
  },

  load() {
    if (NO_BIO.indexOf(this.who) >= 0) {
      this.setData({ state: "empty" });
      return;
    }
    const token = (this.token = (this.token || 0) + 1);
    this.setData({ state: "loading" });
    this.idOf()
      .then((id) => source.author(id))
      .then((a) => {
        if (token !== this.token) return;
        const paras = paragraphsOf(a && a.description);
        this.setData({
          dynasty: String((a && a.dynasty) || ""),
          paras: paras,
          state: paras.length ? "ready" : "empty"
        });
      })
      .catch(() => {
        if (token !== this.token) return;
        this.setData({ state: "failed" });
      });
  },

  onWorks() {
    const pages = getCurrentPages();
    const before = pages[pages.length - 2];
    if (before && before.route === "packages/authors/index/index" && before.data.author === this.who) {
      wx.navigateBack();
      return;
    }
    wx.navigateTo({ url: "/packages/authors/index/index?author=" + encodeURIComponent(this.who) });
  },

  onRetry() {
    this.load();
  }
});
