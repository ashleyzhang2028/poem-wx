const theme = require("../../../utils/theme");
const font = require("../../../utils/font");
const tabbar = require("../../../utils/tabbar");
const admin = require("../../../utils/admin");
const pay = require("../../../utils/pay");

const PLAN_CHOICES = ["pro", "max"];
const PERIOD_CHOICES = pay.PERIODS.map((p) => p.key);
const SLOTS = [].concat(...PLAN_CHOICES.map((plan) => PERIOD_CHOICES.map((period) => ({ plan, period }))));

function slotKey(s) {
  return s.plan + "." + s.period;
}

function slotViews(catalog) {
  return SLOTS.map((s) => {
    const options = catalog.products.filter((p) => p.plan === s.plan && p.period === s.period);
    const activeId = catalog.active[slotKey(s)];
    const active = options.filter((p) => p.productId === activeId)[0];
    return {
      key: slotKey(s),
      title: pay.tierName(s.plan) + " " + pay.periodName(s.period),
      activeText: active ? active.productId + " · ¥" + pay.yuan(active.priceCents) : "未设置",
      labels: options.map((p) => p.productId + " · ¥" + pay.yuan(p.priceCents)),
      ids: options.map((p) => p.productId)
    };
  });
}

const STATUS_ROWS = [
  { key: "paid", name: "已支付" },
  { key: "pending", name: "待支付" },
  { key: "refunded", name: "已退款" }
];

function statusViews(summary) {
  return STATUS_ROWS.map((row) => Object.assign({}, row, {
    count: summary[row.key],
    text: summary[row.key + "Text"]
  }));
}

Page({
  data: {
    themeStyle: "",
    name: "",
    barBelow: true,
    canWrite: false,
    reason: "",
    catalog: null,
    slots: [],
    summary: null,
    statusRows: [],
    draft: { productId: "", planIndex: 0, periodIndex: 0, price: "" },
    planChoices: PLAN_CHOICES,
    periodChoices: PERIOD_CHOICES
  },

  applyFont() {
    const hit = font.bind(theme.style());
    this.setData({ themeStyle: hit.page.themeStyle });
  },

  onShow() {
    this.applyFont();
    this.setData({ barBelow: tabbar.below(this), canWrite: admin.canWrite() });
    if (admin.canWrite()) this.load();
  },

  load() {
    pay.adminCatalog().then((res) => {
      if (!res.ok) {
        this.setData({ reason: res.reason });
        return;
      }
      this.setData({ catalog: res.catalog, slots: slotViews(res.catalog), reason: "" });
    });
    this.loadSummary();
  },

  loadSummary() {
    pay.adminOrders({ size: 1 }).then((res) => {
      if (!res.ok) {
        this.setData({ reason: res.reason });
        return;
      }
      const summary = pay.adminCount(res.summary);
      this.setData({ summary: summary, statusRows: statusViews(summary) });
    });
  },

  onStatus(e) {
    wx.navigateTo({ url: "/packages/admin/pay-orders/pay-orders?status=" + e.currentTarget.dataset.key });
  },

  save(next) {
    pay.adminSaveCatalog(next).then((res) => {
      if (!res.ok) {
        wx.showToast({ title: res.reason, icon: "none" });
        return;
      }
      this.setData({ catalog: res.catalog, slots: slotViews(res.catalog) });
      wx.showToast({ title: "已保存", icon: "success" });
    });
  },

  onPickActive(e) {
    const slot = this.data.slots[e.currentTarget.dataset.index];
    const picked = slot.ids[Number(e.detail.value)];
    if (!picked) return;
    const active = Object.assign({}, this.data.catalog.active);
    active[slot.key] = picked;
    this.save({ products: this.data.catalog.products, active: active });
  },

  onDraft(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ ["draft." + field]: e.detail.value });
  },

  onAddProduct() {
    const d = this.data.draft;
    const priceCents = Math.round(Number(d.price) * 100);
    if (!d.productId || !(priceCents > 0)) {
      wx.showToast({ title: "道具 ID 和价格要填", icon: "none" });
      return;
    }
    const products = this.data.catalog.products.concat([{
      productId: String(d.productId).trim(),
      plan: PLAN_CHOICES[Number(d.planIndex)],
      period: PERIOD_CHOICES[Number(d.periodIndex)],
      priceCents: priceCents
    }]);
    this.save({ products: products, active: this.data.catalog.active });
    this.setData({ draft: { productId: "", planIndex: 0, periodIndex: 0, price: "" } });
  },

  onCopy(e) {
    const text = e.currentTarget.dataset.text;
    if (text) wx.setClipboardData({ data: text });
  }
});
