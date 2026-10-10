const store = require("./store");
const entitlement = require("./entitlement");

const PLUGIN_PROVIDER = "plugin";
const PLUGIN_VERSION = "0.3.6";

function normalize(text) {
  return String(text || "")
    .replace(/\s+/g, "")
    .trim();
}

function keyOf(text) {

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

function order() {
  const p = configuredProvider();
  if (p !== "auto") return [p];
  return [PLUGIN_PROVIDER, "remote", "offline"];
}

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

function readiness() {
  const e = env();

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
      return { visible: true, usable: false, state: "awaiting", reason: "朗读服务未开通，暂时只能看字" };
    }
  }

  return { visible: true, usable: true, state: "ready", reason: "", provider };
}

function resolveProvider() {
  const p = configuredProvider();
  if (p !== "auto") return p;

  const remote = require("./remote");
  if (env().plugin && !needPlugin()) return PLUGIN_PROVIDER;
  if (remote.speechReady()) return "remote";
  return PLUGIN_PROVIDER;
}

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

function synthViaRemote(text) {
  const remote = require("./remote");
  return remote.speech(normalize(text)).then((res) => ({ url: res.url, provider: "remote" }));
}

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
