"use strict";

var handler = require("../_lib/handler");

var DEFAULT_BANNER = "hero.png";

var KEY = /^[a-z0-9_-]{1,48}$/;

var FILE = /^[A-Za-z0-9._-]{1,128}$/;

function base(v) {
  var s = String(v || "");
  return s && s.charAt(s.length - 1) === "/" ? s : s + "/";
}

function theme(row, cfg) {
  if (!row || !KEY.test(String(row.key || ""))) return null;
  var rgb = Array.isArray(row.rgb) ? row.rgb.map(Number) : [];
  if (rgb.length !== 3 || rgb.some(function (v) { return !Number.isInteger(v) || v < 0 || v > 255; })) return null;
  var group = String(row.group || "");
  if (group !== "tradition" && group !== "landscape") return null;
  var file = String(row.banner || "");
  return {
    key: String(row.key),
    name: String(row.name || ""),
    rgb: rgb,
    group: group,
    banner: base(cfg.themeBannerBase) + (FILE.test(file) ? file : DEFAULT_BANNER)
  };
}

function font(row, cfg) {
  if (!row || !KEY.test(String(row.key || ""))) return null;
  var dir = String(row.dir || "");
  if (!FILE.test(dir)) return null;
  return {
    key: String(row.key),
    name: String(row.name || ""),
    note: String(row.note || ""),
    dir: dir,
    base: base(cfg.fontBase) + dir + "/"
  };
}

function pick(rows, shape, cfg) {
  var out = [];
  var seen = {};
  (rows || []).forEach(function (row) {
    var hit = shape(row, cfg);
    if (!hit || seen[hit.key]) return;
    seen[hit.key] = true;
    out.push(hit);
  });
  return out;
}

module.exports = handler.make("appearance", ["GET"], function (d) {
  return Promise.all([
    Promise.resolve(d.store.listThemeSwatches()).catch(function () { return []; }),
    Promise.resolve(d.store.listFontFaces()).catch(function () { return []; })
  ]).then(function (both) {
    return {
      status: 200,
      body: {
        themes: pick(both[0], theme, d.cfg),
        fonts: pick(both[1], font, d.cfg)
      },
      headers: { "Cache-Control": "public, max-age=300" }
    };
  });
});
