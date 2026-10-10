const admin = require("../../../utils/admin");
const tiers = require("../../../utils/tiers");
const entitlement = require("../../../utils/entitlement");
const remote = require("../../../utils/remote");
const auth = require("../../../utils/auth");
const gate = require("../../../utils/gate");
const theme = require("../../../utils/theme");

Page({
  data: {
    themeStyle: "",
    logged: false,
    status: {},
    tiers: tiers.TIERS,
    caps: [],
    groups: [],
    stats: { caps: 0, enabled: 0 },

    users: [],
    rosterNote: "",
    generatedAt: "",
    remoteReady: false,
    adminReady: false,
    canWrite: false,
    canSetRole: false,
    busy: false,
    msg: "",

    baseUrl: "",
    baseUrlNote: "",
    cloudEnv: "",
    cloudService: "",
    cloudNote: "",
    useCloud: false,
    wxLoginNote: ""
  },

  onShow() {
    theme.apply(this);
    this.refresh();
  },

  refresh() {
    const snap = entitlement.snapshot();

    const canWrite = admin.canWrite();
    const canSetRole = admin.canSetRole();
    this.setData({
      logged: snap.logged,
      status: snap,
      caps: entitlement.CAP_KEYS.map((k) => Object.assign({ key: k }, snap.caps[k])),
      groups: this.groupCaps(snap),
      stats: admin.stats(),
      remoteReady: remote.configured(),
      adminReady: remote.adminReady(),
      canWrite: canWrite,
      canSetRole: canSetRole,
      baseUrl: auth.baseUrl() || "",
      baseUrlNote: this.baseNote(),
      cloudEnv: auth.cloudConfig().env || "",
      cloudService: auth.cloudConfig().service || "",
      cloudNote: this.cloudNote(),
      useCloud: auth.useCloud(),
      wxLoginNote: this.wxNote()
    });

    if (!snap.logged) return;
    admin.list().then((res) => {
      this.setData({
        users: this.decorate(res.users, canWrite, canSetRole),
        rosterNote: res.note || "",
        generatedAt: admin.roster().generatedAt || ""
      });
    });
  },

  decorate(users, canWrite, canSetRole) {
    return (users || []).map((u) =>
      Object.assign({}, u, {

        editable: canWrite || canSetRole ? !!u.remote || !!u.local : false
      })
    );
  },

  onLogin() {
    wx.navigateTo({ url: "/pages/mine/mine?login=1" });
  },

  groupCaps(snap) {
    const GROUPS = [
      { title: "Free（登录即得）", keys: ["daily", "extra", "library", "pinyin", "ebbinghaus", "progress", "search"] },
      { title: "登录即开", keys: ["speak", "export", "leitner"] },
      { title: "Pro 起", keys: ["sync", "sm2", "quiz", "collections", "admin"] },
      { title: "Max 起", keys: ["fsrs", "feihualing", "exam"] }
    ];
    return GROUPS.map((g) => ({
      title: g.title,
      rows: g.keys
        .map((k) => {
          const c = snap.caps[k];
          if (!c) return null;

          const noUi = k === "speak";
          return { name: c.name, on: c.ok && !noUi, noUi: noUi, note: noUi ? "能力键留着 · 界面未做" : c.ok ? "" : entitlement.hint(k) };
        })
        .filter(Boolean)
    }));
  },

  onSetTier(e) {
    const userId = e.currentTarget.dataset.u;
    const current = e.currentTarget.dataset.t;

    if (!this.data.canWrite) {
      wx.showModal({
        title: "改不了别人的档位",
        content: this.data.remoteReady
          ? "你的账号没有改档位的权限。"
          : "同步服务器还没接上，名录只读。",
        showCancel: false,
        confirmText: "知道了"
      });
      return;
    }

    const items = tiers.TIERS.map((t) => ({
      key: t.key,
      text: t.name
    }));
    items.unshift({ key: "", text: "收回（重置为 Free）" });

    wx.showActionSheet({
      itemList: items.map((i) => i.text),
      success: (res) => {
        const pick = items[res.tapIndex];
        if (!pick || pick.key === current) return;

        this.setData({ busy: true, msg: "" });
        const job = pick.key ? admin.setTier(userId, pick.key) : admin.revokeTier(userId);
        job.then((r) => {
          this.setData({ busy: false, msg: r.msg });
          this.refresh();
        });
      }
    });
  },

  onSetRole(e) {
    const userId = e.currentTarget.dataset.u;
    const current = e.currentTarget.dataset.r;

    if (!this.data.canSetRole) {
      wx.showToast({ title: "没有改角色的权限", icon: "none" });
      return;
    }

    const items = [
      { text: "user", key: "user" },
      { text: "admin", key: "admin" }
    ];
    wx.showActionSheet({
      itemList: items.map((i) => i.text),
      success: (res) => {
        const pick = items[res.tapIndex];
        if (!pick || pick.key === current) return;
        this.setData({ busy: true, msg: "" });
        admin.setRole(userId, pick.key).then((r) => {
          this.setData({ busy: false, msg: r.msg });
          this.refresh();
        });
      }
    });
  },

  wxNote() {
    if (!auth.configured()) {
      return "微信登录要服务器配合（code2Session 换 openid）。"
        + "两格空着时点登录**不算登录成功** —— 账号与进度都还留在这台手机上。"
        + "见 docs/wx-login-server.md。";
    }
    /* ⚠️ 「那两条路由上没上」客户端探测不了，所以这句只能是**可能**，
       而且要说清「怎么验」—— Issue #121 的痛点正是「界面说成功、而库里什么都没有」，
       用户只能自己去翻数据库。 */
    return "这两格只是「往哪儿连」，通信本身通不通这里看不出来："
      + "填好后点一次登录，去库里看 accounts / wx_accounts 有没有新行 "
      + "（查法见 docs/wx-cloud-setup.md § 七）。一直没有就是那两条路由还没上。";
  },

  baseNote() {
    if (!auth.configured()) return "还没配。没配之前：登录只记在这台手机、档位按免费、换手机进度不跟随。";
    if (auth.useCloud()) return "当前走的是下面的云调用，这格留空即可。";
    return "已配置。微信公众平台的「request 合法域名」里也要加上这个域名，否则真机一律不通 —— 开发者工具里勾了「不校验合法域名」能绕过，真机绕不过。而这个名单只收**已备案**的域名：云托管默认域填不进去（微信会提示「仅用作测试使用」），所以要这条路就先备好域名。";
  },

  cloudNote() {
    if (!auth.configured()) return "";
    if (auth.useCloud()) return "已配置，当前走这条。免域名、免备案、免 request 合法域名名单。";
    return "填了就改走云调用（会盖过上面的地址）。免域名、免备案。";
  },

  onBaseUrl(e) {
    this.setData({ baseUrl: e.detail.value || "" });
  },

  onCloudEnv(e) {
    this.setData({ cloudEnv: e.detail.value || "" });
  },

  onCloudService(e) {
    this.setData({ cloudService: e.detail.value || "" });
  },

  onSaveCloud() {
    const env = String(this.data.cloudEnv || "").trim();
    const service = String(this.data.cloudService || "").trim();
    if (!env && !service) {
      auth.configure({ cloud: null });
      this.afterConfigure("已清空云调用配置");
      return;
    }
    if (!env || !service) {
      wx.showToast({ title: "两个都要填", icon: "none" });
      return;
    }

    if (/^\d+-\d+-\d+$/.test(env)) {
      wx.showModal({
        title: "env 填错了",
        content: "这一格要**云开发**环境 ID（形如 poem-xxxxxxxx），不是云托管那个数字环境 ID。两个是不同的环境，平台按这一格找云开发，找不到会回 env not exists。",
        showCancel: false,
        confirmText: "知道了"
      });
      return;
    }
    auth.configure({ cloud: { env: env, service: service } });
    this.afterConfigure("云调用配置已保存");
  },

  onSaveBaseUrl() {
    const url = String(this.data.baseUrl || "").trim();
    if (url && !/^https:\/\//.test(url)) {
      wx.showToast({ title: "要 https:// 开头", icon: "none" });
      return;
    }
    auth.configure({ baseUrl: url.replace(/\/+$/, "") });
    this.afterConfigure(url ? "地址已保存" : "已清空地址");
  },

  afterConfigure(okMsg) {
    this.setData({ busy: true });
    /* 配置好之后顺手把「刚才那次没接上服务器的登录」补上 ——
       没配时 `auth.login()` 把 code 留在 `loginCode` 里就是为了这一下
       （见 utils/auth.js）。不补的话，用户得自己去「我的」页再点一次登录，
       而他会以为「配好了就该自己连上」（Issue #121）。 */
    const resume = auth.localCode() ? auth.login() : Promise.resolve(null);
    resume
      .catch(() => null)
      .then(() => entitlement.sync())
      .then((snap) => {
        this.setData({ busy: false, msg: okMsg });
        this.refresh();
        return snap;
      })
      .catch(() => {
        this.setData({ busy: false, msg: okMsg + "，但连不上" });
        this.refresh();
      });
  },

  onLoadAccounts() {
    if (!this.data.adminReady) {
      wx.showModal({
        title: "名录不可用",
        content:
          (this.data.remoteReady
            ? "服务器已接上，但你的账号读不到全站名录。"
            : "服务器还没接上。名录要接上之后才有。") +
          "\n\n下面的名单是构建时导入的名册（只读），没有它就只能看自己。",
        showCancel: false,
        confirmText: "知道了"
      });
      return;
    }
    this.setData({ busy: true });
    this.refresh();
    setTimeout(() => this.setData({ busy: false }), 600);
  },

  onCopyFeedback() {
    wx.setClipboardData({
      data: "kuibuapp@163.com",
      success: () => wx.showToast({ title: "邮箱已复制，可以申请档位", icon: "none" })
    });
  }
});
