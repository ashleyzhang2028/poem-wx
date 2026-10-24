const store = require("../../utils/store");
const loginFlow = require("../../utils/login-flow");
const pay = require("../../utils/pay");

const KIND_TEXTS = { free: "基础卡", pro: "金卡", max: "铂金卡" };
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
      this.setData({ tierKey: tierKey, kindText: KIND_TEXTS[tierKey] });
      this.loadValid(tierKey);
    }
  },

  data: {
    tierKey: "free",
    kindText: KIND_TEXTS.free,
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
        placeholderText: "可选用键盘上方的微信昵称",
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

    onTier() {
      this.triggerEvent("tier");
    }
  }
});
