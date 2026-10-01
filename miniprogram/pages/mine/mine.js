const store = require("../../utils/store");
const auth = require("../../utils/auth");
const S = require("../../utils/scheduler");
const R = require("../../utils/review-models");
const entitlement = require("../../utils/entitlement");
const sync = require("../../utils/sync");
const speech = require("../../utils/speech");

Page({
  data: {
    logged: false,
    nickname: "未登录",
    avatarUrl: "",
    gradeName: "",
    scopeName: "",
    algoName: "",
    dailyCount: 5,
    stats: { learned: 0, mastered: 0, readCount: 0 },
    tierLabel: "Max",
    role: "user",
    syncState: "",
    ttsName: "",
    upgradeNotice: null
  },

  onShow() {
    this.refresh();
    this.autoSync();
  },

  refresh() {
    const settings = store.settings();
    const profile = store.profile();
    const stats = store.stats();
    const E = entitlement.identity();
    const last = sync.lastResult();

    this.setData({
      logged: !!profile.logged,
      nickname: profile.nickname || "未登录",
      avatarUrl: profile.avatarUrl || "",
      gradeName: S.gradeName(settings.grade) + S.termName(settings.term),
      scopeName: S.scopeOf(settings.scope).scopeName,
      algoName: R.modelOf(settings.algo).name,
      dailyCount: settings.dailyCount,
      stats,
      tierLabel: E.label,
      role: E.role,
      ttsName: speech.providerName(),
      syncState: this.syncText(last),
      upgradeNotice: entitlement.readNotice()
    });
  },

  syncText(last) {
    if (!sync.configured()) return "未接云端，进度只在这台手机上";
    if (!auth.logged()) return "登录后可跨设备同步";
    const g = entitlement.can("sync.multiDevice");
    if (!g.ok) return entitlement.hint("sync.multiDevice");
    if (!last) return sync.pendingCount() ? "有 " + sync.pendingCount() + " 条待同步" : "还没同步过";
    return last.ok
      ? "上次同步：拉 " + last.pulled + " · 推 " + last.pushed
      : "同步未成功：" + last.reason;
  },

  /**
   * 进「我的」时静默同步一次。
   *
   * 不弹任何东西 —— 同步失败不影响本机使用，用户没要求同步就不该被打断。
   * 状态在下面那行小字里，想看的人看得到。
   */
  autoSync() {
    if (!sync.configured() || !auth.logged()) return;
    if (!entitlement.can("sync.multiDevice").ok) return;
    sync.run().then(() => this.refresh()).catch(() => {});
  },

  onLogin() {
    auth
      .login()
      .then(() => {
        this.refresh();
        wx.showToast({ title: "已登录", icon: "success" });
      })
      .catch((err) => wx.showToast({ title: err.message || "登录未完成", icon: "none" }));
  },

  onAvatarChoose(e) {
    const url = e.detail.avatarUrl;
    if (!url) return;
    store.saveProfile({ avatarUrl: url });
    this.refresh();
  },

  onNickname(e) {
    const nickname = (e.detail.value || "").trim();
    if (!nickname) return;
    store.saveProfile({ nickname });
    this.refresh();
  },

  onAdmin() {
    wx.navigateTo({ url: "/packages/settings/admin/admin" });
  },

  onDismissNotice() {
    entitlement.clearNotice();
    this.setData({ upgradeNotice: null });
  },

  onSettings() {
    wx.navigateTo({ url: "/packages/settings/general/general" });
  },

  onRecite() {
    wx.navigateTo({ url: "/packages/settings/recite/recite" });
  },

  onReader() {
    wx.navigateTo({ url: "/packages/settings/reader/reader" });
  },

  onProgress() {
    wx.navigateTo({ url: "/packages/progress/index/index" });
  },

  onGame() {
    wx.navigateTo({ url: "/packages/game/index/index" });
  },

  onAbout() {
    wx.navigateTo({ url: "/packages/settings/about/about" });
  },

  /**
   * 导出备份。
   *
   * 按 poem 的边界，导出属于免费功能但要登录（`export.progress`：free + login）。
   * 没登录时本机档案也是「登录态的一种」，所以这里只在完全没有身份时提示。
   */
  onExport() {
    const g = entitlement.can("export.progress");
    if (!g.ok) {
      wx.showToast({ title: entitlement.hint("export.progress"), icon: "none" });
      return;
    }
    const data = store.exportAll();
    const text = JSON.stringify(data);
    wx.setClipboardData({
      data: text,
      success: () =>
        wx.showToast({
          title: "备份已复制（" + Math.round(text.length / 1024) + "KB）",
          icon: "none",
          duration: 2500
        })
    });
  },

  onImport() {
    wx.showModal({
      title: "导回备份",
      content: "把上次复制的 JSON 粘到剪贴板后点确定。这会覆盖本机现有的进度。",
      confirmText: "导回",
      success: (res) => {
        if (!res.confirm) return;
        wx.getClipboardData({
          success: (clip) => {
            try {
              const data = JSON.parse(clip.data);
              store.importAll(data);
              // 导回来的进度也要上云，否则换台设备又没了
              (data.progress ? Object.keys(data.progress) : []).forEach((id) => {
                sync.enqueue(id, data.progress[id]);
              });
              this.refresh();
              wx.showToast({ title: "已导回", icon: "success" });
            } catch (e) {
              wx.showToast({ title: "剪贴板里不是备份数据", icon: "none", duration: 2500 });
            }
          }
        });
      }
    });
  },

  onClear() {
    wx.showModal({
      title: "清空本机数据",
      content: "背诵进度、已读标记、自选集合都会删掉，且无法恢复。云端的不会被删。",
      confirmText: "清空",
      confirmColor: "#a83b32",
      success: (res) => {
        if (!res.confirm) return;
        store.clearProgress();
        sync.reset();
        this.refresh();
        wx.showToast({ title: "已清空", icon: "success" });
      }
    });
  }
});
