"use strict";

var fs = require("fs");
var path = require("path");
var vm = require("vm");

var ROOT = path.join(__dirname, "..", "..");

var BOOKS = [
  { id: "poems",    files: ["data/poems-1.js", "data/poems-2.js", "data/poems-3.js", "data/poems-4.js",
                            "data/poems-5.js", "data/poems-6.js", "data/poems-7.js", "data/poems-8.js",
                            "data/poems-9.js", "data/poems-10.js", "data/poems-11.js", "data/poems-12.js"],
    varName: "POEMS_ALL", needsIndex: true },
  { id: "classic",  files: ["data/poems-classic.js"],  varName: "POEMS_CLASSIC" },
  { id: "yuefu",    files: ["data/poems-yuefu.js"],    varName: "POEMS_YUEFU" },
  { id: "tangshi",  files: ["data/poems-tangshi.js"],  varName: "POEMS_TANGSHI" },
  { id: "gushi",    files: ["data/poems-gushi.js"],    varName: "POEMS_GUSHI" },
  { id: "songci",   files: ["data/poems-songci.js"],   varName: "POEMS_SONGCI" },
  { id: "guwen",    files: ["data/poems-guwen.js"],    varName: "POEMS_GUWEN" },
  { id: "zhaoming", files: ["data/poems-zhaoming.js"], varName: "POEMS_ZHAOMING" },
  { id: "yuanqu",   files: ["data/poems-yuanqu.js"],   varName: "POEMS_YUANQU" },
  { id: "jinxiandai", files: ["data/poems-jinxiandai.js"], varName: "POEMS_JINXIANDAI" },
  { id: "chengyu", files: ["data/poems-chengyu.js"], varName: "POEMS_CHENGYU" }
];

var cache = null;

function runInSandbox(files) {
  var sandbox = { window: {}, console: { log: function () {}, warn: function () {} } };
  sandbox.globalThis = sandbox;
  sandbox.window.window = sandbox.window;
  vm.createContext(sandbox);
  files.forEach(function (f) {
    var src = fs.readFileSync(path.join(ROOT, f), "utf8");
    vm.runInContext(src, sandbox, { filename: f });
  });
  return sandbox.window;
}

function corpus() {
  if (cache) return cache;
  var out = [];
  BOOKS.forEach(function (b) {
    var files = b.files.filter(function (f) { return fs.existsSync(path.join(ROOT, f)); });
    if (!files.length) return;

    var extra = [];
    if (b.needsIndex && fs.existsSync(path.join(ROOT, "data/index.js"))) {
      extra = ["data/index.js"];
    }
    extra = extra.concat(["data/text-master.js"]);
    extra = extra.filter(function (f) { return fs.existsSync(path.join(ROOT, f)); });
    var win = runInSandbox(files.concat(extra));
    var list = (win[b.varName] || []).map(function (p) {
      return (typeof win.masterTextOf === "function") ? win.masterTextOf(p, b.id) : p;
    });
    list.forEach(function (p) {
      if (!p || !p.id) return;
      out.push({
        id: p.id, book: b.id, title: p.title || "", author: p.author || "",
        dynasty: p.dynasty || "", text: p.text || "", translation: p.translation || "",
        gradeGroup: p.gradeGroup || p.selection || "", source: p.source || "",
        // grade / term 也带上：课内三学段（poems:primary 等）是靠它们收窄的。
        // 从前这里只留 gradeGroup，于是 Ex.select(cps,"poems:primary") 恒为空、
        // scoped() 一律退回全站、scopeExact 永远 false —— 「服务端没有 grade
        // 数据」这句老话，根子是这一行漏了两个字段。现在补上，服务端也能按
        // 学段收窄了（grade 由 data/index.js 给，见那边的 p.grade = i + 1）。
        grade: p.grade == null ? null : Number(p.grade),
        term: p.term == null ? null : Number(p.term)
      });
    });
  });
  cache = out;
  return cache;
}

function quiz() {
  return require(path.join(ROOT, "js", "quiz.js"));
}

// 范围过滤与前端同源（前端 `js/game.js` 的 `scopedCorpus()`）：
// **收的是令字**（题），不是作答（答）—— 见 checkFly() 上面那段。
// exam.js 是 UMD，Node 下直接 require 得到同一个 Ex.select。
function exam() {
  return require(path.join(ROOT, "js", "exam.js"));
}

// 按 scope 收窄语料，收窄不了就退回全站、并**如实报** exact = false。
//   · 认得出的集子（book:xxx）/ 学段（poems:primary 等）按 range 收窄；
//   · 认不出的 scope 退回全站，不抛；
// exact 供两处用：一是回执里带 scopeExact（让前端知道这回真按范围收窄了吗），
// 二是 checkFly() 算 inScope —— exact=false 时收窄没发生，inScope 只能报 null。
//
// ⚠️ 从前这里写着「课内三学段服务端没有 grade 数据」。那是**误判**：
// 语料里其实有 grade（`data/index.js` 给的），是 corpus() 那一行 push 的时候
// 漏掉了 grade/term 两个字段。现在补上了，课内三学段也收得动。
function scoped(scopeId) {
  var cps = corpus();
  var id = String(scopeId == null ? "" : scopeId);
  if (!id || id === "all") return { corpus: cps, id: "all", exact: true };
  var out = null;
  try { out = exam().select(cps, id); } catch (e) { out = null; }
  if (out && out.length) return { corpus: out, id: id, exact: true };
  return { corpus: cps, id: id, exact: false };
}

var bankCache = null;
function bank() {
  if (bankCache) return bankCache;
  bankCache = quiz().buildBank(corpus(), { perPoem: 1, options: 4 });
  return bankCache;
}

function rebuild(input) {
  var Q = quiz();
  var b = bank();
  var id = input && (input.bankId || input.questionId);
  var poemId = input && input.poemId;
  if (id) {
    for (var i = 0; i < b.length; i++) if (b[i].id === id) {
      return Q.pick({ bank: b, id: id, options: 4, seed: String(input.seed || id) });
    }
    return null;
  }
  if (poemId) {
    for (var j = 0; j < b.length; j++) if (b[j].poemId === poemId) {
      return Q.pick({ bank: b, id: b[j].id, options: 4, seed: String(input.seed || b[j].id) });
    }
  }
  return null;
}

function checkFly(input) {
  var Q = quiz();

  // ⚠️ 判分扫**整份语料**，不按用户选的 range 收窄（用户 2026-09-30 裁决）。
  //
  // 原文：「我的初始出题范围确实是目标范围内的令字，但我的回答可以超出
  // 当前范围吧，否则没法回答了」。对 —— range 管的是**令字**（出什么题），
  // 不管你想起的是哪一句（答）。用户在「小学」范围里闯关，令字给了「风」，
  // 他答「春风不度玉门关」（王之涣《凉州词》，只在乐府集里）—— 那真是一句
  // 古诗，拿范围去卡它只会把真句子判成「合集里没有」。
  //
  // 从前的写法是 `scoped(input.scopeId).corpus`：判分跟着 range 走。那正是
  // 这条反馈的由来。现在服务端与前端同一个口径（前端 `answerCorpus()` 也扫
  // 整份语料），两端的「找到 / 没找到」在同一个语料上算出来，不会再各说一套。
  //
  // scopeId 仍收下来：一是留个痕（回答里回带）、二是总句数口径不变。
  // scoped() 保留 —— **令字**的候选池仍按 range 挑（那是题，该收）。
  var sc = scoped(input.scopeId);
  var cps = corpus();
  var chars = (input.chars || [input.char]).filter(Boolean).map(String);
  if (!chars.length) return { bad: "E_CHARS", message: "请先给一个令字" };
  var said = String(input.said == null ? "" : input.said).replace(/\s/g, "");
  if (!said) return { bad: "E_BODY", message: "请把你想起来的那一句填上" };

  var hit = Q.flyFlower({ poems: cps, chars: chars });
  // 同一句常出现在好几篇里（「黄河入海流」既是课内《登鹳雀楼》，也在唐诗集里）。
  // 取第一条当出处，但「在不在范围里」要看**所有**对上的那几条 —— 有一条在范围里
  // 就算在，别因为语料拼接的先后把课内那句盖过去。
  var exactRows = hit.rows.filter(function (r) { return r.text === said; });
  var exact = exactRows[0] || null;

  // 这一句落在用户选的范围里吗？落在范围外也照样算对 —— 只是如实报出来，
  // 免得用户看见「对上了」还以为那一句真在本范围（小学）里。
  //
  // ⚠️ 只有在**服务端真按这个范围收窄过**（sc.exact）时，「在不在范围里」才
  // 有意义。sc.exact === false 时 sc.corpus 已经是全站（scoped() 的退路），
  // 拿它算出来的 inScope 恒为 true —— 那是假的，宁可报 null（说不清）。
  var inScope = null;
  if (exact && sc.exact) {
    var scopedIds = {};
    sc.corpus.forEach(function (p) { if (p && p.id != null) scopedIds[String(p.id)] = 1; });
    inScope = exactRows.some(function (r) { return !!scopedIds[String(r.id)]; });
    // 出处也换成「在范围里的那一条」（有的话）—— 回显给用户看的是本范围里的篇名。
    var inRow = exactRows.filter(function (r) { return !!scopedIds[String(r.id)]; })[0];
    if (inRow) exact = inRow;
  }

  return {
    ok: true, kind: "fly", chars: chars, said: said,
    scopeId: sc.id, scopeExact: sc.exact,
    found: !!exact,
    poemId: exact ? exact.id : null,
    title: exact ? exact.title : null,
    inScope: inScope,
    total: hit.count
  };
}

module.exports = {
  corpus: corpus,
  bank: bank,
  quiz: quiz,
  rebuild: rebuild,
  checkFly: checkFly,
  scoped: scoped,
  BOOKS: BOOKS,

  _reset: function () { cache = null; bankCache = null; }
};
