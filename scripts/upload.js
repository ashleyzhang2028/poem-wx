#!/usr/bin/env node
/**
 * 上传体验版。CI 里用它把每次推送落成一个可点开的版本
 * —— 离线自检只能证明「代码自洽」，证明不了「真机上长得对」。
 *
 * ⚠️ 它**不是**发布工具：上传出去的只是体验版，要提审还得去公众平台点。
 *    这是刻意的 —— 自动提审等同于把「要不要上线」交给流水线决定。
 *
 * 需要的环境变量（放 Secret 仓库，别落明文）：
 *   WX_APPID       小程序 appid（也要写进 project.config.json）
 *   WX_PRIVATE_KEY 代码上传密钥文件路径（公众平台 → 开发管理 → 开发设置）
 *
 * 用法：
 *   WX_APPID=wx... WX_PRIVATE_KEY=/path/key.pem node scripts/upload.js "1.0.0" "首版"
 */
"use strict";

const fs = require("fs");
const path = require("path");

const appid = process.env.WX_APPID || "";
const keyPath = process.env.WX_PRIVATE_KEY || "";
const version = process.argv[2] || "1.0.0";
const desc = process.argv[3] || "自动上传";
const ROOT = path.join(__dirname, "..");
const MP = path.join(ROOT, "miniprogram");

function die(msg) {
  console.error("✗ " + msg);
  process.exit(1);
}

if (!appid) die("缺 WX_APPID");
if (appid === "touristappid") die("WX_APPID 还是游客模式，先把正式 appid 配好");
if (!keyPath || !fs.existsSync(keyPath)) die("缺 WX_PRIVATE_KEY，或文件不存在：" + keyPath);

// 语料是构建产物，不入库 —— 上传前必须先在
if (!fs.existsSync(path.join(MP, "data", "books", "books.json"))) {
  die("语料还没生成，先跑 POEM_WEB_DIR=... node scripts/build-data.js");
}
// project.config.json 里的 appid 与上传用的必须一致，否则传上去会张冠李戴
{
  const cfg = JSON.parse(fs.readFileSync(path.join(MP, "project.config.json"), "utf8"));
  if (cfg.appid !== appid) {
    die("project.config.json 里的 appid（" + cfg.appid + "）与 WX_APPID（" + appid + "）不一致");
  }
}

let ci = null;
try {
  ci = require("miniprogram-ci");
} catch (e) {
  die("没装 miniprogram-ci。`npm i -D miniprogram-ci` 之后再跑 —— 它有一堆原生依赖，" +
      "所以没有列进 package.json 的 dependencies，免得每次自检都要装一遍。");
}

const project = new ci.Project({
  appid: appid,
  type: "miniProgram",
  projectPath: MP,
  privateKeyPath: keyPath,
  ignores: ["node_modules/**/*", "data/texts/**/*"]
});

ci
  .upload({
    project,
    version,
    desc,
    setting: { es6: true, minify: true, autoPrefixWXSS: true },
    onProgressUpdate: (t) => process.stdout.write(t + "\\r")
  })
  .then((res) => {
    console.log("\\n✓ 已上传体验版 " + version + "：" + JSON.stringify(res && res.subPackageInfo || {}));
    console.log("  下一步去公众平台把它设为体验版，真机走一遍再提审。");
  })
  .catch((err) => die("上传失败：" + (err && err.message)));
