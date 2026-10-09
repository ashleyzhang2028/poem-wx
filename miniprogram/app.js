const store = require("./utils/store");
const corpus = require("./utils/corpus");
const sync = require("./utils/sync");
const entitlement = require("./utils/entitlement");
const gate = require("./utils/gate");
const font = require("./utils/font");

App({
  globalData: {
    /** 当前选中集子 / 阅读项的传递用槽位，避免超长 query */
    pending: null
  },

  onLaunch() {
    store.migrate();
    // 预热索引与分片清单，首页首次渲染不用等 IO
    corpus.course();
    corpus.manifest();

    // 篇名宋体：系统里找得到就用系统的，找不到才拉一份子集。
    // 不 await —— 字体是观感增强，晚一两百毫秒到也无妨，不该挡住启动。
    // 未配置 CDN 时 readiness() 直接返回不可用，这里一笔网络都不发起。
    font.load().catch(() => {});

    // 登录过的：启动时刷一次档位。管理员可能刚改过，界面得跟着变。
    // 没登录就什么都不做 —— 未登录只能看首页目录，这条边界在 gate.js 里。
    if (gate.logged()) entitlement.sync().catch(() => {});

    // 上次没同步完的，启动时补一次。失败不打断 —— 功能不靠同步吃饭，
    // 同步只是「有则更好」。启动后 3 秒再动：让首页先渲染完，别抢网络。
    this.syncTimer = setTimeout(() => {
      if (gate.logged()) sync.now().catch(() => {});
    }, 3000);
  },

  onShow() {
    store.touchDaily();
  },

  onHide() {
    if (this.syncTimer) clearTimeout(this.syncTimer);
  }
});
