const store = require("../../utils/store");
const corpus = require("../../utils/corpus");
const entitlement = require("../../utils/entitlement");
const icons = require("../../utils/icons");

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
    icons: { add: icons.add, added: icons.added }
  },

  attached() {
    this.refresh();
  },

  methods: {

    refresh() {
      if (this.data.keyword) this.paint(this.data.keyword);
    },

    onInput(e) {
      this.setData({ keyword: e.detail.value }, () => this.paint(e.detail.value));
    },

    onSearch(kw) {
      const keyword = kw === undefined ? this.data.keyword : kw;
      this.setData({ keyword: keyword }, () => this.paint(keyword));
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
      if (r.code === "E_TIER") entitlement.gateTier("extra", { page: this });
      else if (r.msg) wx.showToast({ title: r.msg, icon: "none" });
      if (r.ok === false) return;
      this.afterChange();
    },

    onTierGate() {
      entitlement.openTierPage();
    },

    onOpen(e) {
      wx.navigateTo({ url: "/pages/reader/reader?id=" + encodeURIComponent(e.currentTarget.dataset.id) + "&mode=browse" });
    },

    toggle(id) {
      if (!id) return { ok: false, msg: "" };
      const r = store.toggleDailyExtra(id);
      if (!r.ok) return { ok: false, on: false, code: r.code, msg: this.msgOf(r.code) };
      return { ok: true, on: r.on, msg: r.on ? "已加入今日加背" : "已移出今日加背" };
    },

    msgOf(code) {
      if (code === "E_TIER") return "";
      if (code === "E_LIMIT") {
        return "今日已加背 " + store.DAILY_EXTRA_MAX + " 首，请先背完再添加";
      }
      if (code === "E_STORAGE") return "添加失败：本机存储空间不足或未开启存储";
      return "添加失败";
    },

    afterChange() {
      this.refresh();
      this.triggerEvent("change", { count: store.dailyExtra().length });
    }
  }
});
