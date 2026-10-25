const cols = require("../../utils/collections");
const corpus = require("../../utils/corpus");
const entitlement = require("../../utils/entitlement");
const theme = require("../../utils/theme");

const TOAST_MS = 2000;

Component({
  options: {
    addGlobalClass: true
  },

  data: {
    themeStyle: "",
    name: "",
    open: false,
    poemId: "",
    title: "",
    rows: [],
    itemsMax: cols.ITEMS_MAX,
    total: 0,
    cap: 0
  },

  attached() {
    this.setData({ name: theme.name() });
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
        meta: c.items.length + " 首 / " + cols.ITEMS_MAX + " 首",
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

    show(title) {
      wx.showToast({ title: title, icon: "none", duration: TOAST_MS });
    },

    onMask() {
      this.close();
    },

    onStop() {},

    onPick(e) {
      if (!this.data.total) {
        this.load(() => this.onNew());
        return;
      }
      this.addTo(e.currentTarget.dataset.id, e.currentTarget.dataset.name);
    },

    load(job) {
      if (!entitlement.block("collections", { page: this, loginPrompt: true })) return;
      this.paint(this.data.poemId);
      if (job) job();
    },

    addTo(collectionId, name) {
      const r = cols.add(collectionId, [this.data.poemId]);
      if (r.code === "E_FULL") {
        this.show("该集合已达 " + cols.ITEMS_MAX + " 首上限");
        return;
      }
      if (r.code === "E_DUP") {
        this.show("「" + name + "」中已有本篇");
        return;
      }
      this.close();
      this.triggerEvent("done", { id: this.data.poemId, collectionId: collectionId, name: name });
    },

    onNew() {
      if (!entitlement.block("collections", { page: this, loginPrompt: true })) return;
      if (!this.data.total) {
        this.load(() => this.onNew());
        return;
      }
      if (!this.data.cap || this.data.total >= this.data.cap) {
        this.show(cols.quotaNote());
        return;
      }
      wx.showModal({
        title: "新建集合",
        editable: true,
        placeholderText: cols.DEFAULT_NAME,
        confirmText: "新建",
        cancelText: "取消",
        success: (res) => {
          if (!res.confirm) return;
          const made = cols.create(res.content);
          if (!made.ok) {
            this.show(cols.quotaNote());
            return;
          }
          this.addTo(made.collection.id, cols.nameOf(made.collection));
        }
      });
    }
  }
});
