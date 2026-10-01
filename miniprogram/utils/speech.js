/**
 * 朗读。三条 provider，按顺序探测，谁先就绪用谁：
 *
 *   1. plugin  微信同声传译插件（WechatSI）—— 免费，但要企业/个体户主体申请插件
 *   2. remote  自家 TTS（腾讯云 / 讯飞 / 火山）—— 收费或自带额度，要后端签名
 *   3. offline 已缓存的音频 —— 上次联网读过的句子，这次离线还能读
 *
 * ⚠️ 这里只负责「能不能读」和「怎么读」，**不决定界面显不显示播放按钮**。
 *   界面显隐的裁决在 utils/entitlement.js：未授权的档位不显示，
 *   已授权但通道没就绪的显示为「待开通」。两者混在一起就会出现
 *   「按钮亮着、点下去弹 toast」这种假存活，那是这轮要消掉的东西。
 */
const store = require("./store");
const entitlement = require("./entitlement");

const PLUGIN_PROVIDER = "plugin";
const PLUGIN_VERSION = "0.3.6";

/** 客户端侧对同一段文本的归一：换行和全角空格是排版用的，朗读不该听到停顿 */
function normalize(text) {
  return String(text || "")
    .replace(/\s+/g, "")
    .trim();
}

function keyOf(text) {
  // 文稿不长，FNV-1a 够用；只用于缓存文件名，不做安全用途
  let h = 0x811c9dc5;
  const s = normalize(text);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return "s" + h.toString(36) + "_" + s.length;
}

function prefs() {
  return store.read(store.KEYS.speech, {}) || {};
}

function savePrefs(patch) {
  const next = Object.assign(prefs(), patch || {});
  store.write(store.KEYS.speech, next);
  return next;
}

function configuredProvider() {
  return prefs().provider || "auto";
}

/** 显式指定了 provider 就只认它；auto 时按 plugin → remote → offline 顺序 */
function order() {
  const p = configuredProvider();
  if (p !== "auto") return [p];
  return [PLUGIN_PROVIDER, "remote", "offline"];
}

/** 同步探一眼：这个环境有没有可用的朗读通道。不做网络请求，随时可调。 */
function env() {
  return {
    audio: typeof wx.createInnerAudioContext === "function",
    plugin: typeof wx.getPlugin === "function",
    request: typeof wx.request === "function"
  };
}

function needPlugin() {
  const e = env();
  return !e.audio || !e.plugin;
}

/**
 * 朗读可用性。**同步**，因为界面要在渲染时就决定显不显示播放按钮。
 * @returns {{visible:boolean, usable:boolean, state:string, reason:string}}
 *   visible false —— 没有朗读能力，界面里不该出现任何播放元素
 *   usable  false —— 该显示，但还不能播（灰着，点了给一句人话）
 */
function readiness() {
  const e = env();

  // 门禁优先：未登录 / 档位不含，就是没有这项能力，跟通道无关。
  // 界面据此整块不渲染 —— 不是灰着，是根本不存在。
  if (!entitlement.can("speak")) {
    return { visible: false, usable: false, state: "denied", reason: entitlement.hint("speak") };
  }

  if (!e.audio) {
    return { visible: false, usable: false, state: "unsupported", reason: "当前环境不支持播放音频" };
  }

  if (needPlugin()) {
    return { visible: true, usable: false, state: "awaiting", reason: "朗读通道待接入，音频接口当前不可用" };
  }

  const provider = resolveProvider();
  if (provider === "remote") {
    const remote = require("./remote");
    if (!remote.speechReady()) {
      return { visible: true, usable: false, state: "awaiting", reason: "后端 TTS 未配置，朗读暂不可用" };
    }
  }

  return { visible: true, usable: true, state: "ready", reason: "", provider };
}

/** auto 时挑一个真的能用的：同声传译插件优先，没有就看远端 */
function resolveProvider() {
  const p = configuredProvider();
  if (p !== "auto") return p;

  const remote = require("./remote");
  if (env().plugin && !needPlugin()) return PLUGIN_PROVIDER;
  if (remote.speechReady()) return "remote";
  return PLUGIN_PROVIDER;
}

/* ---------- 合成与播放 ---------- */

function plugin() {
  return wx.getPlugin ? wx.getPlugin("WechatSI", PLUGIN_VERSION) : null;
}

function synthViaPlugin(text, opt) {
  return new Promise((resolve, reject) => {
    const p = plugin();
    if (!p || !p.textToSpeech) {
      reject(new Error("同声传译插件未就绪"));
      return;
    }
    p.textToSpeech({
      lang: "zh_CN",
      tts: true,
      content: normalize(text),
      success: (res) => {
        if (res && res.filename) resolve({ url: res.filename, provider: PLUGIN_PROVIDER });
        else reject(new Error("合成没返回音频"));
      },
      fail: (err) => reject(new Error((err && err.msg) || "合成失败"))
    });
  });
}

/** 远端 TTS：整句合成一次拿 mp3，不逐字合成 —— 逐字会把 QPS 烧光 */
function synthViaRemote(text) {
  const remote = require("./remote");
  return remote.speech(normalize(text)).then((res) => ({ url: res.url, provider: "remote" }));
}

/* ---------- 播放器 ---------- */

/**
 * 一个页面一个播放器。朗读不是背景音，页面走了就该停。
 */
function createPlayer() {
  const audio = wx.createInnerAudioContext();
  audio.obeyMuteSwitch = false;
  return audio;
}

function create(opt) {
  const cfg = opt || {};
  const state = {
    loading: false,
    playing: false,
    paused: false,
    index: 0,
    total: 0,
    provider: "",
    timer: null
  };

  let audio = null;
  let queued = [];

  function emit() {
    if (cfg.onChange) {
      cfg.onChange({
        loading: state.loading,
        playing: state.playing,
        paused: state.paused,
        index: state.index,
        total: state.total,
        provider: state.provider,
        label: state.label || ""
      });
    }
  }

  /**
   * 合成。先查缓存：合成要钱也可能要 QPS，同一句诗不该合两次。
   * 缓存键按 provider 分开 —— 换通道时音色变了，不能拿旧音频冒充。
   */
  function synthesize(text) {
    const provider = resolveProvider();
    const cacheKey = provider + "_" + keyOf(text);
    const cached = store.read(cacheKey, "");
    if (cached) return Promise.resolve({ url: cached, provider: provider, cached: true });

    const job = provider === "remote" ? synthViaRemote(text) : synthViaPlugin(text);
    return job.then((res) => {
      if (res && res.url) store.write(cacheKey, res.url);
      return res;
    });
  }

  function playUrl(url) {
    return new Promise((resolve) => {
      if (!url) {
        resolve(false);
        return;
      }
      audio = audio || createPlayer();
      audio.offEnded && audio.offEnded();
      audio.offError && audio.offError();
      audio.onEnded(() => resolve(true));
      audio.onError(() => resolve(false));
      audio.src = url;
      audio.play();
    });
  }

  function stopTimer() {
    if (state.timer) clearInterval(state.timer);
    state.timer = null;
  }

  function play(index) {
    if (!queued.length) return Promise.resolve();
    state.index = Math.max(0, Math.min(queued.length - 1, index));
    state.loading = true;
    state.playing = false;
    emit();

    const item = queued[state.index];
    return synthesize(item.text)
      .then((res) => {
        state.provider = res.provider;
        state.loading = false;
        state.paused = false;
        state.playing = true;
        emit();
        return playUrl(res.url);
      })
      .then((ended) => {
        state.playing = false;
        emit();
        if (!ended) return;
        if (state.index + 1 < queued.length) {
          const gap = Math.max(0, Number(item.gap) || 0);
          if (gap) {
            state.timer = setTimeout(() => play(state.index + 1), gap);
          } else {
            play(state.index + 1);
          }
        } else if (cfg.onFinish) {
          cfg.onFinish();
        }
      })
      .catch((err) => {
        state.loading = false;
        state.playing = false;
        emit();
        if (cfg.onError) cfg.onError(err);
      });
  }

  return {
    /** 排一串句子，每句之间按 gap 毫秒停顿 */
    load(lines) {
      queued = (lines || [])
        .map((l) => (typeof l === "string" ? { text: l, gap: 0 } : l))
        .filter((l) => normalize(l.text).length > 0);
      state.total = queued.length;
      state.index = 0;
      emit();
      return this;
    },
    start() {
      return play(state.index);
    },
    toggle(lineIndex) {
      if (typeof lineIndex === "number" && lineIndex !== state.index) return play(lineIndex);
      if (state.playing) return this.pause();
      if (state.paused) return this.resume();
      return play(state.index);
    },
    pause() {
      stopTimer();
      if (audio) audio.pause();
      state.playing = false;
      state.paused = true;
      emit();
    },
    resume() {
      if (!audio) return play(state.index);
      audio.play();
      state.playing = true;
      state.paused = false;
      emit();
    },
    next() {
      if (state.index + 1 < queued.length) play(state.index + 1);
    },
    prev() {
      if (state.index > 0) play(state.index - 1);
    },
    /**
     * 跳到第几句。与 toggle(i) 的差别在语义：toggle 是「点这一句」，
     * 用户手指按下的那一刻就认这个目标；seek 是「拖进度条」，
     * 拖到当前正在播的那一句上不该把音频掐了重来。
     */
    seek(lineIndex) {
      if (!queued.length) return;
      const i = Math.max(0, Math.min(queued.length - 1, Number(lineIndex) || 0));
      if (i === state.index) return;
      play(i);
    },
    stop() {
      stopTimer();
      try {
        if (audio) audio.stop();
      } catch (e) {
        /* 停下失败不值得打断用户 */
      }
      state.playing = false;
      state.paused = false;
      emit();
    },
    destroy() {
      stopTimer();
      try {
        if (audio) audio.destroy();
      } catch (e) {
        /* 同上 */
      }
      audio = null;
    },
    state() {
      return state;
    }
  };
}

module.exports = {
  normalize,
  keyOf,
  readiness,
  resolveProvider,
  create,
  prefs,
  savePrefs,
  PLUGIN_VERSION
};
