#!/usr/bin/env node
/**
 * 上传体验版（**不是**发布：要提审还得去公众平台点）。
 *
 *   WX_APPID           小程序 appid（也要写进 project.config.json）
 *   WX_PRIVATE_KEY_B64 代码上传密钥的 base64（CI 里用这种：.pem 多行文本
 *                      塞进 YAML 后换行会被吃掉）
 *   或 WX_PRIVATE_KEY  同一份密钥的文件路径
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

// 两者都给时以路径为准（base64 里混进换行会静默变形）。
if (!keyPath && !keyB64) {
  die("缺 WX_PRIVATE_KEY_B64（或 WX_PRIVATE_KEY 指向的密钥文件）—— " +
      "见 .cnb.yml 的 imports 与密钥仓库 wechat-ci.yml");
}

let keyFile = keyPath;
if (!keyFile) {
  // 先剥掉所有空白再解码：YAML 折叠多行与粘贴都会带上换行/空格。
  const raw = Buffer.from(keyB64.replace(/\s+/g, ""), "base64");
  if (!raw.length) die("WX_PRIVATE_KEY_B64 解出来是空的，检查是不是贴成了别的东西");
  keyFile = path.join(os.tmpdir(), "wx-upload-key-" + process.pid + ".pem");
  fs.writeFileSync(keyFile, raw, { mode: 0o600 });
  // PEM 一定是 -----BEGIN，不是就当场说清楚 —— 不然 miniprogram-ci 只回一句
  // 「密钥无效」，人会去查 appid 与 IP 白名单。
  if (!raw.toString("utf8").includes("-----BEGIN")) {
    die("WX_PRIVATE_KEY_B64 解出来不是 PEM 文本（应以 -----BEGIN 开头）—— " +
        "多半是把 appid 或别的内容 base64 了；重新从公众平台下载 .key 再编码");
  }
}

if (keyFile === keyPath && (!keyPath || !fs.existsSync(keyPath))) {
  die("WX_PRIVATE_KEY 指向的文件不存在：" + keyPath);
}

// 语料是构建产物，不入库，上传前必须先跑 build-data.js
if (!fs.existsSync(path.join(MP, "data", "books", "books.json"))) {
  die("语料还没生成，先跑 POEM_WEB_DIR=... node scripts/build-data.js");
}
// appid 两处不一致就会张冠李戴
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
  die("没装 miniprogram-ci。`npm i -D miniprogram-ci` 之后再跑（它有一堆原生依赖，" +
      "所以没列进 package.json，免得每次自检都要装一遍）。");
}

const project = new ci.Project({
  appid: appid,
  type: "miniProgram",
  projectPath: MP,
  privateKeyPath: keyFile,
  ignores: ["node_modules/**/*", "data/texts/**/*"]
});

/* 平台回的那几句话**不像它自己**：这里逐条翻成人话，并说清「谁能改」。
   这条分岔不是为了好看 —— 现场 `cnb-hat-1k4k8oanv` 回的是
       〘20003〙 checkIpInWhiteList Failed: "appIdToAppuin failed"
   而按字面理解会去查「IP 白名单」、查 appid 拼错 —— 两条都不对症：
   错在**那枚上传密钥不是这个 appid 名下的**（密钥换过、appid 换过、
   或密钥下到了别的小程序），平台连 appid→企微号 的映射都建不起来，
   白名单这关自然过不去。
   翻译放在这儿（而不是只写进文档），是因为踩的人只看得见流水线日志。 */
function explain(msg) {
  const m = String(msg || "");
  if (/appIdToAppuin/.test(m)) {
    return "上传密钥与 appid 对不上号：公众平台查不到这个 appid。\n" +
      "   大概率是【密钥不是这个 appid 名下的】—— 密钥换过 / appid 换过 /\n" +
      "   密钥下到了别的小程序。它**不是** IP 白名单的问题，也不是 appid 拼错。\n" +
      "   怎么修：见 docs/wx-cloud-setup.md § 八点五。要点是\n" +
      "   ① appid（wx200a0c667fc67fcb）要在 mp.weixin.qq.com 的「成员管理 →\n" +
      "      开发成员」里看得到（个人主体下拿不到就不是这枚）；\n" +
      "   ② 密钥要在「开发管理 → 开发设置 → 小程序代码上传」现生成一枚；\n" +
      "   ③ 两样一起换，换完重跑这条流水线。";
  }
  if (/checkIpInWhiteList/.test(m) && !/appIdToAppuin/.test(m)) {
    return "上传密钥设了 IP 白名单，而构建机的出口 IP 不在名单里。\n" +
      "   两条路任选：把白名单关掉（密钥那一栏留空），或把构建机出口 IP 加进去。";
  }
  if (/invalid ip|ip is not in/i.test(m)) {
    return "出口 IP 没被密钥的白名单收下 —— 同上一类，去密钥那一栏放行或关掉白名单。";
  }
  if (/40001|invalid credential|invalid appid/i.test(m)) {
    return "密钥无效或 appid 与它不配对 —— 回公众平台重新生成一枚代码上传密钥。";
  }
  return "";
}

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
  .catch((err) => {
    const raw = (err && err.message) || "";
    const hint = explain(raw);
    die("上传失败：" + raw + (hint ? "\n\n  怎么读这句话：\n   " + hint : ""));
  });
