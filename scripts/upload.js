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

if (!keyPath && !keyB64) {
  die("缺 WX_PRIVATE_KEY_B64（或 WX_PRIVATE_KEY 指向的密钥文件）—— " +
      "见 .cnb.yml 的 imports 与密钥仓库 wechat-ci.yml");
}

let keyFile = keyPath;
if (!keyFile) {

  const raw = Buffer.from(keyB64.replace(/\s+/g, ""), "base64");
  if (!raw.length) die("WX_PRIVATE_KEY_B64 解出来是空的，检查是不是贴成了别的东西");
  keyFile = path.join(os.tmpdir(), "wx-upload-key-" + process.pid + ".pem");
  fs.writeFileSync(keyFile, raw, { mode: 0o600 });

  if (!raw.toString("utf8").includes("-----BEGIN")) {
    die("WX_PRIVATE_KEY_B64 解出来不是 PEM 文本（应以 -----BEGIN 开头）—— " +
        "多半是把 appid 或别的内容 base64 了；重新从公众平台下载 .key 再编码");
  }
}

if (keyFile === keyPath && (!keyPath || !fs.existsSync(keyPath))) {
  die("WX_PRIVATE_KEY 指向的文件不存在：" + keyPath);
}

if (!fs.existsSync(path.join(MP, "data", "books", "books.json"))) {
  die("语料还没生成，先跑 POEM_WEB_DIR=... node scripts/build-data.js");
}

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
