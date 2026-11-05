"use strict";

const fs = require("fs");
const path = require("path");
const seed = require("./corpus-seed");

const CORPUS_DIR = seed.CORPUS_DIR;
const OUT_DIR = path.join(__dirname, "..", "miniprogram", "data");

const STALE = ["texts", "shards.js", "books", "roster-extra.js"];

const SERVER_FILE = path.join(__dirname, "..", "miniprogram", "utils", "server.js");

const SERVER_KEYS = ["env", "service"];

const TRANSLATION_SOURCES = {
  academic: "依据《唐诗鉴赏辞典》《宋词鉴赏辞典》等工具书的通行讲法",
  school: "依据统编版教材与教师用书课后释义",
  "public-domain": "原文属公有领域，依据公认注本与通行译注",
  modern: "依据现行通用选本与通行讲法"
};

function main() {
  const W = seed.loadCorpus();

  const master = W.TEXT_MASTER || [];
  if (!master.length) throw seed.noCorpus(path.join(CORPUS_DIR, "data", "text-master.js"));

  const byId = {};
  master.forEach(function (m) {
    byId[m.id] = m;
    (m.entries || []).forEach(function (e) { if (!byId[e]) byId[e] = m; });
  });

  const notes = W.GLOSS_NOTES || {};

  const index = seed.courseIndex(W);
  const courseTexts = {};

  index.forEach(function (x) {
    const p = x.source;
    const m = byId[p.id] || byId[p.originId] || null;
    const text = p.text || (m && m.text) || "";
    const translation = p.translation || (m && m.translation) || "";
    if (!text && !translation) return;
    const entry = {
      text: text,
      translation: translation,
      src: TRANSLATION_SOURCES[p.translationSource] || ""
    };
    if (notes[p.id]) entry.gloss = notes[p.id];
    courseTexts[p.id] = entry;
  });

  dropStale();

  writeModule(path.join(OUT_DIR, "course.js"), courseTexts);
  writePinyin(W, courseTexts);
  writeRoster();
  writeServer();

  console.log("索引 " + index.length + " 条");
  const courseKb = Math.round(fs.statSync(path.join(OUT_DIR, "course.js")).size / 1024);
  console.log("课内正文 " + Object.keys(courseTexts).length + " 条进主包，course.js " + courseKb + "KB");
  const noted = Object.keys(courseTexts).filter(function (id) { return courseTexts[id].gloss; });
  const noteCount = noted.reduce(function (n, id) { return n + courseTexts[id].gloss.length; }, 0);
  console.log("生字生词注释 " + noted.length + " 篇 " + noteCount + " 条");
}

function dropStale() {
  STALE.forEach(function (name) {
    fs.rmSync(path.join(OUT_DIR, name), { recursive: true, force: true });
  });
}

function writePinyin(W, courseTexts) {
  const table = W.PINYIN_TABLE || null;

  if (!table) {
    console.log("读音表未生成：网页版没有 data/pinyin-table.js，注音功能整体关闭");
    return;
  }

  const chars = table;

  const words = extractWords(path.join(CORPUS_DIR, "js", "pinyin.js"), W);

  const commonSet = {};
  const freq = {};
  Object.keys(courseTexts).forEach(function (id) {
    String(courseTexts[id].text || "").split("").forEach(function (ch) {
      if (isHan(ch)) freq[ch] = (freq[ch] || 0) + 1;
    });
  });
  Object.keys(freq).forEach(function (ch) {
    if (freq[ch] > 2) commonSet[ch] = 1;
  });

  writeModule(path.join(OUT_DIR, "pinyin-table.js"), {
    chars: chars,
    words: words,
    common: commonSet,
    poly: polyphones(chars)
  });

  const size = fs.statSync(path.join(OUT_DIR, "pinyin-table.js")).size;
  console.log(
    "读音表 " + Object.keys(chars).length + " 字，词组 " + Object.keys(words).length +
    " 条，常用字 " + Object.keys(commonSet).length + " 个，" +
    Math.round(size / 1024) + "KB（进主包）"
  );
}

function isHan(ch) {
  return /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(ch);
}

function polyphones(chars) {
  const out = {};
  Object.keys(chars).forEach(function (ch) {
    if (String(chars[ch]).indexOf("/") >= 0) out[ch] = true;
  });
  return out;
}

function extractWords(file, W) {
  if (W.Pinyin && W.Pinyin.words) return W.Pinyin.words;
  if (!fs.existsSync(file)) return {};
  const src = fs.readFileSync(file, "utf8");
  const start = src.indexOf("const WORDS = {");
  if (start < 0) return {};
  const end = src.indexOf("\n  };", start);
  const body = src.slice(start + "const WORDS = {".length, end < 0 ? src.length : end);
  try {
    return JSON.parse("{" + body.replace(/\/\*[\s\S]*?\*\//g, "") + "}");
  } catch (e) {
    console.log("词组表解析失败：" + e.message);
    return {};
  }
}

function writeRoster() {
  const raw = process.env.POEM_ROSTER;
  const file = path.join(OUT_DIR, "roster.js");

  if (!raw) {

    writeModule(file, { generatedAt: "", note: "未导入", users: [] });
    console.log("名录未导入：用户列表只显示本机授权（要导入就设 POEM_ROSTER）");
    return;
  }

  let users = [];
  try {
    users = JSON.parse(raw);
  } catch (e) {
    users = String(raw)
      .split("\n")
      .map(function (line) { return line.trim(); })
      .filter(Boolean)
      .map(function (line) {
        const parts = line.split(",");
        return { id: parts[0].trim(), label: (parts[1] || "").trim(), tier: (parts[2] || "free").trim() };
      });
  }

  const safe = users
    .filter(function (u) { return u && u.id; })
    .map(function (u) {
      return {
        id: String(u.id),
        label: String(u.label || u.id).slice(0, 8),
        tier: ["free", "pro", "max"].indexOf(u.tier) >= 0 ? u.tier : "free"
      };
    });

  writeModule(file, { generatedAt: new Date().toISOString().slice(0, 10), note: "", users: safe });
  console.log("名录导入 " + safe.length + " 人（构建产物，不入库）");
}

function writeServer() {
  const values = { env: String(process.env.CLOUD_ENV || "").trim(), service: String(process.env.CLOUD_SERVICE || "").trim() };
  const filled = SERVER_KEYS.filter(function (k) { return values[k]; });

  if (!filled.length) {
    if (!fs.existsSync(SERVER_FILE)) {
      throw new Error(
        "miniprogram/utils/server.js 不在，而 CLOUD_ENV / CLOUD_SERVICE 也没设 —— 两头都空。\n" +
        "这个文件是**入库的空壳**（构建期只改它的值），少了它 remote.js 整条 require 链断掉，\n" +
        "首页会在 onLoad 前就 MODULE_NOT_FOUND。把它从 git 里捡回来再跑构建。"
      );
    }
    console.log("没注入云调用两栏（CLOUD_ENV / CLOUD_SERVICE 都没设）：这个包没配同步服务器");
    return;
  }

  const body = SERVER_KEYS.map(function (k) {
    return "  " + k + ": " + JSON.stringify(values[k]) + ",";
  }).join("\n").replace(/,$/, "");

  fs.writeFileSync(SERVER_FILE,
    "const CLOUD = {\n" + body + "\n};\n" +
    "\n" +
    "function cloud() {\n" +
    "  if (!CLOUD.env || !CLOUD.service) return null;\n" +
    "  return { env: CLOUD.env, service: CLOUD.service };\n" +
    "}\n" +
    "\n" +
    "module.exports = { cloud };\n");

  if (filled.length === SERVER_KEYS.length) {
    console.log("云调用两栏已注入 server.js：" + values.env + " / " + values.service);
  } else {
    console.log("云调用两栏只注入了 " + filled.join(" / ") + " —— " +
      SERVER_KEYS.filter(function (k) { return !values[k]; }).join(" / ") + " 是空的，" +
      "这个包仍算没配服务器");
  }
}

function writeModule(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "module.exports = " + JSON.stringify(data) + ";\n");
  fs.rmSync(file.replace(/\.js$/, ".json"), { force: true });
}

main();
