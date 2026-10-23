const entitlement = require("../../utils/entitlement");
const icons = require("../../utils/icons");
const view = require("../../utils/tier-view");
const pay = require("../../utils/pay");

function noteOf(snap) {
  if (!snap.logged) return "未登录，暂按 Free";
  if (snap.blocked === "unsigned") return "连不上服务器，暂按 Free";
  if (snap.blocked === "cloud") return "未接上同步服务器";
  return "";
}

Component({
  options: {
    addGlobalClass: true
  },

  data: {
    status: {},
    note: "",
    heads: [],
    logged: false,
    paid: false,
    expiry: null,
    compareRows: [],
    stats: { caps: 0, enabled: 0, percent: 0 }
  },

  attached() {
    this.refresh();
  },

  pageLifetimes: {
    show() {
      this.refresh();
    }
  },

  methods: {
    onPricing() {
      wx.navigateTo({ url: "/packages/mine/pricing/pricing" });
    },

    onOrders() {
      wx.navigateTo({ url: "/packages/mine/orders/orders" });
    },

    refresh() {
      const snap = entitlement.snapshot();
      const sums = entitlement.compareSummary();
      const heads = entitlement.compareCols(snap).map((c, i) => ({
        tier: c.tier,
        label: c.label,
        now: c.now,
        on: sums[i].on,
        total: sums[i].total
      }));

      const rows = entitlement.compareRows(snap)
        .map((r) => ({
          cap: r.cap,
          name: r.name,
          cells: r.cells.map((c) => Object.assign({}, c, {
            icon: c.on ? icons.yes : icons.no,
            cls: c.on ? (c.now ? "yes-now" : "yes") : "no"
          }))
        }));

      this.setData({
        logged: snap.logged,
        paid: snap.logged && snap.tier !== "free",
        status: snap,
        note: noteOf(snap),
        heads: heads,
        compareRows: rows,
        stats: view.stats()
      });

      if (snap.logged) pay.expiry().then((e) => this.setData({ expiry: pay.expiryText(e) }));
    }
  }
});
