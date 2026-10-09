"use strict";

var crypto = require("crypto");

var ZERO_WIDTH = /[\u200b-\u200f\u202a-\u202e\u2060\ufeff]/g;

function normalizeEmail(value) {
  return String(value == null ? "" : value)
    .replace(ZERO_WIDTH, "")
    .trim()
    .toLowerCase();
}

function isEmailShape(email) {
  var e = normalizeEmail(email);
  if (!e || e.length > 254) return false;
  var at = e.lastIndexOf("@");
  if (at <= 0 || at === e.length - 1) return false;
  var name = e.slice(0, at);
  var domain = e.slice(at + 1);
  if (name.length > 64 || /\s/.test(name) || name[0] === "." || name.slice(-1) === ".") return false;
  if (name.indexOf("..") >= 0) return false;
  if (domain.indexOf(".") <= 0) return false;
  if (domain.length > 253 || domain[0] === "." || domain.slice(-1) === ".") return false;
  if (domain.indexOf("..") >= 0) return false;
  return /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/.test(e);
}

function normalizePhone(value) {
  var s = String(value == null ? "" : value).replace(/[\s\-()\.]/g, "");
  s = s.replace(/^\+?0*86/, "");
  return s;
}

function isPhoneShape(value) {
  return /^1[3-9]\d{9}$/.test(normalizePhone(value));
}

function maskPhone(value) {
  var s = normalizePhone(value);
  if (!isPhoneShape(s)) return "***";
  return s.slice(0, 3) + "****" + s.slice(-4);
}

function phoneHash(value, pepper) {
  return crypto.createHash("sha256")
    .update(String(pepper || "") + "|phone|" + normalizePhone(value), "utf8")
    .digest("hex");
}

function emailHash(email, pepper) {
  return crypto.createHash("sha256")
    .update(String(pepper || "") + "|" + normalizeEmail(email), "utf8")
    .digest("hex");
}

function codeHash(uid, purpose, code, salt, pepper) {
  return crypto.createHash("sha256")
    .update([pepper || "", uid, purpose, String(code || ""), salt].join("|"), "utf8")
    .digest("hex");
}

function timingSafeEqual(a, b) {
  var x = Buffer.from(String(a || ""), "utf8");
  var y = Buffer.from(String(b || ""), "utf8");
  if (x.length !== y.length) {

    crypto.timingSafeEqual(x, x);
    return false;
  }
  return crypto.timingSafeEqual(x, y);
}

function newUid() {
  return "u_" + crypto.randomBytes(8).toString("hex");
}

function newSid() {
  return "s_" + crypto.randomBytes(8).toString("hex");
}

function newCodeId() {
  return "c_" + crypto.randomBytes(6).toString("hex");
}

function newCode(len) {
  var n = len || 6;
  var s = "";
  while (s.length < n) s += String(crypto.randomInt(0, 10));
  return s.slice(0, n);
}

function normalizeEmailForStore(value) {
  return String(value == null ? "" : value)
    .replace(ZERO_WIDTH, "")
    .trim();
}

function newPasswordSalt() {
  return crypto.randomBytes(16).toString("hex");
}

function hashPassword(password, salt, params) {
  var p = params || { N: 16384, r: 8, p: 1, len: 32 };
  var dk = crypto.scryptSync(String(password == null ? "" : password), String(salt || ""), p.len, {
    N: p.N, r: p.r, p: p.p,

    maxmem: 64 * 1024 * 1024
  });
  return "scrypt$" + p.N + "$" + p.r + "$" + p.p + "$" + String(salt) + "$" + dk.toString("hex");
}

function verifyPassword(password, stored) {
  var parts = String(stored || "").split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  var p = { N: Number(parts[1]), r: Number(parts[2]), p: Number(parts[3]), len: 32 };
  if (!(p.N > 0) || !(p.r > 0) || !(p.p > 0)) return false;
  var expect;
  try { expect = hashPassword(password, parts[4], p); } catch (e) { return false; }
  return timingSafeEqual(expect, stored);
}

function newToken() {
  return crypto.randomBytes(32).toString("hex");
}

function tokenHash(uid, purpose, token, pepper) {
  return crypto.createHash("sha256")
    .update([String(pepper || ""), String(purpose || ""), String(uid || ""), String(token || "")].join("|"), "utf8")
    .digest("hex");
}

function newVerifyId() {
  return "v_" + crypto.randomBytes(8).toString("hex");
}

function newResetId() {
  return "r_" + crypto.randomBytes(8).toString("hex");
}

function newReportId() {
  return "rp_" + crypto.randomBytes(8).toString("hex");
}

function newPinyinProposalId() {
  return "pf_" + crypto.randomBytes(8).toString("hex");
}

function newFeedbackId() {
  return "fb_" + crypto.randomBytes(8).toString("hex");
}

function newFeedbackCommentId() {
  return "fc_" + crypto.randomBytes(8).toString("hex");
}

function newExamRecordId() {
  return "er_" + crypto.randomBytes(8).toString("hex");
}

function newSalt() {
  return crypto.randomBytes(8).toString("hex");
}

module.exports = {
  normalizeEmail: normalizeEmail,
  normalizeEmailForStore: normalizeEmailForStore,
  newPasswordSalt: newPasswordSalt,
  hashPassword: hashPassword,
  verifyPassword: verifyPassword,
  newToken: newToken,
  tokenHash: tokenHash,
  newVerifyId: newVerifyId,
  newResetId: newResetId,
  newReportId: newReportId,
  newPinyinProposalId: newPinyinProposalId,
  newFeedbackId: newFeedbackId,
  newFeedbackCommentId: newFeedbackCommentId,
  newExamRecordId: newExamRecordId,
  normalizePhone: normalizePhone,
  isPhoneShape: isPhoneShape,
  maskPhone: maskPhone,
  phoneHash: phoneHash,
  isEmailShape: isEmailShape,
  emailHash: emailHash,
  codeHash: codeHash,
  timingSafeEqual: timingSafeEqual,
  newUid: newUid,
  newSid: newSid,
  newCodeId: newCodeId,
  newCode: newCode,
  newSalt: newSalt
};
