const store = require("./utils/store");
const corpus = require("./utils/corpus");

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
  },

  onShow() {
    store.touchDaily();
  }
});
