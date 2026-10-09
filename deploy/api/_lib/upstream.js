"use strict";

var E_DB_UNREACHABLE = "E_DB_UNREACHABLE";
var E_DB_MISSING_TABLE = "E_DB_MISSING_TABLE";
var E_DB_BAD_KEY = "E_DB_BAD_KEY";

var BAD_REQUEST_SIGNS = [
  "42703",
  "PGRST204",
  "42P01",
  "23505",
  "23503",
  "22P02"
];

var MISSING_TABLE_SIGNS = [
  "42P01",
  "PGRST205",
  "relation", "does not exist"
];

var MISSING_TABLE_RE = /relation .* does not exist|Could not find the table|schema cache/i;

var BAD_KEY_SIGNS = ["JWT", "Invalid API key", "invalid api key", "permission denied", "no suitable key"];

function textOf(err) {
  if (!err) return "";
  var up = String(err.upstream || "");
  var msg = String(err.message || "");
  return (up + " " + msg).slice(0, 600);
}

function hasAny(hay, needles) {
  var h = String(hay || "").toLowerCase();
  for (var i = 0; i < needles.length; i++) {
    if (h.indexOf(String(needles[i]).toLowerCase()) >= 0) return needles[i];
  }
  return null;
}

function classify(err) {
  if (!err) return null;

  var status = Number(err.status);
  var txt = textOf(err);

  if (!isFinite(status) || status === 0) {

    if (err.network === true) return "unreachable";
    if (err.name === "AbortError") return "unreachable";
    if (/fetch failed|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|network|timeout|aborted|not-json|不是 JSON|不是合法 JSON/i.test(txt)) {
      return "unreachable";
    }

    return null;
  }

  if (/Unexpected token|not valid JSON|is not valid JSON|SyntaxError/i.test(txt)) return "unreachable";

  if (status >= 500) return "unreachable";

  if (status === 401 || status === 403) return "bad_key";

  if (status === 404) {
    if (MISSING_TABLE_RE.test(txt) || hasAny(txt, ["does not exist", "PGRST205"])) return "missing_table";
    return "bad_request";
  }

  if (status === 400) {
    if (MISSING_TABLE_RE.test(txt) || hasAny(txt, ["42P01", "PGRST205"])) return "missing_table";
    if (hasAny(txt, BAD_KEY_SIGNS)) return "bad_key";
    if (hasAny(txt, BAD_REQUEST_SIGNS)) return "bad_request";
    return "bad_request";
  }

  return null;
}

function verdict(kind, cfg) {
  var site = String((cfg && cfg.siteUrl) || "本站").replace(/\/+$/, "");
  void site;

  if (kind === "unreachable") {
    return {
      status: 503,
      body: {
        code: E_DB_UNREACHABLE,
        message: "账号服务器连不上（多半是数据库项目被暂停了）。云端登录 / 注册暂时用不了；" +
          "本站的背诵功能不受影响，进度一直存在这台设备上。稍后可在「设置 → 关于 → 自检」里看详情。",
        retryable: true
      }
    };
  }

  if (kind === "missing_table") {
    return {
      status: 503,
      body: {
        code: E_DB_MISSING_TABLE,
        message: "账号服务器上的表还没建好（缺 accounts 那几张表）。这不是你的问题，" +
          "请联系站点管理员跑一次 api/_lib/schema.sql。",
        retryable: false
      }
    };
  }

  if (kind === "bad_key") {
    return {
      status: 503,
      body: {
        code: E_DB_BAD_KEY,
        message: "账号服务器的密钥不对（多半是用了 anon key，或改完没重新部署）。" +
          "这不是你的问题，请联系站点管理员。",
        retryable: false
      }
    };
  }

  if (kind === "bad_request") {

    return {
      status: 400,
      body: {
        code: "E_BAD_REQUEST",
        message: "这一发请求没能被服务端读懂，请刷新页面重试。",
        retryable: true
      }
    };
  }

  return null;
}

function tag(err) {
  try {
    if (err && !err.kind) err.kind = classify(err);
  } catch (e) {  }
  return err;
}

module.exports = {
  classify: classify,
  verdict: verdict,
  tag: tag,
  E_DB_UNREACHABLE: E_DB_UNREACHABLE,
  E_DB_MISSING_TABLE: E_DB_MISSING_TABLE,
  E_DB_BAD_KEY: E_DB_BAD_KEY,
  _textOf: textOf
};
