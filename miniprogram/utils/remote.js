/**
 * 远端数据通道。
 *
 * 小程序端有两类东西放不进包，只能按需取：
 *   1. 正文分片（120 个，共 23MB）—— 走 COS + CDN
 *   2. 全文倒排列文件（2 个，共 1.1MB）—— 同上
 *
 * 这两类都是「静态文件」，所以走同一套：先查本机缓存（带版本号），
 * 再 `wx.request` 拉，落缓存。不引云开发 —— 这里要的只是文件分发，
 * 云开发数据库那套查询能力在这里全是负担。
 *
 * ⚠️ 现在还没配 COS。`configured()` 为 false 时所有 fetch 立刻 resolve(null)，
 * 上层各自降级（正文分片本来就在包内，全文检索退回索引字段搜索）。
 * 配好之后不用改任何调用点。
 */
const store = require("./store");

const KEYS = {
  base: "kb_remote_base_v1",
  textVer: "kb_text_ver_v1",
  cache: "kb_remote_cache_v1"
};

/** 文本分片的缓存上限：小程序 storage 单 key 1MB、总量 10MB，超了就按时间淘汰 */
const CACHE_MAX = 4 * 1024 * 1024;

function config() {
  return store.read(KEYS.base, null) || null;
}

/** 由设置页写入：{ text: "https://xxx.cos.ap-shanghai.myqcloud.com/poem/" } */
function setConfig(cfg) {
  store.write(KEYS.base, cfg || null);
  return config();
}

function configured() {
  const c = config();
  return !!(c && c.text);
}

function join(base, path) {
  return String(base || "").replace(/\/+$/, "") + "/" + String(path || "").replace(/^\/+/, "");
}

function get(url) {
  return new Promise((resolve, reject) => {
    wx.request({
      url,
      method: "GET",
      dataType: "json",
      timeout: 15000,
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(res.data);
        else reject(new Error("HTTP " + res.statusCode));
      },
      fail: (err) => reject(new Error((err && err.errMsg) || "网络不可用"))
    });
  });
}

/* ---------- 全文倒排 ---------- */

const COL_KEY = (n) => "kb_ft_col_v1_" + n;

/** 列文件落地缓存：一次下载，之后不再走网络 */
function cacheFulltextCol(n, data) {
  try {
    wx.setStorageSync(COL_KEY(n), data);
  } catch (e) {
    /* 单 key 超 1MB 会写失败，那就每次走网络，功能不受影响 */
  }
}

function fetchFulltextCol(n) {
  const cached = store.read(COL_KEY(n), null);
  if (cached) return Promise.resolve(cached);
  if (!configured()) return Promise.resolve(null);
  return get(join(config().text, "fulltext/" + n + ".json")).catch(() => null);
}

/* ---------- 正文分片 ---------- */

/** 清单里的版本号，用来判断远端正文有没有更新 */
function textVersion() {
  return store.read(KEYS.textVer, 0) || 0;
}

function setTextVersion(v) {
  store.write(KEYS.textVer, v || 0);
}

function fetchBucket(name) {
  if (!configured()) return Promise.resolve(null);
  const key = "kb_bucket_v1_" + name;
  const cached = store.read(key, null);
  if (cached && cached.v === textVersion()) return Promise.resolve(cached.data);
  return get(join(config().text, "texts/" + name + ".json"))
    .then((data) => {
      try {
        wx.setStorageSync(key, { v: textVersion(), data });
      } catch (e) {
        /* 同上，写不进就每次拉 */
      }
      return data;
    })
    .catch(() => null);
}

/** 清掉正文缓存，腾空间用 */
function clearCache() {
  try {
    const info = wx.getStorageInfoSync();
    (info.keys || []).forEach((k) => {
      if (k.indexOf("kb_bucket_v1_") === 0 || k.indexOf("kb_ft_col_v1_") === 0) {
        wx.removeStorageSync(k);
      }
    });
  } catch (e) {
    /* 清不掉就算了 */
  }
}

module.exports = {
  KEYS,
  config,
  setConfig,
  configured,
  fetchFulltextCol,
  cacheFulltextCol,
  fetchBucket,
  textVersion,
  setTextVersion,
  clearCache
};
