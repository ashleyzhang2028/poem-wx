const theme = require("../../../utils/theme");
const tabbar = require("../../../utils/tabbar");
const pay = require("../../../utils/pay");
const auth = require("../../../utils/auth");
const icons = require("../../../utils/icons");
const tabPage = require("../../../utils/tab-page");

const FEATURE_SHOWN = 6;

const TAGLINES = {
  pro: "每天背得更稳",
  max: "考试与飞花令全开"
};

const INCLUDES = {
  pro: "包含 Free 的全部功能",
  max: "包含 Pro 的全部功能"
};

const PROMISES = [
  "微信支付，支付成功立即生效",
  "按天数一次性购买，到期不会自动扣费",
  "提前续订在原到期日后顺延，不损失天数"
];

function actionOf(plan, tier) {
  if (tier === plan) return { text: "订阅 " + pay.tierName(plan), disabled: false };
  if (tier === "max") return { text: "已是 Max", disabled: true };
  if (plan === "max" && tier === "pro") return { text: "升级到 Max", disabled: false };
  return { text: "开通 " + pay.tierName(plan), disabled: false };
}

function saveText(cells, p) {
  if (!cells || !cells.d30 || !cells[p.key] || p.days === 30) return "";
  const pct = Math.round((1 - cells[p.key].priceCents / (cells.d30.priceCents * p.days / 30)) * 100);
  return pct > 0 ? "省 " + pct + "%" : "";
}

Page({
  data: {
    themeStyle: "",
    barBelow: true,
    logged: false,
    tier: "free",
    untilText: "",
    tab: "pro",
    tabs: [],
    period: "d90",
    prices: null,
    shown: {},
    promises: PROMISES,
    yes: icons.yes,
    welcome: null,
    sandbox: false,
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
        if (!this.tabChosen) this.setData({ tab: plan.tier === "max" ? "max" : "pro" });
        this.setData({
          prices: res.plans,
          sandbox: !!res.sandbox,
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
    const { prices, period, tier, tab } = this.data;
    const periodNow = pay.PERIODS.filter((p) => p.key === period)[0];
    const cells = prices && prices[tab];
    const cell = cells && cells[period];
    const act = actionOf(tab, tier);
    const all = pay.newFeatures(tab);
    const isRec = (tier === "free" ? "pro" : tier) === tab;
    const options = pay.PERIODS.map((p) => {
      const c = cells && cells[p.key];
      return {
        key: p.key,
        name: p.name,
        on: p.key === period,
        priceText: c ? pay.yuan(c.priceCents) : "—",
        originalText: c && c.originalCents ? "¥" + pay.yuan(c.originalCents) : "",
        saveText: saveText(cells, p),
        perDay: c ? pay.perDayText(c.priceCents, p.key) : ""
      };
    });
    this.setData({
      tabs: pay.PAID_TIERS.map((key) => ({ key: key, name: pay.tierName(key) })),
      shown: {
        key: tab,
        name: pay.tierName(tab),
        tagline: TAGLINES[tab],
        options: options,
        includes: INCLUDES[tab],
        features: all.slice(0, FEATURE_SHOWN),
        more: Math.max(0, all.length - FEATURE_SHOWN),
        current: tier === tab,
        recommended: isRec,
        tone: tab === "max" ? "gold" : "theme",
        buyClass: tab === "max" ? "gold" : "primary",
        actionText: cell ? act.text + " · ¥" + pay.yuan(cell.priceCents) + " / " + periodNow.name : act.text,
        disabled: act.disabled || !cell
      }
    });
  },

  onTab(e) {
    this.tabChosen = true;
    this.setData({ tab: e.detail.value });
    this.paint();
  },

  onPick(e) {
    this.setData({ period: e.currentTarget.dataset.key });
    this.paint();
  },

  onBuy(e) {
    if (this.data.busy) return;
    const plan = this.data.tab;
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
