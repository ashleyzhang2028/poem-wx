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
    avatarChar: "诗",
    picking: false
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
        avatarChar: store.avatarChar(),
        picking: !!profile.logged && this.data.picking
      });
    },

    onLogin() {
      this.triggerEvent("login");
    },

    onWechat() {
      if (!this.data.logged) return;
      this.pick(true);
    },

    onWechatAvatar(e) {
      const url = (e && e.detail && e.detail.avatarUrl) || "";
      this.pick(false);
      if (!url || !this.data.logged) return;
      loginFlow.share({ avatar: url, nickname: true }, this).then((res) => {
        this.done();
        if (res && res.nickname) this.triggerEvent("changed");
      }).catch(() => this.done());
    },

    pick(withNickname) {
      if (!this.data.logged) return;
      if (!withNickname) {
        this.setData({ picking: true });
        return;
      }
      this.setData({ picking: false });
      this.promptName();
    },

    promptName() {
      if (!this.data.logged) return;
      wx.showModal({
        title: "昵称",
        editable: true,
        placeholderText: "键盘上方可以选微信昵称",
        confirmText: "好",
        cancelText: "取消",
        success: (r) => {
          if (!r || !r.confirm) return;
          this.saveName(String(r.content || "").trim());
        }
      });
    },

    saveName(nickname) {
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

    done() {
      this.release();
      this.refresh();
      this.triggerEvent("changed");
    },

    release() {
      const entry = this.entry;
      this.entry = null;
      this.arm("");
      if (entry) entry.exit = () => {};
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
      this.setData({ picking: false });
      this.refresh();
      this.triggerEvent("changed", { logged: false });
    },

    onTier() {
      this.triggerEvent("tier");
    },

    showIdentity() {
      this.setData({ picking: true });
    },

    done() {
      this.setData({ picking: false });
      this.refresh();
      this.triggerEvent("changed");
    }
  }
});
