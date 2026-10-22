const cols = require("../../utils/collections");
const corpus = require("../../utils/corpus");

Component({
  options: {
    addGlobalClass: true
  },

  data: {
    themeStyle: "",
    open: false,
    poemId: "",
    title: "",
    rows: [],
    itemsMax: cols.ITEMS_MAX,
    total: 0,
    cap: 0
  },

  methods: {
    ask(id) {
      if (!id) return;
      const meta = corpus.indexById(id);
      this.paint(id, (meta && meta.t) || "");
      this.setData({ open: true });
    },

    paint(id, title) {
      const list = cols.list().map((c) => ({
        id: c.id,
        name: cols.nameOf(c),
        count: c.items.length,
        has: cols.idsOf(c).indexOf(id) >= 0
      }));
      this.setData({
        poemId: id,
        title: title === undefined ? this.data.title : title,
        rows: list,
        total: list.length,
        cap: cols.capOf()
      });
    },

    close() {
      this.setData({ open: false });
    },

    onMask() {
      this.close();
    },

    onStop() {},

    onPick(e) {
      const id = e.currentTarget.dataset.id;
      const name = e.currentTarget.dataset.name;
      this.addTo(id, name);
    },

    addTo(collectionId, name) {
      const r = cols.add(collectionId, [this.data.poemId]);
      if (r.code === "E_FULL") {
        wx.showToast({ title: "该集合已达 " + cols.ITEMS_MAX + " 首上限", icon: "none" });
        return;
      }
      if (r.code === "E_DUP") {
        wx.showToast({ title: "「" + name + "」中已有本篇", icon: "none" });
        this.close();
        return;
      }
      this.close();
      this.triggerEvent("done", { id: this.data.poemId, collectionId: collectionId, name: name });
    }
  }
});
