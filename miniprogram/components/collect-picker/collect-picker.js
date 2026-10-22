const cols = require("../../utils/collections");
const corpus = require("../../utils/corpus");
const entitlement = require("../../utils/entitlement");

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
    creating: false,
    draft: "",
    itemsMax: cols.ITEMS_MAX,
    total: 0,
    cap: 0,
    tier: "pro",
    full: false
  },

  methods: {
    ask(id) {
      if (!id) return;
      const meta = corpus.indexById(id);
      this.paint(id, (meta && meta.t) || "");
      this.setData({ open: true });
    },

    paint(id, title, creating, draft) {
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
        cap: cols.capOf(),
        tier: entitlement.tierOf("collections"),
        full: list.length >= cols.capOf(),
        creating: !!creating,
        draft: draft === undefined ? "" : draft
      });
    },

    close() {
      this.setData({ open: false, creating: false, draft: "" });
    },

    onMask() {
      this.close();
    },

    onStop() {},

    onStartCreate() {
      if (!entitlement.block("collections", { page: this, loginPrompt: false })) return;
      if (cols.capOf() <= cols.list().length) {
        wx.showToast({ title: "最多 " + cols.capOf() + " 个集合，先删一个", icon: "none" });
        return;
      }
      this.setData({ creating: true, draft: "" });
    },

    onDraft(e) {
      this.setData({ draft: e.detail.value });
    },

    onSubmitCreate() {
      if (!entitlement.block("collections", { page: this, loginPrompt: false })) return;
      const r = cols.create(this.data.draft);
      if (!r.ok) {
        if (r.code === "E_LIMIT") {
          wx.showToast({ title: "最多 " + cols.capOf() + " 个集合，先删一个", icon: "none" });
        }
        return;
      }
      this.addTo(r.collection.id, r.collection.name);
      this.setData({ creating: false, draft: "" });
    },

    onTierGate() {
      entitlement.openTierPage();
    },

    onPick(e) {
      const id = e.currentTarget.dataset.id;
      const name = e.currentTarget.dataset.name;
      this.addTo(id, name);
    },

    addTo(collectionId, name) {
      const r = cols.add(collectionId, [this.data.poemId]);
      if (r.code === "E_FULL") {
        wx.showToast({ title: "这个集合已经 " + cols.ITEMS_MAX + " 首了", icon: "none" });
        return;
      }
      if (r.code === "E_DUP") {
        wx.showToast({ title: "「" + name + "」里已经有这首", icon: "none" });
        this.close();
        return;
      }
      this.close();
      this.triggerEvent("done", { id: this.data.poemId, collectionId: collectionId, name: name });
    }
  }
});
