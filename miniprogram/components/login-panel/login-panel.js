const store = require("../../utils/store");
const auth = require("../../utils/auth");
const loginFlow = require("../../utils/login-flow");

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
    avatarChar: "诗"
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

    onLogout() {
      wx.showModal({
        title: "辞别",
        content: "君之吟咏笔录，积日累月，皆藏云笈。此行暂歇，他日重至，诗章犹在。",
        confirmText: "辞别",
        cancelText: "留步",
        success: (r) => (r && r.confirm ? this.leave() : null)
      });
    },

    leave() {
      auth.logout();
      this.refresh();
      loginFlow.report();
    },

    onTier() {
      this.triggerEvent("tier");
    }
  }
});
