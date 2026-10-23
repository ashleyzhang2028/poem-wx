const theme = require("../../../utils/theme");
const tabbar = require("../../../utils/tabbar");
const pay = require("../../../utils/pay");
const auth = require("../../../utils/auth");

function view(o) {
  return {
    outTradeNo: o.outTradeNo,
    title: pay.tierName(o.plan) + " · " + pay.periodName(o.period),
    price: pay.yuan(o.priceCents),
    statusTone: pay.statusTone(o.status),
    statusText: pay.statusName(o.status),
    timeText: pay.timeText(o.paidAt || o.createdAt),
    untilText: o.planUntilAfter ? pay.dateText(o.planUntilAfter) : "",
    wxOrderId: o.wxOrderId
  };
}

Page({
  data: {
    themeStyle: "",
    barBelow: true,
    logged: false,
    loaded: false,
    failed: false,
    list: []
  },

  onShow() {
    theme.apply(this);
    this.setData({ barBelow: tabbar.below(this), logged: auth.logged() });
    if (auth.logged()) this.load();
  },

  load() {
    pay.reconcile().then(() => pay.orders()).then(
      (orders) => this.setData({ list: orders.map(view), loaded: true, failed: false }),
      () => this.setData({ loaded: true, failed: true })
    );
  },

  onCopy(e) {
    const id = e.currentTarget.dataset.id;
    if (id) wx.setClipboardData({ data: id });
  },

  onPricing() {
    wx.navigateTo({ url: "/packages/mine/pricing/pricing" });
  }
});
