#!/usr/bin/env node
/**
 * 上传体验版。CI 里用它把每次推送落成一个可点开的版本
 * —— 离线自检只能证明「代码自洽」，证明不了「真机上长得对」。
 *
 * ⚠️ 它**不是**发布工具：上传出去的只是体验版，要提审还得去公众平台点。
 *    这是刻意的 —— 自动提审等同于把「要不要上线」交给流水线决定。
 *
 * 需要的环境变量（放密钥仓库，别落明文）：
 *   WX_APPID          小程序 appid（也要写进 project.config.json）
 *   WX_PRIVATE_KEY    代码上传密钥**文件路径**（公众平台 → 开发管理 → 开发设置）
 *   或
 *   WX_PRIVATE_KEY_B64 同一份密钥的 base64 原文
 *
 * 两者取其一即可。CI 里用 B64 那种：密钥仓库能以 YAML 存文本，
 * 而 .pem 多行文本塞进 YAML 之后换行会被吃掉 —— 于是「文件还在、
 * 只是行都黏成了一行」，报出来的错会是密钥格式不对，不是「没配」。
 *
 * 用法：
 *   WX_APPID=wx... WX_PRIVATE_KEY_B64=... node scripts/upload.js "1.0.0" "首版"
 */
"use strict";

const fs = require("fs");
const path = require("path");

const os = require("os");

const appid = process.env.WX_APPID || "";
const keyPath = process.env.WX_PRIVATE_KEY || "";
const keyB64 = process.env.WX_PRIVATE_KEY_B64 || "";
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

// 密钥两种喂法都认：给路径就用路径，给 base64 就落一份到临时文件。
// 两者都给时以路径为准（路径更明确，不会因为 base64 里混进换行而静默变形）。
if (!keyPath && !keyB64) {
  die("缺 WX_PRIVATE_KEY_B64（或 WX_PRIVATE_KEY 指向的密钥文件）—— " +
      "见 .cnb.yml 的 imports 与密钥仓库 wechat-ci.yml");
}

let keyFile = keyPath;
if (!keyFile) {
  // 密钥仓库里的 YAML 常用 `|` 折叠多行，粘贴时也可能带上换行/空格；
  // 先剥掉所有空白再解码，否则 Buffer.from 会安静地解出一坨坏字节。
  const raw = Buffer.from(keyB64.replace(/\s+/g, ""), "base64");
  if (!raw.length) die("WX_PRIVATE_KEY_B64 解出来是空的，检查是不是贴成了别的东西");
  keyFile = path.join(os.tmpdir(), "wx-upload-key-" + process.pid + ".pem");
  fs.writeFileSync(keyFile, raw, { mode: 0o600 });
  // 只在启动时看一眼开头：PEM 一定是 -----BEGIN，不是就当场说清楚，
  // 别等 miniprogram-ci 抛一句「密钥无效」让人去查 appid / IP 白名单。
  if (!raw.toString("utf8").includes("-----BEGIN")) {
    die("WX_PRIVATE_KEY_B64 解出来不是 PEM 文本（应以 -----BEGIN 开头）—— " +
        "多半是把 appid 或别的内容 base64 了；重新从公众平台下载 .key 再编码");
  }
}

if (keyFile === keyPath && (!keyPath || !fs.existsSync(keyPath))) {
  die("WX_PRIVATE_KEY 指向的文件不存在：" + keyPath);
}

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
  privateKeyPath: keyFile,
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
