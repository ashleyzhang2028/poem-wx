const corpus = require("./corpus");
const entitlement = require("./entitlement");
const icons = require("./icons");

const HOST = "https://706f-poem-d9g1bqeq978682c58-1502724481.tcb.qcloud.la/audio/";
const BASE = HOST + "poem/";
const COVER = HOST + "cover/apic.jpg";

const MODES = [
  { key: "order", icon: icons.repeat, label: "顺序播放", on: false },
  { key: "repeat", icon: icons.repeat, label: "列表循环", on: true },
  { key: "one", icon: icons.repeatOne, label: "单首循环", on: true },
  { key: "shuffle", icon: icons.shuffle, label: "随机一遍", on: false },
  { key: "shuffleRepeat", icon: icons.shuffle, label: "随机循环", on: true }
];

const NOTICE_UPLOADING = "音频文件添加中";
const NOTICE_OFFLINE = "网络不给力，稍后再试";

const OFFLINE_ERR = [10001, 10002];

let table = null;

function files() {
  if (!table) {
    try {
      table = require("../data/audio.js");
    } catch (e) {
      table = {};
    }
  }
  return table;
}

function fileOf(id) {
  const key = String(id || "");
  if (!key) return "";
  if (corpus.hasData()) return corpus.audioFile(key);
  return files()[key] || "";
}

function has(id) {
  return !!fileOf(id);
}

function urlOf(id) {
  const file = fileOf(id);
  return file ? BASE + file : "";
}

function matched(ids) {
  return (ids || []).filter(has);
}

const bookCache = {};

function bookIds(bookId) {
  if (!bookId) return [];
  if (bookCache[bookId]) return bookCache[bookId];
  const out = corpus.ofBook(bookId).map((p) => p.id).filter((id) => !!corpus.audioFile(id));
  bookCache[bookId] = out.concat(packedIds(bookId, out));
  return bookCache[bookId];
}

function packedIds(bookId, known) {
  const head = String(bookId) + "-";
  return Object.keys(files()).filter((id) => id.indexOf(head) === 0 && known.indexOf(id) < 0);
}

function shelfId(bookId) {
  const meta = corpus.bookById(bookId);
  return (meta && meta.shelf) || bookId;
}

function shelf(bookId) {
  const known = bookIds(bookId);
  const set = new Set(known);
  const ids = Object.keys(files()).filter((id) => set.has(id)).concat(known);
  return {
    id: shelfId(bookId),
    ids: ids,
    count: ids.length,
    filled: ids.length > 0,
    state: corpus.hasData() ? "ready" : "pending"
  };
}

function inner() {
  return typeof wx !== "undefined" && typeof wx.createInnerAudioContext === "function";
}

function background() {
  return typeof wx !== "undefined" && typeof wx.getBackgroundAudioManager === "function";
}

function supported() {
  return inner() || background();
}

function usable() {
  return supported() && entitlement.can("audio");
}

function loopable() {
  return supported() && entitlement.can("audioloop");
}

function readiness(kind) {
  if (!supported()) {
    return { visible: false, usable: false, state: "unsupported", reason: "这台设备出不了声" };
  }
  if (!entitlement.can("audio")) {
    return { visible: false, usable: false, state: "denied", reason: "诗词音频 " + entitlement.tierOf("audio") + " 起可用" };
  }
  if (kind === "list" && !entitlement.can("audioloop")) {
    return { visible: false, usable: false, state: "denied", reason: "连续播放 " + entitlement.tierOf("audioloop") + " 起可用" };
  }
  return { visible: true, usable: true, state: "ready", reason: "" };
}

let ctx = null;
let bg = null;
let queue = [];
let index = 0;
let mode = "order";
let deck = [];
let playing = false;
let looping = false;
let listeners = [];
let failed = {};
let progressListeners = [];
let percent = 0;

function setPercent(next) {
  if (next === percent) return;
  percent = next;
  progressListeners.slice().forEach((fn) => fn(percent));
}

function tick(box) {
  const total = box.duration;
  setPercent(total > 0 ? Math.min(100, Math.round(box.currentTime / total * 200) / 2) : 0);
}

function listen(box, live) {
  box.onEnded(() => onEnded());
  box.onError((err) => {
    if (live()) onFail(err);
  });
  box.onPlay(() => paint(true));
  box.onPause(() => paint(false));
  box.onStop(() => paint(false));
  if (box.onTimeUpdate) box.onTimeUpdate(() => { if (live()) tick(box); });
}

function ensure() {
  if (ctx || !supported() || !inner()) return ctx;
  ctx = wx.createInnerAudioContext();
  ctx.autoplay = false;
  listen(ctx, () => !looping);
  return ctx;
}

function held() {
  return looping && bg ? bg : ensure();
}

function release() {
  if (!bg) return;
  bg.title = "";
}

function ensureBackground() {
  if (bg) return bg;
  if (!background()) return null;
  bg = wx.getBackgroundAudioManager();
  listen(bg, () => looping);
  return bg;
}

function sing(title) {
  const box = ensureBackground();
  if (!box) return ensure();
  if (ctx) {
    ctx.stop();
    ctx.src = "";
  }
  box.title = title || "诗词";
  box.epname = "诗词音频";
  return box;
}

function paint(on) {
  if (playing === on) return;
  playing = on;
  emit();
}

function emit() {
  const s = status();
  listeners.slice().forEach((fn) => fn(s));
}

function load(play) {
  const id = queue[index];
  if (!id) return false;
  const c = looping ? sing(titleOf(id)) : ensure();
  if (!c) return false;
  setPercent(0);
  if (c === bg) paint(false);
  c.src = urlOf(id);
  if (play) c.play();
  if (c === bg) {
    playing = !!play;
    emit();
  }
  return true;
}

function source() {
  return held();
}

function modeOf(key) {
  return MODES.find((m) => m.key === key) || MODES[0];
}

function randomOn() {
  return mode === "shuffle" || mode === "shuffleRepeat";
}

function endless() {
  return mode === "repeat" || mode === "one" || mode === "shuffleRepeat";
}

function refill() {
  deck = queue.filter((id) => id !== queue[index]);
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const at = Math.floor(Math.random() * (i + 1));
    const id = deck[at];
    deck[at] = deck[i];
    deck[i] = id;
  }
}

function draw() {
  if (!deck.length) {
    if (!endless()) return "";
    refill();
  }
  return deck.splice(Math.floor(Math.random() * deck.length), 1)[0] || "";
}

function randomOther() {
  if (queue.length < 2) return index;
  let next = index;
  while (next === index) next = Math.floor(Math.random() * queue.length);
  return next;
}

function advance() {
  if (randomOn()) {
    const id = draw();
    return id ? queue.indexOf(id) : -1;
  }
  const at = index + 1;
  return at < queue.length ? at : (endless() ? 0 : -1);
}

function upcoming() {
  if (mode === "one" || randomOn()) return "";
  if (index + 1 < queue.length) return queue[index + 1];
  return endless() ? queue[0] : "";
}

function stopSound() {
  if (bg) bg.stop();
  if (ctx) {
    ctx.stop();
    ctx.src = "";
  }
}

function drop() {
  queue = [];
  index = 0;
  deck = [];
  playing = false;
  looping = false;
  setPercent(0);
  stopSound();
  release();
}

function repeatHere() {
  const c = source();
  c.seek(0);
  c.play();
  emit();
}

function onEnded() {
  if (!queue.length) return;
  if (!looping) {
    drop();
    emit();
    return;
  }
  if (mode === "one" || queue.length === 1) {
    if (endless()) repeatHere();
    else {
      drop();
      emit();
    }
    return;
  }
  const at = advance();
  if (at < 0) {
    drop();
    emit();
    return;
  }
  index = at;
  load(true);
  emit();
}

function toast(text) {
  if (typeof wx !== "undefined" && typeof wx.showToast === "function") {
    wx.showToast({ title: text, icon: "none" });
  }
}

function offline(err) {
  return !!err && OFFLINE_ERR.indexOf(err.errCode) >= 0;
}

function following() {
  for (let i = 1; i <= queue.length; i += 1) {
    if (!randomOn() && !endless() && index + i >= queue.length) return -1;
    const at = (index + i) % queue.length;
    if (!failed[queue[at]]) return at;
  }
  return -1;
}

function onFail(err) {
  const id = queue[index];
  if (!id) return;
  failed[id] = true;
  toast(offline(err) ? NOTICE_OFFLINE : NOTICE_UPLOADING);
  const at = looping ? following() : -1;
  if (at < 0) {
    drop();
    emit();
    return;
  }
  index = at;
  load(true);
  emit();
}

function start(ids, id) {
  if (!loopable()) return false;
  const list = matched(ids);
  if (!list.length) return false;
  failed = {};
  queue = list;
  const at = list.indexOf(String(id || ""));
  index = at >= 0 ? at : 0;
  refill();
  looping = true;
  load(true);
  emit();
  return true;
}

function play(id) {
  if (!usable()) return false;
  const one = String(id || "");
  if (!has(one)) return false;
  failed = {};
  queue = [one];
  index = 0;
  deck = [];
  looping = false;
  if (bg) bg.stop();
  if (ctx) ctx.stop();
  load(true);
  emit();
  return true;
}

function toggle() {
  const c = held();
  if (!c || !queue.length) return false;
  const next = !playing;
  playing = next;
  if (playing) c.play();
  else c.pause();
  emit();
  return true;
}

function next() {
  if (!queue.length) return false;
  const at = advance();
  if (at < 0) return false;
  index = at;
  load(true);
  return true;
}

function prev() {
  if (!queue.length) return false;
  if (randomOn()) {
    index = randomOther();
  } else {
    const at = index - 1;
    index = at >= 0 ? at : (endless() ? queue.length - 1 : 0);
  }
  load(true);
  return true;
}

function seek(ratio) {
  const c = held();
  if (!c || !queue.length || !(c.duration > 0)) return false;
  const next = Math.max(0, Math.min(100, ratio));
  c.seek(c.duration * next / 100);
  setPercent(next);
  return true;
}

function stop() {
  if (!queue.length) return false;
  drop();
  emit();
  return true;
}

function cycle() {
  const at = MODES.findIndex((m) => m.key === mode);
  mode = MODES[(at + 1) % MODES.length].key;
  if (randomOn()) refill();
  emit();
  return mode;
}

function titleOf(id) {
  const meta = id ? corpus.indexById(id) : null;
  return (meta && meta.t) || "";
}

function status() {
  if (!usable() && queue.length) drop();
  const id = queue[index] || "";
  return {
    open: usable() && looping && queue.length > 0,
    id: id,
    title: titleOf(id),
    nextTitle: titleOf(upcoming()),
    cover: COVER,
    playing: playing,
    mode: mode,
    modeIcon: modeOf(mode).icon,
    modeLabel: modeOf(mode).label,
    modeOn: modeOf(mode).on,
    playIcon: playing ? icons.pause : icons.play,
    prevIcon: icons.stepBack,
    nextIcon: icons.stepForward,
    stopIcon: icons.stop
  };
}

function watch(fn) {
  if (typeof fn === "function" && listeners.indexOf(fn) < 0) listeners.push(fn);
}

function watchProgress(fn) {
  if (typeof fn !== "function" || progressListeners.indexOf(fn) >= 0) return;
  progressListeners.push(fn);
  fn(percent);
}

function unwatchProgress(fn) {
  const at = progressListeners.indexOf(fn);
  if (at >= 0) progressListeners.splice(at, 1);
}

function unwatch(fn) {
  const at = listeners.indexOf(fn);
  if (at >= 0) listeners.splice(at, 1);
}

module.exports = {
  BASE,
  COVER,
  MODES,
  NOTICE_UPLOADING,
  NOTICE_OFFLINE,
  fileOf,
  urlOf,
  has,
  matched,
  bookIds,
  shelf,
  supported,
  usable,
  loopable,
  readiness,
  start,
  play,
  toggle,
  next,
  prev,
  seek,
  stop,
  cycle,
  status,
  watch,
  unwatch,
  watchProgress,
  unwatchProgress,
  icons: {
    play: icons.play,
    pause: icons.pause,
    stop: icons.stop,
    stepBack: icons.stepBack,
    stepForward: icons.stepForward,
    featured: icons.featured,
    repeat: icons.repeat,
    repeatOne: icons.repeatOne,
    shuffle: icons.shuffle
  }
};
