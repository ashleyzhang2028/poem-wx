const marks = require("../../utils/bookmarks");
const lastRead = require("../../utils/last-read");
const theme = require("../../utils/theme");

function markRow(b) {
  return { id: b.id, title: b.t, meta: [b.a, b.n].filter(Boolean).join(" · ") };
}

function lastRow() {
  const hit = lastRead.get();
  if (!hit) return null;
  return { id: hit.id, title: hit.t, meta: [hit.a, hit.n].filter(Boolean).join(" · ") };
}

Component({
  options: {
    addGlobalClass: true
  },

  data: {
    open: false,
    name: "",
    themeStyle: "",
    last: null,
    marks: [],
    markCount: 0
  },

  attached() {
    this.setData({
      name: theme.name(),
      themeStyle: theme.style().page.themeStyle
    });
  },

  methods: {
    open() {
      const rows = marks.list();
      this.setData({
        open: true,
        last: lastRow(),
        marks: rows.map(markRow),
        markCount: rows.length
      });
      this.triggerEvent("opened");
    },

    close() {
      if (!this.data.open) return;
      this.setData({ open: false });
      this.triggerEvent("closed");
    },

    onMask() {
      this.close();
    },

    onStop() {},

    follow(url) {
      if (!url) return;
      this.close();
      wx.navigateTo({ url: url });
    },

    onContinue() {
      const hit = lastRead.get();
      if (hit) this.follow(marks.readerUrl(hit));
    },

    onOpenMark(e) {
      const hit = marks.list().filter((b) => b.id === e.currentTarget.dataset.id)[0];
      if (hit) this.follow(marks.readerUrl(hit));
    },

    onOpenAll() {
      this.follow("/packages/settings/bookmarks/bookmarks");
    }
  }
});
