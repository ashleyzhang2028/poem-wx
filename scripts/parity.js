"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const MP = path.join(ROOT, "miniprogram");
const WEB = process.env.POEM_WEB_DIR || "/tmp/poem";

let checks = 0;
let fails = 0;

function ok(name, cond, detail) {
  checks += 1;
  if (cond) return;
  fails += 1;
  console.log("✗ " + name + (detail ? " —— " + detail : ""));
}

const DECIDED = {
  "recite.basic": { kind: "cap", to: "daily" },
  "library.all": { kind: "cap", to: "library" },

  "read.aloud": { kind: "none", to: "todo-1" },

  "pinyin.helper": { kind: "none", to: "todo-3" },
  "export.progress": { kind: "cap", to: "export" },
  "algo.ebbinghaus": { kind: "cap", to: "ebbinghaus" },
  "algo.leitner": { kind: "cap", to: "leitner" },
  "algo.sm2": { kind: "cap", to: "sm2" },
  "algo.fsrs": { kind: "cap", to: "fsrs" },
  "collections.many": { kind: "none", to: "todo-5" },
  "sync.multiDevice": { kind: "cap", to: "sync" },
  "export.paper": { kind: "none", to: "todo-6" },
  "profile.family": { kind: "none", to: "todo-8" },
  "quiz.review": { kind: "cap", to: "quiz" },
  "export.all": { kind: "none", to: "todo-6" },
  feihualing: { kind: "cap", to: "feihualing" },
  "exam.gathering": { kind: "page", to: "packages/game/feihua/feihua" },
  "exam.paper": { kind: "cap", to: "exam" },
  "exam.formal": { kind: "none", to: "todo-9" },
  "exam.changshi": { kind: "none", to: "todo-9" }
};

let webCaps = null;
try {
  const web = require(path.join(WEB, "js", "entitlement.js"));
  if (web && web.CAPS) webCaps = Object.keys(web.CAPS);
} catch (e) {
  webCaps = null;
}

const E = require(path.join(MP, "utils", "entitlement.js"));
const app = JSON.parse(fs.readFileSync(path.join(MP, "app.json"), "utf8"));
const pages = app.pages.slice();
(app.subPackages || []).forEach((sp) => {
  sp.pages.forEach((p) => pages.push(sp.root + "/" + p));
});
const capKeys = E.CAP_KEYS;
const todoDoc = fs.readFileSync(path.join(ROOT, "docs", "todo.md"), "utf8");

if (!webCaps) {
  console.log("  · 跳过能力表对照：拿不到 " + WEB + "/js/entitlement.js");
  console.log("    先取语料再跑：bash scripts/clone-poem.sh /tmp/poem（Windows 上用 Git Bash），");
  console.log("    或让 POEM_WEB_DIR 指向已有的 poem 仓库 —— PowerShell 里是");
  console.log('    $env:POEM_WEB_DIR="<poem 仓库的路径>"。');
} else {
  const missing = webCaps.filter((k) => !DECIDED[k]);
  ok("网页版能力表逐项都有交代（" + webCaps.length + " 项）", missing.length === 0, missing.join(", "));

  const extra = Object.keys(DECIDED).filter((k) => webCaps.indexOf(k) < 0);
  ok("对照表里没有网页版已删除的能力", extra.length === 0, extra.join(", "));
}

Object.keys(DECIDED).forEach((k) => {
  const d = DECIDED[k];
  if (d.kind === "cap") {
    ok("能力落点存在 " + k + " → " + d.to, capKeys.indexOf(d.to) >= 0, "能力表里没有 " + d.to);
  } else if (d.kind === "page") {
    ok("页面落点存在 " + k + " → " + d.to, pages.indexOf(d.to) >= 0, "app.json 里没有 " + d.to);
  } else if (d.kind === "file") {
    ok("文件落点存在 " + k + " → " + d.to, fs.existsSync(path.join(ROOT, d.to)), "找不到 " + d.to);
  } else if (d.kind === "none") {

    const id = String(d.to).replace(/^todo-/, "");
    const hasRow = new RegExp("\\|\\s*" + id + "\\s*\\|").test(todoDoc);
    ok("不做的有记账 " + k + " → todo.md #" + id, hasRow, "docs/todo.md 里没有第 " + id + " 条");
  }
});

{
  const doc = fs.readFileSync(path.join(ROOT, "docs", "parity.md"), "utf8");

  ok("parity.md 存在且列了记号口径", doc.indexOf("| ✅ |") >= 0 && doc.indexOf("⏸️") >= 0);

  const vague = ["大致齐", "基本齐", "应该都有", "都没问题"];
  const hit = vague.filter((w) => doc.indexOf(w) >= 0);
  ok("对照文档不写没有判据的措辞", hit.length === 0, hit.join(", "));

  const todoRows = (todoDoc.match(/\|\s*\d+\s*\|/g) || []).length;
  ok("todo.md 有条目（" + todoRows + " 条）", todoRows >= 10);

  const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
  ok("README 指向 docs/parity.md", readme.indexOf("docs/parity.md") >= 0);
  ok("README 指向 docs/todo.md", readme.indexOf("docs/todo.md") >= 0);
}

{

  const MUST_NOT_APPEAR = {
    collections: ["自选清单", "建一个集合"],
    family: ["子用户", "孩子"],
    paper: ["打印", "导出 PDF"]
  };
  const hits = [];
  pages.forEach((p) => {
    const wxml = fs.readFileSync(path.join(MP, p + ".wxml"), "utf8");
    Object.keys(MUST_NOT_APPEAR).forEach((k) => {
      MUST_NOT_APPEAR[k].forEach((word) => {
        if (wxml.indexOf(word) >= 0) hits.push(p + " → " + word);
      });
    });
  });
  ok("刻意不做的能力界面上没有入口", hits.length === 0, hits.slice(0, 6).join("; "));
}

console.log("");
console.log("对照检查 " + checks + " 项，失败 " + fails + " 项");
process.exit(fails ? 1 : 0);
