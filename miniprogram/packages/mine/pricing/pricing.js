const theme = require("../../../utils/theme");
const tabbar = require("../../../utils/tabbar");
const pay = require("../../../utils/pay");
const auth = require("../../../utils/auth");
const tabPage = require("../../../utils/tab-page");

function actionOf(plan, tier) {
  if (tier === plan) return { text: "续订 " + pay.tierName(plan), disabled: false };
  if (tier === "max") return { text: "已是 Max", disabled: true };
  if (plan === "max" && tier === "pro") return { text: "升级到 Max", disabled: false };
  return { text: "开通 " + pay.tierName(plan), disabled: false };
}

Page({
  data: {
    themeStyle: "",
    barBelow: true,
    logged: false,
    tier: "free",
    untilText: "",
    period: "month",
    periods: pay.PERIODS,
    prices: null,
    plans: [],
    busy: false,
    loadFailed: false
  },

  onShow() {
    theme.apply(this);
    this.setData({ barBelow: tabbar.below(this) });
    this.load();
  },

  load() {
    const logged = auth.logged();
    this.setData({ logged: logged });
    if (!logged) return;
    pay.catalog().then(
      (res) => {
        const plan = (res && res.plan) || {};
        this.setData({
          prices: res.plans,
          tier: plan.tier || "free",
          untilText: plan.tier !== "free" && plan.until ? pay.dateText(plan.until) : "",
          loadFailed: false
        });
        this.paint();
      },
      () => {
        this.setData({ loadFailed: true });
        this.paint();
      }
    );
  },

  paint() {
    const { prices, period, tier } = this.data;
    const unit = pay.periodUnit(period);
    const plans = [{
      key: "free",
      name: "Free",
      priceText: "0",
      unit: "",
      originalText: "",
      features: pay.newFeatures("free"),
      current: tier === "free",
      actionText: "",
      disabled: true
    }];
    pay.PAID_TIERS.forEach((key) => {
      const cell = prices && prices[key] && prices[key][period];
      const act = actionOf(key, tier);
      plans.push({
        key: key,
        name: pay.tierName(key),
        priceText: cell ? pay.yuan(cell.priceCents) : "",
        unit: unit,
        originalText: cell && cell.originalCents ? pay.yuan(cell.originalCents) : "",
        features: pay.newFeatures(key),
        current: tier === key,
        actionText: act.text,
        disabled: act.disabled || !cell
      });
    });
    this.setData({ plans: plans });
  },

  onPeriod(e) {
    this.setData({ period: e.detail.value });
    this.paint();
  },

  onBuy(e) {
    if (this.data.busy) return;
    const plan = e.currentTarget.dataset.plan;
    this.setData({ busy: true });
    wx.showLoading({ title: "正在下单", mask: true });
    pay.buy(plan, this.data.period).then((res) => {
      wx.hideLoading();
      this.setData({ busy: false });
      if (res.ok) {
        wx.showToast({ title: "已开通", icon: "success" });
      } else {
        wx.showModal({ title: "没有完成支付", content: res.reason, showCancel: false });
      }
      this.load();
    });
  },

  onLogin() {
    tabPage.mine();
  },

  onOrders() {
    wx.navigateTo({ url: "/packages/mine/orders/orders" });
  }
});
