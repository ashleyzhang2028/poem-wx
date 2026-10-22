const store = require("./store");

const IMAGE = "data:image/jpeg;base64,";

const WIDTH = 1200;

const RATIO = 916 / 1717;

async function prepare(path) {
  try {
    const info = await new Promise((resolve, reject) => {
      wx.getImageInfo({ src: path, success: resolve, fail: reject });
    });
    const width = Math.min(WIDTH, Number(info.width) || WIDTH);
    const height = Math.round(width / RATIO);
    const res = await new Promise((resolve, reject) => {
      wx.compressImage({
        src: path,
        quality: 72,
        compressedWidth: width,
        compressedHeight: height,
        success: resolve,
        fail: reject
      });
    });
    return res.tempFilePath || "";
  } catch (e) {
    return "";
  }
}

function read(file) {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().readFile({
      filePath: file,
      encoding: "base64",
      success: (res) => resolve(IMAGE + String(res.data || "")),
      fail: reject
    });
  });
}

async function put(path) {
  const file = await prepare(path);
  if (!file) return { ok: false, reason: "read" };
  const data = await read(file).catch(() => "");
  if (data.length <= IMAGE.length) return { ok: false, reason: "read" };
  if (!store.saveSettings({ banner: data })) return { ok: false, reason: "storage" };
  return { ok: true };
}

function clear() {
  return store.saveSettings({ banner: "" });
}

function src() {
  const v = store.settings().banner;
  return typeof v === "string" && v.indexOf(IMAGE) === 0 ? v : "";
}

function pick() {
  return new Promise((resolve) => {
    wx.chooseMedia({
      count: 1,
      mediaType: ["image"],
      sourceType: ["album", "camera"],
      sizeType: ["original"],
      success: (res) => {
        const file = res && res.tempFiles && res.tempFiles[0];
        const path = (file && (file.tempFilePath || file.path)) || "";
        if (!path) {
          resolve({ ok: false, reason: "choose" });
          return;
        }
        put(path).then(resolve, () => resolve({ ok: false, reason: "read" }));
      },
      fail: () => resolve({ ok: false, reason: "cancel" })
    });
  });
}

module.exports = { src, put, clear, pick, IMAGE, WIDTH, RATIO };
