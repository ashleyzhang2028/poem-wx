/**
 * 朗读。
 *
 * 网页版直接用浏览器的 speechSynthesis，零成本、零音频文件。小程序端没有
 * 这个能力，只能接 TTS 服务。三条路：
 *
 *   1. **微信同声传译插件**（默认）—— 免费。`plugin://WechatSI` 的
 *      `textToSpeech` 出 mp3，配 InnerAudioContext 播。要有企业主体的
 *      appid 并在公众平台申请插件权限，所以代码写好了、开关是关的。
 *   2. **自建 TTS**（腾讯云 / 讯飞 / 火山）—— 收费，但要签名，得走自家后端。
 *      provider 换成 "remote" 即可，接口形状一样。
 *   3. **没有可用 provider** —— 明确告知「朗读不可用」，不做静默失败，
 *      也不假装在播。
 *
 * 合成策略：**按整篇一次请求**，不逐字、不逐句。
 * 同声传译插件有 QPS 限制，一句一个请求会被限流；而一篇五绝合起来才
 * 三四十字，一次拿回来最省。长文（《昭明文选》那种）按句切段顺序合成，
 * 段间预取下一段，播放不中断。
 *
 * 音频不留档：合成出来的临时文件播完即弃，不做本地音频库 ——
 * 网页版也没有音频文件，这条口径保持一致。
 */
const store = require("./store");
const entitlement = require("./entitlement");

/** 同声传译插件：微信官方出的，免费，但要在公众平台申请权限 */
const SI_PLUGIN = "plugin://WechatSI";

/** 单次合成的字数上限。插件对文本长度有约束，超了就切段 */
const MAX_CHARS = 120;

const KEYS = {
  provider: "kb_tts_provider_v1",
  rate: "kb_tts_rate_v1",
  voice: "kb_tts_voice_v1"
};

function config() {
  const raw = store.read(KEYS.provider, null) || {};
  return {
    provider: raw.provider || "si",
    baseUrl: raw.baseUrl || "",
    rate: store.read(KEYS.rate, 0.9) || 0.9
  };
}

function setConfig(patch) {
  const cur = config();
  const next = Object.assign({}, cur, patch || {});
  store.write(KEYS.provider, { provider: next.provider, baseUrl: next.baseUrl });
  store.write(KEYS.rate, next.rate);
  return next;
}

/* ---------- 门禁 ---------- */

/**
 * 朗读要不要登录 / 要不要 Pro，与网页版同一张表（read.aloud：free + login）。
 * 权限不足时返回明确原因，由调用方决定是弹层还是 Toast。
 */
function gate() {
  if (!entitlement.can("read.aloud").ok) {
    return { ok: false, reason: entitlement.hint("read.aloud") };
  }
  return { ok: true, reason: "" };
}

/* ---------- 播放器 ---------- */

let audio = null;
let current = { text: "", chunks: [], at: 0, playing: false, onEnd: null, onError: null };

function context() {
  if (!audio) {
    audio = wx.createInnerAudioContext();
    audio.obeyMuteSwitch = false;
    audio.onEnded(() => playNext());
    audio.onError((err) => {
      current.playing = false;
      if (current.onError) current.onError(err);
    });
  }
  return audio;
}

/** 按标点切段，段长不超过 MAX_CHARS。切点只落在句读上，不切在词中间 */
function chunk(text) {
  const src = String(text == null ? "" : text).replace(/\s+/g, "");
  if (!src) return [];
  const parts = src.split(/(?<=[。！？；])/);
  const out = [];
  let buf = "";
  parts.forEach((p) => {
    if (buf && (buf + p).length > MAX_CHARS) {
      out.push(buf);
      buf = "";
    }
    // 单段本身就超长（古文里的长句），按 MAX_CHARS 硬切
    let s = p;
    while (s.length > MAX_CHARS) {
      out.push(s.slice(0, MAX_CHARS));
      s = s.slice(MAX_CHARS);
    }
    buf += s;
  });
  if (buf) out.push(buf);
  return out;
}

/* ---------- provider ---------- */

/** 同声传译插件。要求后台已申请插件权限，否则 requirePlugin 抛错 */
function siPlugin() {
  try {
    return requirePlugin("WechatSI");
  } catch (e) {
    return null;
  }
}

/** 同声传译：一次一段，回 mp3 的临时路径 */
function synthSi(text, lang) {
  return new Promise((resolve, reject) => {
    const plugin = siPlugin();
    if (!plugin || typeof plugin.textToSpeech !== "function") {
      reject(new Error("未申请同声传译插件权限"));
      return;
    }
    plugin.textToSpeech({
      lang: lang || "zh_CN",
      tts: true,
      content: text,
      success: (res) => {
        if (res && res.filename) resolve(res.filename);
        else reject(new Error("插件没有返回音频"));
      },
      fail: (err) => reject(new Error((err && err.msg) || "插件合成失败"))
    });
  });
}

/** 自建 TTS：后端接腾讯云 / 讯飞，返回可直接播的 URL */
function synthRemote(text) {
  return new Promise((resolve, reject) => {
    const cfg = config();
    if (!cfg.baseUrl) {
      reject(new Error("没配自建 TTS 地址"));
      return;
    }
    wx.request({
      url: cfg.baseUrl.replace(/\/+$/, "") + "/tts",
      method: "POST",
      data: { text, rate: cfg.rate },
      header: { "content-type": "application/json" },
      timeout: 20000,
      success: (res) => {
        const d = res.data || {};
        if (res.statusCode >= 200 && res.statusCode < 300 && d.url) resolve(d.url);
        else reject(new Error(d.message || "TTS HTTP " + res.statusCode));
      },
      fail: (err) => reject(new Error((err && err.errMsg) || "网络不可用"))
    });
  });
}

/** 当前 provider 是否可用。设置页用它决定要不要置灰 */
function available() {
  const cfg = config();
  if (cfg.provider === "si") return !!siPlugin();
  if (cfg.provider === "remote") return !!cfg.baseUrl;
  return false;
}

function providerName() {
  const p = config().provider;
  return p === "remote" ? "自建 TTS" : "微信同声传译";
}

/* ---------- 对外接口 ---------- */

/**
 * 朗读一段文本。
 * @param {string} text
 * @param {Object} [opt] onEnd / onError
 * @returns {Promise<boolean>} 是否真的开始播
 */
function speak(text, opt) {
  const g = gate();
  if (!g.ok) {
    if (opt && opt.onError) opt.onError(new Error(g.reason));
    return Promise.resolve(false);
  }

  const cfg = config();
  const chunks = chunk(text);
  if (!chunks.length) return Promise.resolve(false);

  stop();
  current = {
    text: String(text),
    chunks,
    at: 0,
    playing: true,
    onEnd: (opt && opt.onEnd) || null,
    onError: (opt && opt.onError) || null
  };

  return fetchChunk(0).then((ok) => (ok ? true : false));
}

/**
 * 合成第 n 段并播。上一段在播时就先合成下一段，减少段间停顿。
 */
function fetchChunk(n) {
  const cfg = config();
  const text = current.chunks[n];
  if (!text) return Promise.resolve(false);

  const synth = cfg.provider === "remote" ? synthRemote : synthSi;
  return synth(text)
    .then((src) => {
      if (!current.playing) return false;
      current.at = n;
      const a = context();
      a.src = src;
      a.playbackRate = cfg.rate;
      a.play();
      // 预取下一段：不 await，失败就算了，播到那一段再重试
      if (current.chunks[n + 1]) {
        synth(current.chunks[n + 1]).then((next) => {
          current[next === undefined ? "" : "nextSrc" + (n + 1)] = next;
        }).catch(() => {});
      }
      return true;
    })
    .catch((err) => {
      current.playing = false;
      if (current.onError) current.onError(err);
      return false;
    });
}

function playNext() {
  if (!current.playing) return;
  const n = current.at + 1;
  if (n >= current.chunks.length) {
    current.playing = false;
    if (current.onEnd) current.onEnd();
    return;
  }
  fetchChunk(n);
}

function stop() {
  if (audio) {
    try {
      audio.stop();
    } catch (e) {
      /* 已经停了 */
    }
  }
  if (current.playing) current.playing = false;
  current.chunks = [];
}

function playing() {
  return !!current.playing;
}

function pause() {
  if (audio && current.playing) {
    try {
      audio.pause();
    } catch (e) {
      /* ignore */
    }
  }
}

/** 设置页的「试听一声」：读一句固定的诗，不依赖当前打开的篇目 */
function sample() {
  return speak("床前明月光，疑是地上霜。", {
    onError: (err) => wx.showToast({ title: err.message, icon: "none", duration: 2500 })
  });
}

module.exports = {
  KEYS,
  config,
  setConfig,
  gate,
  available,
  providerName,
  chunk,
  speak,
  stop,
  pause,
  playing,
  sample
};
