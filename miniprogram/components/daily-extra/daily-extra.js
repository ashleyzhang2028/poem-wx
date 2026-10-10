const store = require("../../utils/store");
const corpus = require("../../utils/corpus");

const SUGGEST_MAX = 8;

Component({
  options: {

    addGlobalClass: true
  },

  properties: {

    themeStyle: { type: String, value: "" }
  },

  data: {
    keyword: "",
    searched: false,
    rows: [],
    count: 0,

    max: store.DAILY_EXTRA_MAX
  },

  attached() {
    this.refresh();
  },

  methods: {

    refresh() {
      this.setData({ count: store.dailyExtra().length, max: store.DAILY_EXTRA_MAX });
      if (this.data.keyword) this.paint(this.data.keyword);
    },

    onInput(e) {
      this.setData({ keyword: e.detail.value }, () => this.paint(e.detail.value));
    },

    onSearch() {
      this.paint(this.data.keyword);
    },

    onClear() {
      this.setData({ keyword: "", searched: false, rows: [] });
    },

    paint(kw) {
      const keyword = String(kw || "").trim();
      if (!keyword) {
        this.setData({ rows: [], searched: false });
        return;
      }
      const r = corpus.search(keyword, { limit: SUGGEST_MAX });
      this.setData({ rows: this.decorate(r.items), searched: true });
    },

    decorate(items) {
      const have = {};
      store.dailyExtra().forEach((id) => {
        have[id] = true;
      });
      return (items || []).map((p) => ({
        id: p.id,
        title: p.t,
        author: p.a,
        dynasty: p.d,
        bookName: p.n,
        on: !!have[p.id]
      }));
    },

    onToggle(e) {
      const id = e.currentTarget.dataset.id;
      const r = this.toggle(id);
      if (r.msg) wx.showToast({ title: r.msg, icon: "none" });
      if (r.ok === false) return;
      this.afterChange();
    },

    onOpen(e) {
      wx.navigateTo({ url: "/pages/reader/reader?id=" + encodeURIComponent(e.currentTarget.dataset.id) });
    },

    toggle(id) {
      if (!id) return { ok: false, msg: "" };
      const r = store.toggleDailyExtra(id);
      if (!r.ok) return { ok: false, on: false, msg: this.msgOf(r.code) };
      return { ok: true, on: r.on, msg: r.on ? "已加入今日背诵" : "已移出今日背诵" };
    },

    msgOf(code) {
      if (code === "E_LIMIT") {
        return "今天已经加了 " + store.DAILY_EXTRA_MAX + " 首，够多了 —— 先背完再加";
      }
      if (code === "E_STORAGE") return "加不进去：这台手机存不下（空间不足或未开启存储）";
      return "加不进去";
    },

    afterChange() {
      this.refresh();
      this.triggerEvent("change", { count: store.dailyExtra().length });
    }
  }
});
