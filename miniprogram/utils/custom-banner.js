const store = require("./store");
const crop = require("./banner-crop");

const MIME = /^data:image\//;

const JPEG = "data:image/jpeg;base64,";

const WEBP = "data:image/webp;base64,";

const PNG = "data:image/png;base64,";

const WIDTH = 1200;

const QUALITY = 0.72;

const FADE_SPAN = 80;

const FADE_REF = 1200;

const FADE_CURVE = 1.8;

const FADE_OPAQUE = 0.35;

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

function artOf(img, box) {
  const sw = Math.max(1, Math.round(img.w * box.sw));
  return {
    sx: Math.round(img.w * box.sx),
    sy: Math.round(img.h * box.sy),
    sw: sw,
    sh: Math.max(1, Math.round(img.h * box.sh)),
    width: Math.min(WIDTH, sw),
    height: Math.max(1, Math.round(Math.min(WIDTH, sw) * RATIO_H / RATIO_W))
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

function fadePixels(art) {
  return Math.max(1, Math.round(art.width * FADE_SPAN / FADE_REF));
}

function fadeAt(y, height, deep) {
  const t = (y - (height - deep)) / deep;
  return Math.pow(1 - Math.max(0, Math.min(1, t)), FADE_CURVE);
}

function layerOf(width, height) {
  try {
    return typeof wx.createOffscreenCanvas === "function"
      ? wx.createOffscreenCanvas({ type: "2d", width: width, height: height })
      : null;
  } catch (e) {
    return null;
  }
}

function dropped(ctx, art, height) {
  const deep = fadePixels(art);
  const data = ctx.getImageData(0, height - deep, art.width, deep).data;
  let solid = 0;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] > 250) solid += 1;
  }
  const total = data.length / 4;
  return total ? solid / total < FADE_OPAQUE : false;
}

function fade(canvas, ctx, art) {
  const deep = fadePixels(art);
  const height = art.height;
  const top = height - deep;
  const pixels = ctx.getImageData(0, top, art.width, deep);
  const buffer = new Uint8ClampedArray(pixels.data);
  for (let y = 0; y < deep; y += 1) {
    const alpha = fadeAt(top + y, height, deep);
    for (let x = 0; x < art.width; x += 1) {
      buffer[(y * art.width + x) * 4 + 3] = Math.round(buffer[(y * art.width + x) * 4 + 3] * alpha);
    }
  }
  pixels.data.set(buffer);
  const layer = layerOf(art.width, deep);
  if (layer) {
    try {
      const lctx = layer.getContext("2d");
      lctx.putImageData(pixels, 0, 0);
      ctx.clearRect(0, top, art.width, deep);
      ctx.drawImage(layer, 0, 0, art.width, deep, 0, top, art.width, deep);
      if (dropped(ctx, art, height)) return exportTemp(canvas, art, "webp");
    } catch (e) {
      ctx.putImageData(pixels, 0, top);
      return Promise.resolve("");
    }
  }
  ctx.putImageData(pixels, 0, top);
  return Promise.resolve("");
}

function artwork(canvas, image, art, fileType) {
  canvas.width = art.width;
  canvas.height = art.height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, art.width, art.height);
  ctx.drawImage(image, art.sx, art.sy, art.sw, art.sh, 0, 0, art.width, art.height);
  return fade(canvas, ctx, art).then((file) => file || exportTemp(canvas, art, fileType))
    .then((file) => file || dataUrl(canvas, fileType));
}

function draw(canvas, source, art, fileType) {
  return new Promise((resolve) => {
    const image = canvas.createImage();
    image.onload = () => artwork(canvas, image, art, fileType).then(resolve, () => resolve(""));
    image.onerror = () => resolve("");
    image.src = source;
  });
}

async function prepare(path, img, host, id, box) {
  try {
    const art = artOf(img, box);
    const keep = Math.min(1, art.width / art.sw);
    const small = await shrink(path, img.w * keep, img.h * keep);
    const source = small.tempFilePath || path;
    const size = await photo(source).then(
      (info) => ({ w: Number(info.width) || img.w, h: Number(info.height) || img.h }),
      () => img
    );
    const fx = size.w / img.w;
    const fy = size.h / img.h;
    const fitted = Object.assign({}, art, {
      sx: art.sx * fx,
      sy: art.sy * fy,
      sw: art.sw * fx,
      sh: art.sh * fy
    });
    const canvas = await node(host, id);
    if (!canvas) return "";
    const jpeg = await draw(canvas, source, fitted, "jpg");
    if (jpeg) return jpeg;
    return draw(canvas, source, fitted, "png");
  } catch (e) {
    return "";
  }
}

async function put(path, img, host, id, box) {
  const file = await prepare(path, img, host, id, crop.clampBox(box));
  if (!file) return { ok: false, reason: "read" };
  const data = MIME.test(file) ? file : await read(file).catch(() => "");
  if (data.length <= PNG.length) return { ok: false, reason: "read" };
  if (!store.saveSettings({ banner: data })) return { ok: false, reason: "storage" };
  return { ok: true };
}

function clear() {
  return store.saveSettings({ banner: "" });
}

function src() {
  const v = store.settings().banner;
  return typeof v === "string" && MIME.test(v) ? v : "";
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

module.exports = { src, put, clear, choose, suggest, artOf, fadePixels, fadeAt, FADE_SPAN, FADE_REF, MIME, JPEG, PNG, WEBP, WIDTH, RATIO_W, RATIO_H };
