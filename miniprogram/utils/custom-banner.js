const store = require("./store");
const crop = require("./banner-crop");

const MIME = "data:image/";

const JPEG = "data:image/jpeg;base64,";

const PNG = "data:image/png;base64,";

const WIDTH = 1200;

const TALL = 2400;

const QUALITY = 0.72;

const SCALE = 4;

const RATIO_W = crop.RATIO_W;

const RATIO_H = crop.RATIO_H;

function photo(path) {
  return new Promise((resolve, reject) => {
    wx.getImageInfo({ src: path, success: resolve, fail: reject });
  });
}

function shrink(path, width, height) {
  if (!width || !height) return Promise.resolve({ tempFilePath: path });
  return new Promise((resolve) => {
    wx.compressImage({
      src: path,
      quality: 100,
      compressedWidth: Math.round(width),
      compressedHeight: Math.round(height),
      success: (res) => resolve(res),
      fail: () => resolve({ tempFilePath: path })
    });
  });
}

function node(host, id) {
  return new Promise((resolve, reject) => {
    wx.createSelectorQuery().in(host).select("#" + id).node({ node: true, size: true })
      .exec((res) => {
        const field = res && res[0];
        if (field && field.node) resolve(field.node);
        else reject(new Error("no canvas"));
      });
  });
}

function pixels(host, id, src, width, height) {
  return node(host, id).then((canvas) => new Promise((resolve, reject) => {
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    const img = canvas.createImage();
    img.onload = () => {
      ctx.drawImage(img, 0, 0, width, height);
      resolve(ctx.getImageData(0, 0, width, height).data);
    };
    img.onerror = () => reject(new Error("no image"));
    img.src = src;
  }));
}

function read(file) {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().readFile({
      filePath: file,
      encoding: "base64",
      success: (res) => resolve(JPEG + String(res.data || "")),
      fail: reject
    });
  });
}

function artOf(img, box, scale) {
  const fit = Math.min(WIDTH / (img.w * box.sw * scale), TALL / (img.h * box.sh * scale));
  const width = Math.max(1, Math.round(img.w * box.sw * scale * Math.min(1, fit)));
  return {
    sx: Math.round(img.w * box.sx),
    sy: Math.round(img.h * box.sy),
    sw: Math.max(1, Math.round(img.w * box.sw)),
    sh: Math.max(1, Math.round(img.h * box.sh)),
    width: width,
    height: Math.max(1, Math.round(width * RATIO_H / RATIO_W))
  };
}

function exportTemp(canvas, art, fileType) {
  return new Promise((resolve) => {
    wx.canvasToTempFilePath({
      canvas: canvas,
      x: 0,
      y: 0,
      width: art.width,
      height: art.height,
      destWidth: art.width,
      destHeight: art.height,
      fileType: fileType,
      quality: QUALITY,
      success: (r) => resolve(r.tempFilePath || dataUrl(canvas, fileType)),
      fail: () => resolve("")
    });
  });
}

function dataUrl(canvas, fileType) {
  try {
    return typeof canvas.toDataURL === "function" ? canvas.toDataURL("image/" + fileType) : "";
  } catch (e) {
    return "";
  }
}

function artwork(canvas, image, art, fileType) {
  canvas.width = art.width;
  canvas.height = art.height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, art.width, art.height);
  ctx.drawImage(image, art.sx, art.sy, art.sw, art.sh, 0, 0, art.width, art.height);
  return exportTemp(canvas, art, fileType).then((file) => file || dataUrl(canvas, fileType));
}

function draw(canvas, source, art, fileType) {
  return new Promise((resolve) => {
    const image = canvas.createImage();
    image.onload = () => artwork(canvas, image, art, fileType).then(resolve, () => resolve(""));
    image.onerror = () => resolve("");
    image.src = source;
  });
}

async function prepare(path, img, host, id, box, scale) {
  try {
    const art = artOf(img, box, scale);
    const small = await shrink(path, img.w * scale / SCALE, img.h * scale / SCALE);
    const canvas = await node(host, id);
    if (!canvas) return "";
    const source = small.tempFilePath || path;
    const jpeg = await draw(canvas, source, art, "jpg");
    if (jpeg) return jpeg;
    return draw(canvas, source, art, "png");
  } catch (e) {
    return "";
  }
}

async function put(path, img, host, id, box, scale) {
  const file = await prepare(path, img, host, id, crop.clampBox(box), scale);
  if (!file) return { ok: false, reason: "read" };
  const data = file.indexOf(MIME) === 0 ? file : await read(file).catch(() => "");
  if (data.length <= PNG.length) return { ok: false, reason: "read" };
  if (!store.saveSettings({ banner: data })) return { ok: false, reason: "storage" };
  return { ok: true };
}

function clear() {
  return store.saveSettings({ banner: "" });
}

function src() {
  const v = store.settings().banner;
  return typeof v === "string" && v.indexOf(MIME) === 0 ? v : "";
}

function choose() {
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
        photo(path).then((info) => {
          const img = { w: Number(info.width) || 0, h: Number(info.height) || 0 };
          if (!img.w || !img.h) {
            resolve({ ok: false, reason: "read" });
            return;
          }
          resolve({ ok: true, path: path, img: img });
        }, () => resolve({ ok: false, reason: "read" }));
      },
      fail: () => resolve({ ok: false, reason: "cancel" })
    });
  });
}

function suggest(img, box) {
  const scale = RATIO_W * img.h / (RATIO_H * img.w);
  return Promise.resolve({ box: crop.clampBox(box), scale: Math.min(1, scale) });
}

module.exports = { src, put, clear, choose, suggest, artOf, MIME, JPEG, PNG, WIDTH, RATIO_W, RATIO_H };
