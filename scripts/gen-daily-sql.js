"use strict";

const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "corpus", "data", "site-daily.js");
const OUT = path.join(__dirname, "..", "deploy", "sql", "daily-poems.sql");

global.window = {};
require(SRC);
const pool = global.window.SITE_DAILY || [];

const bad = pool.filter((x) => !Array.isArray(x) || x.length !== 4 || x.slice(0, 2).some((v) => !v));
if (!pool.length || bad.length) {
  throw new Error("每日一诗候选池为空，或有 " + bad.length + " 条不是「题名、作者、朝代、来源」四项");
}

const quote = (v) => "'" + String(v).split("\\").join("\\\\").split("'").join("''") + "'";

const rows = pool.map((x, i) => "  (" + [i, quote(x[0]), quote(x[1]), quote(x[2])].join(", ") + ")");

fs.writeFileSync(
  OUT,
  "DELETE FROM `daily_poems`;\n" +
    "INSERT INTO `daily_poems` (`pos`, `title`, `author`, `dynasty`) VALUES\n" +
    rows.join(",\n") + ";\n"
);
console.log("每日一诗 " + pool.length + " 首 → " + path.relative(process.cwd(), OUT));
