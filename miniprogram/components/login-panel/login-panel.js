const store = require("../../utils/store");
const auth = require("../../utils/auth");
const loginFlow = require("../../utils/login-flow");
const tabPage = require("../../utils/tab-page");

Component({
  options: {
    addGlobalClass: true
  },

  properties: {
    tierLabel: { type: String, value: "" }
  },

  data: {
    logged: false,
    nickname: "",
    avatarUrl: "",
    avatarChar: "诗",
    wechatFocus: false
  },

  attached() {
    this.refresh();
  },

  methods: {
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
      loginFlow.askLogin(this).catch(() => {});
    },

    onWechat() {
      if (!this.data.logged) return;
      loginFlow.start(this, loginFlow.WECHAT_ITEMS[2]).catch(() => {});
    },

    onWechatAvatar(e) {
      const url = (e && e.detail && e.detail.avatarUrl) || "";
      if (!url || !this.data.logged) return;
      loginFlow.start(this, loginFlow.WECHAT_ITEMS[2]).catch(() => {});
      this.give(url);
    },

    done() {
      this.entry = null;
      this.arm("");
      this.refresh();
      this.triggerEvent("changed");
    },

    onLogout() {
      wx.showModal({
        title: "退出登录",
        content: "退出后背诵数据不会丢，但功能要重新登录才能用。",
        confirmText: "退出",
        cancelText: "取消",
        success: (r) => (r && r.confirm ? this.leave() : null)
      });
    },

    leave() {
      auth.logout();
      tabPage.mine();
    },

    onNickname(e) {
      const nickname = ((e && e.detail && e.detail.value) || "").trim();
      if (!nickname) return;
      const before = store.profile().nickname || "";
      store.saveProfile({ nickname });
      this.refresh();
      this.triggerEvent("changed");
      auth.saveNickname(nickname).then((r) => {
        if (!r || !r.blocked) return;
        store.saveProfile({ nickname: before });
        this.refresh();
        wx.showToast({ title: r.reason || "这个昵称不能用，换一个吧", icon: "none" });
      });
    },

    onTier() {
      this.triggerEvent("tier");
    },

    wechatBind(entry) {
      this.entry = entry;
      this.typed = "";
      entry.ready = (part) => this.arm(part);
      entry.exit = () => this.done();
    },

    arm(part) {
      this.part = part;
      if (this.data.wechatFocus !== (part === "nickname")) {
        this.setData({ wechatFocus: part === "nickname" });
      }
    },

    give(value) {
      if (!this.entry || !this.part) return;
      const at = this.entry;
      this.arm("");
      at.give(value || "");
    },

    onWechatInput(e) {
      const value = ((e && e.detail && e.detail.value) || this.typed || "").trim();
      this.typed = value;
      if (!value || this.part !== "nickname") return;
      this.give(value);
    }
  }
});
