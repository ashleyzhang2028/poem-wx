const theme = require("../../../utils/theme");
const tabbar = require("../../../utils/tabbar");
const pay = require("../../../utils/pay");
const auth = require("../../../utils/auth");
const icons = require("../../../utils/icons");
const tabPage = require("../../../utils/tab-page");

const FEATURE_SHOWN = 6;

const TAGLINES = {
  free: "先用起来",
  pro: "每天背得更稳",
  max: "考试与飞花令全开"
};

const INCLUDES = {
  free: "",
  pro: "包含 Free 的全部功能",
  max: "包含 Pro 的全部功能"
};

const PROMISES = [
  "微信支付，支付成功立即生效",
  "一次性购买，到期不会自动扣费",
  "提前续订在原到期日后顺延，不损失天数"
];

function actionOf(plan, tier) {
  if (tier === plan) return { text: "续订 " + pay.tierName(plan), disabled: false };
  if (tier === "max") return { text: "已是 Max", disabled: true };
  if (plan === "max" && tier === "pro") return { text: "升级到 Max", disabled: false };
  return { text: "开通 " + pay.tierName(plan), disabled: false };
}

function saveText(prices) {
  const cell = prices && prices.pro;
  if (!cell || !cell.month || !cell.year) return "";
  const pct = Math.round((1 - cell.year.priceCents / (cell.month.priceCents * 12)) * 100);
  return pct > 0 ? "省 " + pct + "%" : "";
}

function perMonthText(cell) {
  const v = cell.priceCents / 12 / 100;
  return "折合每月 ¥" + Math.round(v * 10) / 10;
}

Page({
  data: {
    themeStyle: "",
    barBelow: true,
    logged: false,
    tier: "free",
    untilText: "",
    period: "month",
    periods: [],
    prices: null,
    plans: [],
    promises: PROMISES,
    yes: icons.yes,
    welcome: null,
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
    const badge = saveText(prices);
    const periods = pay.PERIODS.map((p) => ({
      key: p.key,
      name: p.name,
      badge: p.key === "year" ? badge : ""
    }));
    const recommended = tier === "free" ? "pro" : tier;

    const plans = ["free", "pro", "max"].map((key) => {
      const paid = key !== "free";
      const cell = paid && prices && prices[key] && prices[key][period];
      const act = paid ? actionOf(key, tier) : { text: "", disabled: true };
      const all = pay.newFeatures(key);
      return {
        key: key,
        name: pay.tierName(key),
        tagline: TAGLINES[key],
        priceText: paid ? (cell ? pay.yuan(cell.priceCents) : "—") : "0",
        unit: paid ? pay.periodUnit(period) : "",
        originalText: cell && cell.originalCents ? "¥" + pay.yuan(cell.originalCents) : "",
        perMonth: cell && period === "year" ? perMonthText(cell) : "",
        includes: INCLUDES[key],
        features: all.slice(0, FEATURE_SHOWN),
        more: Math.max(0, all.length - FEATURE_SHOWN),
        current: tier === key,
        recommended: paid && recommended === key,
        actionText: act.text,
        disabled: act.disabled || (paid && !cell)
      };
    });
    this.setData({ periods: periods, plans: plans });
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
        this.celebrate(plan, res.order);
      } else {
        wx.showModal({ title: "没有完成支付", content: res.reason, showCancel: false });
      }
      this.load();
    });
  },

  celebrate(plan, order) {
    const until = order && order.planUntilAfter ? "，至 " + pay.dateText(order.planUntilAfter) : "";
    const unlocked = pay.newFeatures(plan).slice(0, 3).join("、");
    this.setData({
      welcome: {
        tier: plan,
        title: "欢迎加入 " + pay.tierName(plan),
        sub: "已开通" + until + "。现在可以用：" + unlocked + " 等"
      }
    });
    wx.vibrateShort({ type: "light", fail() {} });
    wx.pageScrollTo({ scrollTop: 0, duration: 250 });
  },

  onLogin() {
    tabPage.mine();
  },

  onOrders() {
    wx.navigateTo({ url: "/packages/mine/orders/orders" });
  }
});
