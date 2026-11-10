"use strict";

const fs = require("fs");
const path = require("path");

const OUT = path.join(__dirname, "..", "deploy", "sql", "appearance.sql");

const theme = require(path.join(__dirname, "..", "miniprogram", "utils", "theme.js"));
const font = require(path.join(__dirname, "..", "miniprogram", "utils", "font.js"));

const quote = (v) => "'" + String(v).split("\\").join("\\\\").split("'").join("''") + "'";

function bannerName(url) {
  return String(url || "").split("/").pop();
}

function themeRows() {
  return theme.all().map((t, i) => "  (" + [
    quote(t.key),
    quote(t.name),
    t.rgb[0],
    t.rgb[1],
    t.rgb[2],
    quote(bannerName(t.banner)),
    quote(t.group),
    i
  ].join(", ") + ")");
}

function fontRows() {
  return font.faces().map((f, i) => "  (" + [
    quote(f.key),
    quote(f.name),
    quote(f.note),
    quote(f.dir),
    i
  ].join(", ") + ")");
}

const body = ""
  + "SET NAMES utf8mb4;\n\n"
  + "START TRANSACTION;\n\n"
  + "INSERT INTO `theme_swatches` (`key`, `name`, `rgb_r`, `rgb_g`, `rgb_b`, `banner`, `group_key`, `pos`) VALUES\n"
  + themeRows().join(",\n")
  + "\nON DUPLICATE KEY UPDATE `name` = VALUES(`name`), `rgb_r` = VALUES(`rgb_r`),"
  + " `rgb_g` = VALUES(`rgb_g`), `rgb_b` = VALUES(`rgb_b`), `banner` = VALUES(`banner`),"
  + " `group_key` = VALUES(`group_key`), `pos` = VALUES(`pos`);\n\n"
  + "INSERT INTO `font_faces` (`key`, `name`, `note`, `dir`, `pos`) VALUES\n"
  + fontRows().join(",\n")
  + "\nON DUPLICATE KEY UPDATE `name` = VALUES(`name`), `note` = VALUES(`note`),"
  + " `dir` = VALUES(`dir`), `pos` = VALUES(`pos`);\n\n"
  + "COMMIT;\n";

const head = ""
  + "-- 主题与字体清单的初始值：theme_swatches / font_faces 两张表\n"
  + "-- 由 node scripts/gen-appearance-sql.js 从 utils/theme.js 与 utils/font.js 里那份初始清单生成\n"
  + "-- 只在初始化时灌一次；之后改库即改线上，重跑这份 SQL 会把库里手工改过的行冲回去\n"
  + "-- 题图只存文件名（目录在 utils/theme.js 的 THEME_BANNER_BASE），字体子集只存目录名\n"
  + "-- 执行前先切库\n\n";

fs.writeFileSync(OUT, head + body);

console.log("主题 " + theme.all().length + " 项 / 字体 " + font.faces().length + " 款 → "
  + path.relative(process.cwd(), OUT));
