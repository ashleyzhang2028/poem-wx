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
        title: "昵称",
        editable: true,
        placeholderText: "键盘上方可以选微信昵称",
        confirmText: "好",
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
        content: "君日积月累之吟咏笔录，藏于云笈；此番跬途，于此暂歇。待来日重至，复拾诗章。",
        confirmText: "辞别",
        cancelText: "暂缓",
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
