const corpus = require("./corpus");
const entitlement = require("./entitlement");
const icons = require("./icons");

const BASE = "https://706f-poem-d9g1bqeq978682c58-1502724481.tcb.qcloud.la/audio/poem/";

const MODES = [
  { key: "repeat", icon: icons.repeat, label: "顺序播放" },
  { key: "one", icon: icons.repeatOne, label: "单首循环" },
  { key: "shuffle", icon: icons.shuffle, label: "随机播放" }
];

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
  return files()[String(id || "")] || "";
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
  const head = String(bookId) + "-";
  const out = Object.keys(files()).filter((id) => id.indexOf(head) === 0);
  bookCache[bookId] = out;
  return out;
}

function supported() {
  return typeof wx !== "undefined" && typeof wx.createInnerAudioContext === "function";
}

function usable() {
  return supported() && entitlement.can("audio");
}

function readiness() {
  if (!supported()) {
    return { visible: false, usable: false, state: "unsupported", reason: "这台设备出不了声" };
  }
  if (!entitlement.can("audio")) {
    return { visible: false, usable: false, state: "denied", reason: "诗词音频 " + entitlement.tierOf("audio") + " 起可用" };
  }
  return { visible: true, usable: true, state: "ready", reason: "" };
}

let ctx = null;
let queue = [];
let index = 0;
let mode = "repeat";
let playing = false;
let listeners = [];

function ensure() {
  if (ctx || !supported()) return ctx;
  ctx = wx.createInnerAudioContext();
  ctx.autoplay = false;
  ctx.onEnded(() => onEnded());
  ctx.onError(() => onEnded());
  ctx.onPlay(() => paint(true));
  ctx.onPause(() => paint(false));
  ctx.onStop(() => paint(false));
  return ctx;
}

function paint(on) {
  if (playing === on) return;
  playing = on;
  emit();
}

function load(play) {
  const c = ensure();
  const id = queue[index];
  if (!c || !id) return false;
  c.src = urlOf(id);
  if (play) c.play();
  return true;
}

function source() {
  const c = ensure();
  return c;
}

function modeOf(key) {
  return MODES.find((m) => m.key === key) || MODES[0];
}

function step(by) {
  if (!queue.length) return 0;
  if (mode === "shuffle" && queue.length > 1) {
    let next = index;
    while (next === index) next = Math.floor(Math.random() * queue.length);
    return next;
  }
  return (index + by + queue.length) % queue.length;
}

function drop() {
  const c = ensure();
  queue = [];
  index = 0;
  playing = false;
  if (c) {
    c.stop();
    c.src = "";
  }
}

function onEnded() {
  if (!queue.length) return;
  if (mode !== "one" && queue.length === 1) {
    drop();
    emit();
    return;
  }
  if (mode === "one") {
    source().seek(0);
    source().play();
    emit();
    return;
  }
  index = step(1);
  load(true);
  emit();
}

function start(ids, id) {
  if (!usable()) return false;
  const list = matched(ids);
  if (!list.length) return false;
  queue = list;
  const at = list.indexOf(String(id || ""));
  index = at >= 0 ? at : 0;
  load(true);
  emit();
  return true;
}

function toggle() {
  const c = ensure();
  if (!c || !queue.length) return false;
  if (playing) c.pause();
  else c.play();
  return true;
}

function next() {
  if (!queue.length) return false;
  index = step(1);
  load(true);
  return true;
}

function prev() {
  if (!queue.length) return false;
  index = step(-1);
  load(true);
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
  emit();
  return mode;
}

function titleOf(id) {
  const meta = id ? corpus.indexById(id) : null;
  return (meta && meta.t) || "";
}

function status() {
  const op = usable();
  if (!op && queue.length) drop();
  const id = queue[index] || "";
  const nextId = queue.length > 1 ? queue[(index + 1) % queue.length] : "";
  return {
    open: op && queue.length > 0,
    id: id,
    title: titleOf(id),
    nextTitle: mode === "shuffle" ? "" : titleOf(nextId),
    playing: playing,
    mode: mode,
    modeIcon: modeOf(mode).icon,
    modeLabel: modeOf(mode).label,
    playIcon: playing ? icons.pause : icons.play,
    prevIcon: icons.stepBack,
    nextIcon: icons.stepForward,
    stopIcon: icons.stop
  };
}

function emit() {
  const s = status();
  listeners.slice().forEach((fn) => fn(s));
}

function watch(fn) {
  if (typeof fn === "function" && listeners.indexOf(fn) < 0) listeners.push(fn);
}

function unwatch(fn) {
  const at = listeners.indexOf(fn);
  if (at >= 0) listeners.splice(at, 1);
}

module.exports = {
  BASE,
  MODES,
  fileOf,
  urlOf,
  has,
  matched,
  bookIds,
  supported,
  usable,
  readiness,
  start,
  toggle,
  next,
  prev,
  stop,
  cycle,
  status,
  watch,
  unwatch,
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
