const theme = require("../../../utils/theme");
const tabbar = require("../../../utils/tabbar");
const admin = require("../../../utils/admin");
const pay = require("../../../utils/pay");

const STATUS_TABS = [
  { key: "paid", name: "已支付" },
  { key: "pending", name: "待支付" },
  { key: "refunded", name: "已退款" }
];

const SEARCH_DELAY = 350;

function nameOf(key) {
  const hit = STATUS_TABS.filter((t) => t.key === key)[0];
  return hit ? hit.name : STATUS_TABS[0].name;
}

function orderView(o) {
  return {
    outTradeNo: o.outTradeNo,
    head: pay.tierName(o.plan) + " " + pay.periodName(o.period) + " · ¥" + pay.yuan(o.priceCents),
    statusTone: pay.statusTone(o.status),
    statusText: pay.statusName(o.status) + (o.status === "paid" && !o.applied ? "（未发货）" : ""),
    uid: o.uid,
    openid: o.openid,
    productId: o.productId,
    wxOrderId: o.wxOrderId,
    source: o.source,
    createdText: pay.timeText(o.createdAt),
    paidText: pay.timeText(o.paidAt),
    untilText: pay.dateText(o.planUntilAfter),
    refundedText: pay.timeText(o.refundedAt)
  };
}

function copyText(o) {
  return [
    pay.tierName(o.plan) + " " + pay.periodName(o.period) + " · ¥" + pay.yuan(o.priceCents),
    "状态 " + pay.statusName(o.status),
    "uid " + o.uid,
    "openid " + o.openid,
    "业务单号 " + o.outTradeNo,
    o.wxOrderId ? "支付单号 " + o.wxOrderId : "",
    "道具 " + o.productId,
    "下单 " + pay.timeText(o.createdAt)
  ].filter((line) => !!line).join("\n");
}

Page({
  data: {
    themeStyle: "",
    barBelow: true,
    canWrite: false,
    reason: "",
    status: "paid",
    name: "已支付",
    statusTabs: STATUS_TABS,
    q: "",
    page: 1,
    pages: 1,
    loaded: false,
    list: [],
    raw: [],
    summary: null,
    matched: { count: 0, paid: 0, paidText: "0" }
  },

  onLoad(query) {
    const status = query && query.status;
    this.setData({ status: nameOf(status) === status ? status : "paid", name: nameOf(status) });
  },

  onShow() {
    theme.apply(this);
    this.setData({ barBelow: tabbar.below(this), canWrite: admin.canWrite() });
    if (admin.canWrite()) this.load();
  },

  onUnload() {
    if (this.timer) clearTimeout(this.timer);
  },

  load() {
    pay.adminOrders({ status: this.data.status, q: this.data.q, page: this.data.page }).then((res) => {
      if (!res.ok) {
        this.setData({ reason: res.reason, loaded: true });
        return;
      }
      this.setData({
        reason: "",
        loaded: true,
        page: res.page,
        pages: res.pages,
        list: res.orders.map(orderView),
        raw: res.orders,
        summary: res.summary,
        matched: pay.adminCount(res.matched)
      });
    });
  },

  reset(patch) {
    this.setData(Object.assign({ page: 1 }, patch));
    this.load();
  },

  onStatus(e) {
    const status = e.detail.value;
    this.reset({ status: status, name: nameOf(status) });
  },

  onSearch(e) {
    const q = String(e.detail.value || "").trim();
    this.setData({ q: q });
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.load(), SEARCH_DELAY);
  },

  onSearchNow() {
    if (this.timer) clearTimeout(this.timer);
    this.reset({});
  },

  onPage(e) {
    const next = this.data.page + Number(e.currentTarget.dataset.delta);
    if (next < 1 || next > this.data.pages) return;
    this.setData({ page: next });
    this.load();
    wx.pageScrollTo({ scrollTop: 0, duration: 200 });
  },

  onCopyAll(e) {
    const row = this.data.raw[Number(e.currentTarget.dataset.index)];
    if (row) wx.setClipboardData({ data: copyText(row) });
  }
});
