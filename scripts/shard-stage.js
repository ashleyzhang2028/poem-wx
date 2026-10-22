"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const CORPUS = path.join(ROOT, "scripts", "corpus");
const TEXTS = path.join(ROOT, "miniprogram", "data", "texts");
const SHARD_RE = /^t\d{3}\.js$/;
const LAYOUT = "shard-stage-1";

function walk(dir, rel, out) {
  for (const name of fs.readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    const r = rel ? rel + "/" + name : name;
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full, r, out);
    else out.push(r + " " + st.size);
  }
}

function fingerprint() {
  const files = [];
  walk(CORPUS, "", files);
  const h = crypto.createHash("sha256").update(LAYOUT);
  files.forEach((line) => h.update(line + "\n"));
  h.update(fs.readFileSync(path.join(__dirname, "build-data.js")));
  return h.digest("hex").slice(0, 20);
}

function manifestOf(dir) {
  return fs.readdirSync(dir).filter((f) => SHARD_RE.test(f)).sort()
    .map((f) => f + " " + fs.readFileSync(path.join(dir, f)).length).join("\n");
}

function stage(outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  execFileSync(process.execPath, [path.join(__dirname, "build-data.js")], {
    cwd: ROOT, stdio: ["ignore", "ignore", "inherit"]
  });
  const names = fs.readdirSync(TEXTS).filter((f) => SHARD_RE.test(f)).sort();
  if (names.length < 2) {
    throw new Error("分片只摊出 " + names.length + " 片 —— 语料没生成（scripts/corpus/ 在不在？）");
  }
  const manifest = manifestOf(TEXTS);
  for (const f of names) {
    const gz = zlib.gzipSync(fs.readFileSync(path.join(TEXTS, f)), { level: 9 });
    fs.writeFileSync(path.join(outDir, f + ".gz"), gz);
  }
  fs.writeFileSync(path.join(outDir, "upload.manifest"), manifest + "\n");
  return manifest;
}

function main() {
  const outDir = process.argv[2];
  const fpFile = process.argv[3];
  if (!outDir || !fpFile) {
    console.error("用法：node scripts/shard-stage.js <输出目录> <指纹文件>");
    process.exit(2);
  }

  const fp = fingerprint();
  const ready = fs.existsSync(fpFile)
    && fs.readFileSync(fpFile, "utf8").trim() === fp
    && fs.existsSync(outDir)
    && fs.readdirSync(outDir).filter((f) => SHARD_RE.test(f.replace(/\.gz$/, ""))).length >= 2;

  if (ready) {
    console.log("· 语料没变（" + fp + "），按清单核一遍缓存");
    const actual = fs.readdirSync(outDir).filter((f) => /^t\d{3}\.js\.gz$/.test(f)).sort()
      .map((f) => f.replace(/\.gz$/, "") + " " + zlib.gunzipSync(fs.readFileSync(path.join(outDir, f))).length)
      .join("\n");
    execFileSync(process.execPath, [path.join(__dirname, "build-data.js")], {
      cwd: ROOT, stdio: ["ignore", "ignore", "inherit"]
    });
    if (actual === manifestOf(TEXTS) && fs.existsSync(path.join(outDir, "upload.manifest"))) {
      console.log("✓ 命中缓存：" + actual.split("\n").length + " 片，省掉 gzip -9");
      return;
    }
    console.log("· 缓存里的分片与这一版对不上，重摊");
  } else {
    console.log("· 语料变了或缓存不在（" + fp + "），重摊分片");
  }

  fs.mkdirSync(outDir, { recursive: true });
  for (const f of fs.readdirSync(outDir)) {
    fs.rmSync(path.join(outDir, f), { force: true });
  }
  const manifest = stage(outDir);
  fs.writeFileSync(fpFile, fp + "\n");
  console.log("✓ 摊出 " + manifest.split("\n").length + " 片（" + fp + "）");
}

main();
