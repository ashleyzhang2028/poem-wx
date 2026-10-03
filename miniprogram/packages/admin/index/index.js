const admin = require("../../../utils/admin");
const tiers = require("../../../utils/tiers");
const entitlement = require("../../../utils/entitlement");
const remote = require("../../../utils/remote");
const auth = require("../../../utils/auth");
const gate = require("../../../utils/gate");
const theme = require("../../../utils/theme");

const ROLE_NAME = { owner: "所有者", admin: "管理员", user: "普通用户" };

/**
 * 管理页：给微信登录用户分层设置（free / pro / max，与 poem 口径一致）。
 *
 * 三块，按「谁看得到」分开：
 *   我的授权 —— 登录用户都能看（只读）。这一档开了什么，一眼看完。
 *   用户名录 —— 登录 + 服务端就绪才能看；要 owner / admin 才能改。
 *   能力矩阵 —— 与我的授权同一张表，逐条列出，不可用的写明差在哪一档。
 *
 * ⚠️ 与上一版的差别：本机**不能自己改档位**了。上一版有个「改本机层级」的卡片，
 *   点两下就能升到 max —— 那等于把管理页变成自助提权，「管理页给登录用户分级」
 *   就成了摆设。现在档位只有一个来源：管理员在名录里按人发。
 *
 * ⚠️ 另一件要说清的：微信小程序不支持个人主体的虚拟支付，
 *   但这一版**根本不需要支付** —— 三档都是管理员按人分的，界面不出现价格。
 */
Page({
  data: {
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
    roleLabel: "",
    canWrite: false,
    canSetRole: false,
    busy: false,
    msg: "",

    /** 后端地址：同步、微信登录、名录都走它。留空 = 没后端，一切照旧降级 */
    baseUrl: "",
    baseUrlNote: "",
    wxLoginNote: ""
  },

  onShow() {
    theme.apply(this);
    this.refresh();
  },

  refresh() {
    const snap = entitlement.snapshot();
    // canWrite / canSetRole 先落到局部：decorate() 在 setData 生效之前就跑了，
    // 从 this.data 读会读到上一轮的值
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
      roleLabel: ROLE_NAME[auth.role()] || "普通用户",
      baseUrl: auth.baseUrl() || "",
      baseUrlNote: auth.configured()
        ? "已配置。微信公众平台的「request 合法域名」里也要加上这个域名，否则真机一律不通 —— 开发者工具里勾了「不校验合法域名」能绕过，真机绕不过。"
        : "还没配。配上前：登录降级为本机身份、档位按免费、进度只在本机。",
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

  /**
   * 每一行补两件事：从哪来的、这一行能不能改。
   *
   * 原先是把两个嵌套三元表达式摊在模板里（`item.local ? '本机' : (item.remote ? …)`），
   * 读的人得先在脑子里跑一遍；「能不能改」更是分散在两个按钮的 wx:if 上。
   * 挪到这里，一眼能看完。
   */
  decorate(users, canWrite, canSetRole) {
    return (users || []).map((u) => {
      let scopeText = "名册只读";
      if (u.local) scopeText = "本机";
      else if (u.remote) scopeText = "服务端";
      return Object.assign({}, u, {
        scopeText,
        // 名册里的那批是构建产物，改不了；服务端与本机这两条才谈得上「可写」
        editable: canWrite || canSetRole ? !!u.remote || !!u.local : false
      });
    });
  },

  onLogin() {
    wx.navigateTo({ url: "/pages/mine/mine?login=1" });
  },

  /**
   * 能力分组。与 entitlement.CAPS 同表 —— 分组只是排版，
   * 判据一律走 snapshot().caps[key].ok，界面不自己算。
   */
  groupCaps(snap) {
    const GROUPS = [
      { title: "免费档（登录即得）", keys: ["daily", "library", "pinyin", "ebbinghaus", "progress", "search"] },
      { title: "登录即开", keys: ["speak", "export", "leitner"] },
      { title: "专业档起", keys: ["sync", "sm2", "quiz", "collections", "admin"] },
      { title: "全能档起", keys: ["fsrs", "feihualing", "exam"] }
    ];
    return GROUPS.map((g) => ({
      title: g.title,
      rows: g.keys
        .map((k) => {
          const c = snap.caps[k];
          if (!c) return null;
          // 朗读：能力键留着（与网页版对齐，服务端那边也还在），
          // 但界面上**一处都调不到** —— 所以这一行不能只是打个勾，
          // 得如实写「界面没做」。否则这张表在说假话：
          // 「语音朗读 ✓」看起来像点一下就能用。
          const noUi = k === "speak";
          return { name: c.name, on: c.ok && !noUi, noUi: noUi, note: noUi ? "能力键留着 · 界面未做" : c.ok ? "" : entitlement.hint(k) };
        })
        .filter(Boolean)
    }));
  },

  /* ---------- 改档 ---------- */

  onSetTier(e) {
    const userId = e.currentTarget.dataset.u;
    const current = e.currentTarget.dataset.t;

    if (!this.data.canWrite) {
      wx.showModal({
        title: "改不了别人的档位",
        content: this.data.remoteReady
          ? "要管理员角色才能改（当前：" + this.data.roleLabel + "）。"
          : "后端接口还没部署，名录只读。档位由管理员在服务端发放。",
        showCancel: false,
        confirmText: "知道了"
      });
      return;
    }

    const items = tiers.TIERS.map((t) => ({
      key: t.key,
      text: t.name + "（" + t.key + "）"
    }));
    items.unshift({ key: "", text: "收回（重置为免费）" });

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
      wx.showToast({ title: "改角色只对 owner 开放", icon: "none" });
      return;
    }

    const items = [
      { text: "普通用户（user）", key: "user" },
      { text: "管理员（admin）", key: "admin" }
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

  /**
   * 微信登录那一层就绪没有。
   *
   * 判据只能是「服务端真的有 /api/wx/login」—— 而这个**探测不了**：
   * 主动打一次会白留一条失败日志，也拿不到确定性答案。
   * 所以这里不猜，只把「要满足哪些条件才算就绪」摆出来，让人自己核。
   * 编一个「疑似已就绪」比不说更坏。
   */
  wxNote() {
    if (!auth.configured()) return "微信登录要后端配合：/api/wx/login 做 code2Session 换 openid。见 docs/wx-login-server.md。";
    return "配置了后端，但 /api/wx/login 是否已上线只有服务端知道。登录若一直落地成「本机身份」，就是那两条路由还没加 —— 见 docs/wx-login-server.md。";
  },

  onBaseUrl(e) {
    this.setData({ baseUrl: e.detail.value || "" });
  },

  /**
   * 存后端地址。**不顺手清会话**：地址换了但会话还有效时（比如从测试环境切到正式），
   * 清掉会让用户莫名其妙地掉线一次。真连不上，下一次 request 自己会失败并如实报。
   */
  onSaveBaseUrl() {
    const url = String(this.data.baseUrl || "").trim();
    if (url && !/^https:\/\//.test(url)) {
      wx.showToast({ title: "要 https:// 开头", icon: "none" });
      return;
    }
    auth.configure({ baseUrl: url.replace(/\/+$/, "") });
    this.setData({ busy: true });
    entitlement
      .sync()
      .then(() => {
        this.setData({ busy: false, msg: url ? "地址已保存" : "已清空后端地址" });
        this.refresh();
      })
      .catch(() => {
        this.setData({ busy: false, msg: "地址已保存，但连不上" });
        this.refresh();
      });
  },

  onLoadAccounts() {
    if (!this.data.adminReady) {
      wx.showModal({
        title: "云端名录不可用",
        content:
          (this.data.remoteReady
            ? "后端已配置，但你这一档不是管理员，读不到全站名录。"
            : "后端接口还没部署。名录要服务端就绪后才有。") +
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
      data: "belem@cnb.cool",
      success: () => wx.showToast({ title: "邮箱已复制，可以申请档位", icon: "none" })
    });
  }
});
