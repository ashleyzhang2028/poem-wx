const theme = require("../../../utils/theme");
const font = require("../../../utils/font");
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
    wxOrderId: o.wxOrderId,
    pending: o.status === "pending",
    removable: o.status === "pending" || o.status === "canceled"
  };
}

Page({
  data: {
    themeStyle: "",
    name: "",
    barBelow: true,
    logged: false,
    plan: null,
    loaded: false,
    failed: false,
    busy: false,
    list: []
  },

  onShow() {
    this.applyFont();
    theme.apply(this);
    this.setData({ barBelow: tabbar.below(this), logged: auth.logged() });
    if (auth.logged()) this.load();
  },

  applyFont() {
    const hit = font.bind(theme.style());
    this.setData({ themeStyle: hit.page.themeStyle });
    font.registerHere().catch(() => {});
  },

  load() {
    pay.catalog().then((res) => {
      const plan = (res && res.plan) || {};
      const days = plan.until ? Math.ceil((plan.until - Date.now()) / 86400000) : 0;
      this.setData({
        plan: {
          name: pay.tierName(plan.tier || "free"),
          paid: plan.tier !== "free",
          untilText: plan.until ? pay.dateText(plan.until) : "",
          forever: plan.tier !== "free" && !plan.until,
          days: days
        }
      });
    }, () => {});
    pay.reconcile().then(() => pay.orders()).then(
      (orders) => this.setData({ list: orders.map(view), loaded: true, failed: false }),
      () => this.setData({ loaded: true, failed: true })
    );
  },

  onCopy(e) {
    const id = e.currentTarget.dataset.id;
    if (id) wx.setClipboardData({ data: id });
  },

  onResume(e) {
    this.run("正在拉起支付", (id) => pay.resume(id).then((res) => {
      if (!res.ok) wx.showModal({ title: "没有完成支付", content: res.reason, showCancel: false });
      return res;
    }), e);
  },

  onCancel(e) {
    this.confirmThen("取消订单", "取消后这笔订单不能再支付。", "cancel", e);
  },

  onRemove(e) {
    this.confirmThen("删除订单", "删除后这笔订单不再显示。", "delete", e);
  },

  confirmThen(title, content, op, e) {
    wx.showModal({
      title: title,
      content: content,
      success: (r) => {
        if (r.confirm) this.run(title, (id) => pay.manage(op, id), e);
      }
    });
  },

  run(loading, action, e) {
    const id = e.currentTarget.dataset.id;
    if (!id || this.data.busy) return;
    this.setData({ busy: true });
    wx.showLoading({ title: loading, mask: true });
    action(id).then((res) => {
      wx.hideLoading();
      this.setData({ busy: false });
      if (!res.ok && res.reason) wx.showToast({ title: res.reason, icon: "none" });
      this.load();
    });
  },

  onPricing() {
    wx.navigateTo({ url: "/packages/mine/pricing/pricing" });
  }
});
