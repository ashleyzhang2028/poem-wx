const marks = require("../../utils/bookmarks");
const lastRead = require("../../utils/last-read");
const theme = require("../../utils/theme");
const font = require("../../utils/font");

function markRow(b, lastId) {
  return {
    id: b.id,
    title: b.t,
    meta: [b.a, b.n].filter(Boolean).join(" · "),
    last: b.id === lastId,
    marked: true,
    p: b.p,
    y: b.y
  };
}

function lastRow(hit) {
  return {
    id: hit.id,
    title: hit.t,
    meta: [hit.a, hit.n].filter(Boolean).join(" · "),
    last: true,
    marked: false,
    p: hit.p,
    y: hit.y
  };
}

function rowsOf(list, last) {
  const lastId = last ? last.id : "";
  const rows = list.map((b) => markRow(b, lastId));
  if (!last) return rows;
  if (lastId && rows.some((r) => r.id === lastId)) return rows;
  return [lastRow(last)].concat(rows);
}

Component({
  options: {
    addGlobalClass: true
  },

  data: {
    open: false,
    name: "",
    themeStyle: "",
    rows: [],
    markCount: 0
  },

  attached() {
    this.setData({ name: theme.name(), themeStyle: font.bind(theme.style()).page.themeStyle });
  },

  methods: {
    open() {
      const list = marks.list();
      this.setData({
        open: true,
        rows: rowsOf(list, lastRead.get()),
        markCount: list.length
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

    onOpen(e) {
      if (e.currentTarget.dataset.last === true) {
        const hit = lastRead.get();
        if (hit) this.follow(marks.readerUrl(hit));
        return;
      }
      const hit = this.data.rows.filter((b) => b.id === e.currentTarget.dataset.id)[0];
      if (hit) this.follow(marks.readerUrl(hit));
    },

    onOpenAll() {
      this.follow("/packages/settings/bookmarks/bookmarks");
    }
  }
});
