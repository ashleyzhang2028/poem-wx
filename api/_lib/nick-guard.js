"use strict";

var WORDS = [
  "傻逼", "傻比", "煞笔", "沙比", "智障", "脑残", "弱智", "贱人", "婊子", "去死",
  "死全家", "他妈的", "操你", "草泥马", "尼玛", "杂种", "畜生", "混蛋", "王八蛋",
  "fuck", "shit", "bitch", "porn", "nigger",

  "色情", "情色", "约炮", "裸聊", "援交", "招嫖", "卖淫", "嫖娼", "淫秽", "黄片",
  "一夜情", "做爱", "性交", "裸贷",

  "加微信", "微信号", "加qq", "扫码", "领红包", "返利", "代刷", "刷单", "日赚",

  "赌博", "博彩", "六合彩", "私彩", "办证", "套现", "洗钱", "枪支", "毒品", "冰毒",
  "迷药", "催情",

  "法轮", "六四", "台独", "藏独", "疆独", "港独", "反共", "反华", "暴恐", "圣战",

  "官方", "客服", "管理员", "腾讯", "微信团队"
];

function flatten(raw) {
  return String(raw == null ? "" : raw)
    .replace(/[\uff01-\uff5e]/g, function (c) {
      return String.fromCharCode(c.charCodeAt(0) - 0xfee0);
    })
    .toLowerCase()
    .replace(/[^\u4e00-\u9fa5a-z0-9]/g, "");
}

function hit(raw) {
  var s = flatten(raw);
  if (!s) return false;
  for (var i = 0; i < WORDS.length; i++) {
    if (s.indexOf(WORDS[i]) >= 0) return true;
  }
  return false;
}

module.exports = { WORDS: WORDS, flatten: flatten, hit: hit };
