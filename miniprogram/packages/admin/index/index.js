const admin = require("../../../utils/admin");
const tiers = require("../../../utils/tiers");
const entitlement = require("../../../utils/entitlement");
const remote = require("../../../utils/remote");
const auth = require("../../../utils/auth");
const gate = require("../../../utils/gate");
const theme = require("../../../utils/theme");

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
    canWrite: false,
    canSetRole: false,
    busy: false,
    msg: "",

    /**
     * 后端地址。同步、微信登录、名录都走它。
     *
     * **两条通道二选一**：填地址（`baseUrl`）走 `wx.request`，那条要域名
     * 能进 request 合法域名名单 —— 即**必须已备案**；填云调用那两个格子
     * （`cloudEnv` + `cloudService`）走 `wx.cloud.callContainer`，免域名免备案。
     * 留空 = 没配置，功能按本机降级。
     */
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

  /**
   * 每一行只补一件事：这一行能不能改。
   *
   * 「能不能改」原先分散在两个按钮的 wx:if 上，挪到这里，一眼能看完。
   *
   * 这里曾经还补过一格来源（管理员发放 / 自己设的 / 名册只读）。用户 2026-10-05
   * 说不要「管理员发放」五个字，干脆整格撤掉，而不是换句措辞 ——
   * 名录本身就是管理页，站在这里的人不是来收档位的；真要说清「谁还能改」，
   * 右边那两个按钮（改档 / 角色）和那枚「只读」比一句话准。
   */
  decorate(users, canWrite, canSetRole) {
    return (users || []).map((u) =>
      Object.assign({}, u, {
        // 名册里的那批是构建产物，改不了；服务器下发与自己设的这两条才谈得上「可写」
        editable: canWrite || canSetRole ? !!u.remote || !!u.local : false
      })
    );
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
          ? "你的账号没有改档位的权限。"
          : "同步服务器还没接上，名录只读。",
        showCancel: false,
        confirmText: "知道了"
      });
      return;
    }

    // 档名就是 Free / Pro / Max —— 不再拼「全能（max）」那种一档两名
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

  /**
   * 微信登录那一层就绪没有。
   *
   * 判据只能是「服务端真的有 /api/wx/login」—— 而这个**探测不了**：
   * 主动打一次会白留一条失败日志，也拿不到确定性答案。
   * 所以这里不猜，只把「要满足哪些条件才算就绪」摆出来，让人自己核。
   * 编一个「疑似已就绪」比不说更坏。
   */
  wxNote() {
    if (!auth.configured()) return "微信登录要服务器配合：/api/wx/login 做 code2Session 换 openid。见 docs/wx-login-server.md。";
    return "地址配好了，但服务器上的 /api/wx/login 是否已上线，客户端无从探测。登录若一直只记在这台手机，就是那两条路由还没加 —— 见 docs/wx-login-server.md。";
  },

  /** 地址那条路的现状。**措辞里必须点出「已备案」**——那是它真正的门槛 */
  baseNote() {
    if (!auth.configured()) return "还没配。没配之前：登录只记在这台手机、档位按免费、换手机进度不跟随。";
    if (auth.useCloud()) return "当前走的是下面的云调用，这格留空即可。";
    return "已配置。微信公众平台的「request 合法域名」里也要加上这个域名，否则真机一律不通 —— 开发者工具里勾了「不校验合法域名」能绕过，真机绕不过。而这个名单只收**已备案**的域名：云托管默认域填不进去（微信会提示「仅用作测试使用」），所以要这条路就先备好域名。";
  },

  /**
   * 云调用那条路的现状。
   *
   * 两句话要分开说：**能免掉什么**（域名 / 备案 / 白名单），
   * **代价是什么**（只能小程序调；两个格子是两种环境 ID，填错栏会报 env not exists）。
   * 少了后半句，人会拿云托管的环境 ID 去填 `env`，然后在
   * 「服务明明部署了」和「调不通」之间来回。
   */
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

  /**
   * 存云调用配置。
   *
   * 两格**同时**要：只填一个的话平台那边回的是 `env not exists` / `service not found`，
   * 看着像服务没部署，其实是少了一栏。所以这里不许「填一半先存着」——
   * 存不下去比存下一个调不通的强。
   */
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
    // 云开发环境 ID 形如 `poem-d9g1bqeq978682c58`；把云托管那个填进来是最常见的一种错
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
    this.afterConfigure(url ? "地址已保存" : "已清空地址");
  },

  /** 存完之后试一次，把「配好了」与「配了但连不上」分开 —— 两句话不一样 */
  afterConfigure(okMsg) {
    this.setData({ busy: true });
    entitlement
      .sync()
      .then(() => {
        this.setData({ busy: false, msg: okMsg });
        this.refresh();
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
      data: "belem@cnb.cool",
      success: () => wx.showToast({ title: "邮箱已复制，可以申请档位", icon: "none" })
    });
  }
});
