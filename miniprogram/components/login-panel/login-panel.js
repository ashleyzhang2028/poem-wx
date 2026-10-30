const store = require("../../utils/store");
const loginFlow = require("../../utils/login-flow");
const pay = require("../../utils/pay");
const icons = require("../../utils/icons");
const tiers = require("../../utils/tiers");

const KIND_TEXTS = { free: "青衫", pro: "银鱼袋", max: "金鱼袋" };
const UPGRADE_TEXTS = { free: "订阅", pro: "升级", max: "续订" };
const FOREVER_TEXT = "长期有效";

Component({
  options: {
    addGlobalClass: true
  },

  properties: {
    tierLabel: { type: String, value: "" }
  },

  observers: {
    tierLabel(label) {
      const key = String(label || "").toLowerCase();
      const tierKey = key === "pro" || key === "max" ? key : "free";
      this.setData({ tierKey: tierKey, kindText: KIND_TEXTS[tierKey], upgradeText: UPGRADE_TEXTS[tierKey], motto: tiers.mottoOf(tierKey).line });
      this.loadValid(tierKey);
    }
  },

  data: {
    tierKey: "free",
    upgradeText: UPGRADE_TEXTS.free,
    crest: icons.crest,
    gearIcon: icons.settings,
    kindText: KIND_TEXTS.free,
    motto: tiers.mottoOf("free").line,
    validText: FOREVER_TEXT,
    logged: false,
    nickname: "",
    avatarUrl: "",
    avatarChar: "诗"
  },

  attached() {
    this.refresh();
  },

  methods: {
    loadValid(tierKey) {
      if (tierKey === "free" || !this.data.logged) {
        if (this.data.validText !== FOREVER_TEXT) this.setData({ validText: FOREVER_TEXT });
        return;
      }
      pay.planInfo().then((plan) => {
        const until = plan && plan.until;
        this.setData({ validText: until ? pay.dateText(until) : FOREVER_TEXT });
      });
    },

    refresh() {
      const profile = store.profile();
      this.setData({
        logged: !!profile.logged,
        nickname: profile.logged ? store.displayName() : "",
        avatarUrl: store.avatarSrc(),
        avatarChar: store.avatarChar()
      });
    },

    onLogin() {
      this.triggerEvent("login");
    },

    onWechatAvatar(e) {
      const url = (e && e.detail && e.detail.avatarUrl) || "";
      if (!url || !this.data.logged) return;
      loginFlow.takeAvatar(url);
      this.done();
    },

    onName() {
      if (!this.data.logged) return;
      wx.showModal({
        title: "设置昵称",
        editable: true,
        placeholderText: "可使用键盘上方的微信昵称",
        confirmText: "确认",
        cancelText: "取消",
        success: (r) => {
          if (!r || !r.confirm) return;
          loginFlow.takeNickname(r.content).then(() => this.done(), () => this.done());
        }
      });
    },

    done() {
      this.refresh();
      this.triggerEvent("changed");
    },

    onUpgrade() {
      this.triggerEvent("upgrade");
    },

    onTier() {
      this.triggerEvent("tier");
    },

    onSettings() {
      this.triggerEvent("settings");
    }
  }
});
