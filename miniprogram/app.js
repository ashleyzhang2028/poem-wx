const store = require("./utils/store");
const corpus = require("./utils/corpus");
const sync = require("./utils/sync");

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

    // 上次没同步完的，启动时补一次。失败不打断 —— 不登录也能用全部功能
    // 是这条 App 的底线，同步只是「有则更好」。
    // 启动后 3 秒再动：让首页先渲染完，别跟语料预热抢网络
    this.syncTimer = setTimeout(() => {
      sync.now().catch(() => {});
    }, 3000);
  },

  onShow() {
    store.touchDaily();
  },

  onHide() {
    if (this.syncTimer) clearTimeout(this.syncTimer);
  }
});
