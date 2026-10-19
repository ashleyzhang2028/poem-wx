"use strict";

var upstream = require("./upstream");

function memoryStore() {
  var db = { accounts: {}, codes: {}, sessions: {}, wxAccounts: {}, progress: {}, verifications: {}, resets: {}, reports: {}, pinyinProposals: {}, feedbackThreads: {}, feedbackComments: {}, examRecords: {}, scoreRecords: {}, settings: {} };
  var api = {
    kind: "memory",
    ready: function () { return true; },
    _db: db,

    getAccountByHash: function (hash) {
      var ids = Object.keys(db.accounts);
      for (var i = 0; i < ids.length; i++) if (db.accounts[ids[i]].email_hash === hash) return db.accounts[ids[i]];
      return null;
    },
    getAccount: function (uid) { return db.accounts[uid] || null; },
    putAccount: function (acc) { db.accounts[acc.uid] = acc; return acc; },

    degrade: function () { return []; },
    deleteAccount: function (uid) { delete db.accounts[uid]; return true; },

    getWxAccountByOpenid: function (openid) {
      var ids = Object.keys(db.wxAccounts || {});
      for (var i = 0; i < ids.length; i++) {
        if (db.wxAccounts[ids[i]].openid === openid) return db.wxAccounts[ids[i]];
      }
      return null;
    },
    getWxAccountByUnionid: function (unionid) {
      if (!unionid) return null;
      var ids = Object.keys(db.wxAccounts || {});
      for (var i = 0; i < ids.length; i++) {
        if (db.wxAccounts[ids[i]].unionid === unionid) return db.wxAccounts[ids[i]];
      }
      return null;
    },
    putWxAccount: function (row) {
      db.wxAccounts = db.wxAccounts || {};
      db.wxAccounts[row.uid] = row;
      return row;
    },
    patchWxAccount: function (uid, patch) {
      db.wxAccounts = db.wxAccounts || {};
      var w = db.wxAccounts[uid];
      if (!w) return false;
      Object.keys(patch).forEach(function (k) { w[k] = patch[k]; });
      return true;
    },

    putCode: function (rec) { db.codes[rec.code_id] = rec; return rec; },
    getCode: function (codeId) { return db.codes[codeId] || null; },

    patchCode: function (codeId, patch) {
      var c = db.codes[codeId];
      if (!c) return false;
      Object.keys(patch).forEach(function (k) { c[k] = patch[k]; });
      return true;
    },

    patchAccount: function (uid, patch) {
      var a = db.accounts[uid];
      if (!a) return false;

      ["plan", "plan_until", "role", "last_login_at", "login_count", "nickname", "status",
        "email", "email_verified_at", "password_hash", "password_salt", "locked_until"].forEach(function (k) {
        if (patch && Object.prototype.hasOwnProperty.call(patch, k)) a[k] = patch[k];
      });
      return true;
    },

    listAccounts: function () {
      return Object.keys(db.accounts).map(function (uid) { return db.accounts[uid]; });
    },

    voidCodes: function (uid, purpose, at) {
      Object.keys(db.codes).forEach(function (k) {
        var c = db.codes[k];
        if (c.uid === uid && c.purpose === purpose && !c.consumed_at) c.consumed_at = at;
      });
      return true;
    },

    putVerification: function (rec) { db.verifications[rec.vid] = rec; return rec; },
    getVerification: function (vid) { return db.verifications[vid] || null; },

    patchVerification: function (vid, patch) {
      var r = db.verifications[vid];
      if (!r) return false;
      Object.keys(patch).forEach(function (k) { r[k] = patch[k]; });
      return true;
    },

    voidVerifications: function (uid, at) {
      Object.keys(db.verifications).forEach(function (k) {
        var r = db.verifications[k];
        if (r.uid === uid && !r.consumed_at) r.consumed_at = at;
      });
      return true;
    },

    putReset: function (rec) { db.resets[rec.rid] = rec; return rec; },
    getReset: function (rid) { return db.resets[rid] || null; },
    patchReset: function (rid, patch) {
      var r = db.resets[rid];
      if (!r) return false;
      Object.keys(patch).forEach(function (k) { r[k] = patch[k]; });
      return true;
    },
    voidResets: function (uid, at) {
      Object.keys(db.resets).forEach(function (k) {
        var r = db.resets[k];
        if (r.uid === uid && !r.consumed_at) r.consumed_at = at;
      });
      return true;
    },

    putSession: function (s) { db.sessions[s.sid] = s; return s; },
    getSession: function (sid) { return db.sessions[sid] || null; },
    revokeSession: function (sid) {
      if (db.sessions[sid]) db.sessions[sid].revoked = 1;
      return true;
    },
    revokeSessions: function (uid) {
      Object.keys(db.sessions).forEach(function (k) { if (db.sessions[k].uid === uid) db.sessions[k].revoked = 1; });
      return true;
    },

    listProgress: function (uid, child, since) {
      var cid = child == null ? "" : String(child);
      var out = [];
      Object.keys(db.progress).forEach(function (k) {
        var r = db.progress[k];
        if (r.uid !== uid) return;
        if (String(r.child_id || "") !== cid) return;
        if (since && r.updated_at <= since) return;
        out.push({ poem_id: r.poem_id, payload: r.payload, updated_at: r.updated_at, deleted: r.deleted });
      });
      return out;
    },
    putProgress: function (uid, child, recs) {
      var cid = child == null ? "" : String(child);
      recs.forEach(function (r) {
        var key = uid + "|" + cid + "|" + r.poem_id;
        var cur = db.progress[key];

        if (cur && cur.updated_at > r.updated_at) return;
        db.progress[key] = { uid: uid, child_id: cid, poem_id: r.poem_id, payload: r.payload, updated_at: r.updated_at, deleted: r.deleted ? 1 : 0 };
      });
      return true;
    },

    deleteProgress: function (uid) {
      Object.keys(db.progress).forEach(function (k) { if (db.progress[k].uid === uid) delete db.progress[k]; });
      return true;
    },

    putReport: function (row) { db.reports[row.rid] = row; return { rid: row.rid }; },
    getReport: function (rid) {
      var r = db.reports[rid];
      return Promise.resolve(r || null);
    },
    listReports: function (filter, limit) {
      var f = filter || {};
      var out = Object.keys(db.reports).map(function (k) { return db.reports[k]; });
      if (f.uid) out = out.filter(function (r) { return r.uid === f.uid; });
      if (f.status) out = out.filter(function (r) { return r.status === f.status; });
      if (f.poemId) out = out.filter(function (r) { return r.poem_id === f.poemId; });
      out.sort(function (a, b) { return (b.created_at || 0) - (a.created_at || 0); });
      return Promise.resolve(out.slice(0, limit || 200));
    },
    patchReport: function (rid, patch) {
      var r = db.reports[rid];
      if (!r) return Promise.resolve(null);
      Object.keys(patch || {}).forEach(function (k) { r[k] = patch[k]; });
      return Promise.resolve(r);
    },
    countReports: function (filter) {
      var f = filter || {};
      var counts = { all: 0 };
      Object.keys(db.reports).forEach(function (k) {
        var r = db.reports[k];
        var hit = true;
        if (f.uid && r.uid !== f.uid) hit = false;
        if (f.status && r.status !== f.status) hit = false;
        if (!hit) return;
        counts.all += 1;
        counts[r.status || "new"] = (counts[r.status || "new"] || 0) + 1;
      });
      return Promise.resolve(counts);
    },
    countReportsByUid: function (uid, since) {
      var n = 0;
      var day = since - 86400000;
      Object.keys(db.reports).forEach(function (k) {
        var r = db.reports[k];
        if (r.uid === uid && Number(r.created_at || 0) > day) n += 1;
      });
      return Promise.resolve(n);
    },

    putPinyinProposal: function (row) { db.pinyinProposals[row.fid] = row; return Promise.resolve({ fid: row.fid }); },
    getPinyinProposal: function (fid) { return Promise.resolve(db.pinyinProposals[fid] || null); },
    listPinyinProposals: function (filter, limit) {
      var f = filter || {};
      var out = Object.keys(db.pinyinProposals).map(function (k) { return db.pinyinProposals[k]; });
      if (f.status) out = out.filter(function (r) { return r.status === f.status; });
      if (f.wid != null) out = out.filter(function (r) { return r.wid === f.wid; });
      if (f.line != null) out = out.filter(function (r) { return r.line === f.line; });
      if (f.at != null) out = out.filter(function (r) { return Number(r.at) === Number(f.at); });
      out.sort(function (a, b) { return (b.updated_at || 0) - (a.updated_at || 0); });
      return Promise.resolve(out.slice(0, limit || 300));
    },
    patchPinyinProposal: function (fid, patch) {
      var r = db.pinyinProposals[fid];
      if (!r) return Promise.resolve(null);
      Object.keys(patch || {}).forEach(function (k) { r[k] = patch[k]; });
      return Promise.resolve(r);
    },
    countPinyinProposals: function () {
      var counts = { all: 0 };
      Object.keys(db.pinyinProposals).forEach(function (k) {
        var r = db.pinyinProposals[k];
        counts.all += 1;
        counts[r.status || "pending"] = (counts[r.status || "pending"] || 0) + 1;
      });
      return Promise.resolve(counts);
    },

    putFeedbackThread: function (row) { db.feedbackThreads[row.tid] = row; return Promise.resolve({ tid: row.tid }); },
    getFeedbackThread: function (tid) { return Promise.resolve(db.feedbackThreads[tid] || null); },
    listFeedbackThreads: function (filter, limit) {
      var f = filter || {};
      var out = Object.keys(db.feedbackThreads).map(function (k) { return db.feedbackThreads[k]; });
      if (f.uid) out = out.filter(function (r) { return r.uid === f.uid; });
      if (f.deviceId) out = out.filter(function (r) { return r.device_id === f.deviceId; });
      if (f.status) out = out.filter(function (r) { return r.status === f.status; });
      out.sort(function (a, b) { return (b.updated_at || 0) - (a.updated_at || 0); });
      return Promise.resolve(out.slice(0, limit || 200));
    },
    patchFeedbackThread: function (tid, patch) {
      var r = db.feedbackThreads[tid];
      if (!r) return Promise.resolve(null);
      Object.keys(patch || {}).forEach(function (k) { r[k] = patch[k]; });
      return Promise.resolve(r);
    },
    deleteFeedbackThread: function (tid) {
      if (!db.feedbackThreads[tid]) return Promise.resolve(false);
      delete db.feedbackThreads[tid];
      Object.keys(db.feedbackComments).forEach(function (k) {
        if (db.feedbackComments[k].tid === tid) delete db.feedbackComments[k];
      });
      return Promise.resolve(true);
    },
    countFeedbackThreads: function (filter) {
      var f = filter || {};
      var counts = { all: 0 };
      Object.keys(db.feedbackThreads).forEach(function (k) {
        var r = db.feedbackThreads[k];
        if (f.uid && r.uid !== f.uid) return;
        if (f.deviceId && r.device_id !== f.deviceId) return;
        counts.all += 1;
        counts[r.status || "open"] = (counts[r.status || "open"] || 0) + 1;
      });
      return Promise.resolve(counts);
    },

    putFeedbackComment: function (row) { db.feedbackComments[row.cid] = row; return Promise.resolve({ cid: row.cid }); },
    getFeedbackComment: function (cid) { return Promise.resolve(db.feedbackComments[cid] || null); },
    listFeedbackComments: function (filter, limit) {
      var f = filter || {};
      var out = Object.keys(db.feedbackComments).map(function (k) { return db.feedbackComments[k]; });
      if (f.tid) out = out.filter(function (r) { return r.tid === f.tid; });
      if (f.tids) out = out.filter(function (r) { return f.tids.indexOf(r.tid) >= 0; });
      out.sort(function (a, b) { return (a.created_at || 0) - (b.created_at || 0); });
      return Promise.resolve(out.slice(0, limit || 2000));
    },
    deleteFeedbackComment: function (cid) {
      if (!db.feedbackComments[cid]) return Promise.resolve(false);
      delete db.feedbackComments[cid];
      return Promise.resolve(true);
    },

    putExamRecord: function (row) { db.examRecords[row.eid] = row; return Promise.resolve({ eid: row.eid }); },
    getExamRecord: function (eid) { return Promise.resolve(db.examRecords[eid] || null); },
    listExamRecords: function (filter, limit) {
      var f = filter || {};
      var out = Object.keys(db.examRecords).map(function (k) { return db.examRecords[k]; });
      if (f.uid) out = out.filter(function (r) { return r.uid === f.uid; });
      out.sort(function (a, b) { return (b.created_at || 0) - (a.created_at || 0); });
      return Promise.resolve(out.slice(0, limit || 50));
    },
    deleteExamRecord: function (eid) {
      if (!db.examRecords[eid]) return Promise.resolve(false);
      delete db.examRecords[eid];
      return Promise.resolve(true);
    },

    putScoreRecord: function (row) { db.scoreRecords[row.srid] = row; return Promise.resolve({ srid: row.srid }); },
    listScoreRecords: function (filter, limit) {
      var f = filter || {};
      var out = Object.keys(db.scoreRecords).map(function (k) { return db.scoreRecords[k]; });
      if (f.game) out = out.filter(function (r) { return r.game === f.game; });
      if (f.stage && f.stage !== "all") out = out.filter(function (r) { return r.stage === f.stage; });
      if (f.grade) out = out.filter(function (r) { return Number(r.grade) === Number(f.grade); });
      if (f.term) out = out.filter(function (r) { return Number(r.term) === Number(f.term); });
      if (f.from) out = out.filter(function (r) { return Number(r.created_at) >= Number(f.from); });
      out.sort(function (a, b) { return (b.created_at || 0) - (a.created_at || 0); });
      return Promise.resolve(out.slice(0, limit || 3000));
    },

    getSetting: function (key) { return Promise.resolve(db.settings[key] || null); },
    putSetting: function (key, value) {
      db.settings[key] = { key: key, value: value == null ? null : value };
      return Promise.resolve(db.settings[key]);
    }
  };
  return api;
}

function objectStore() {
  throw new Error("这个部署没有 REST 存储档：线上用 deploy/store-mysql.js。");
}

function reportFilterQs(filter) {
  var parts = [];
  if (filter && filter.uid) parts.push("uid=eq." + q(filter.uid));
  if (filter && filter.status) parts.push("status=eq." + q(filter.status));
  if (filter && filter.poemId) parts.push("poem_id=eq." + q(filter.poemId));
  return parts.length ? "&" + parts.join("&") : "";
}

function attachReportApi(api, call) {
  api.putReport = function (row) {
    return call("/reports", { method: "POST", body: row, prefer: "return=minimal" }).then(function () {
      return { rid: row.rid };
    });
  };
  api.getReport = function (rid) {
    return call("/reports?rid=eq." + q(rid) + "&select=" + REPORT_COLS + "&limit=1")
      .then(function (rows) { return rows && rows[0] ? rows[0] : null; });
  };
  api.listReports = function (filter, limit) {
    var p = "/reports?select=" + REPORT_COLS + reportFilterQs(filter) +
      "&order=created_at.desc&limit=" + encodeURIComponent(String(limit || 200));
    return call(p).then(function (rows) { return rows || []; });
  };
  api.patchReport = function (rid, patch) {
    return call("/reports?rid=eq." + q(rid), {
      method: "PATCH", body: patch, prefer: "return=representation"
    }).then(function (rows) { return rows && rows[0] ? rows[0] : null; });
  };
  api.countReports = function (filter) {

    var base = "/reports?select=status" + reportFilterQs(filter) + "&limit=5000";
    return call(base).then(function (rows) {
      var out = { all: 0 };
      ((require("./core").REPORT_STATUSES) || []).forEach(function (st) { out[st] = 0; });
      (rows || []).forEach(function (r) {
        out.all += 1;
        var st = String((r && r.status) || "new");
        out[st] = (out[st] || 0) + 1;
      });
      return out;
    });
  };
  api.countReportsByUid = function (uid, since) {
    var day = Number(since) - 86400000;
    return call("/reports?select=rid&uid=eq." + q(uid) + "&created_at=gt." + q(day) + "&limit=1000")
      .then(function (rows) { return (rows || []).length; });
  };
  return api;
}

var PINYIN_PROPOSAL_COLS = "fid,wid,line,at,ch,py,prev_py,poem_title,book,status," +
  "proposed_by,proposed_by_name,note,created_at,updated_at,reviewed_by,reviewed_at";

function pinyinProposalFilterQs(filter) {
  var parts = [];
  if (filter && filter.status) parts.push("status=eq." + q(filter.status));
  if (filter && filter.wid != null) parts.push("wid=eq." + q(filter.wid));
  if (filter && filter.line != null) parts.push("line=eq." + q(filter.line));
  if (filter && filter.at != null) parts.push("at=eq." + q(String(filter.at)));
  return parts.length ? "&" + parts.join("&") : "";
}

function attachPinyinProposalApi(api, call) {
  api.putPinyinProposal = function (row) {
    return call("/pinyin_proposals", { method: "POST", body: row, prefer: "return=minimal" }).then(function () {
      return { fid: row.fid };
    });
  };
  api.getPinyinProposal = function (fid) {
    return call("/pinyin_proposals?fid=eq." + q(fid) + "&select=" + PINYIN_PROPOSAL_COLS + "&limit=1")
      .then(function (rows) { return rows && rows[0] ? rows[0] : null; });
  };
  api.listPinyinProposals = function (filter, limit) {
    var p = "/pinyin_proposals?select=" + PINYIN_PROPOSAL_COLS + pinyinProposalFilterQs(filter) +
      "&order=updated_at.desc&limit=" + encodeURIComponent(String(limit || 300));
    return call(p).then(function (rows) { return rows || []; });
  };
  api.patchPinyinProposal = function (fid, patch) {
    return call("/pinyin_proposals?fid=eq." + q(fid), {
      method: "PATCH", body: patch, prefer: "return=representation"
    }).then(function (rows) { return rows && rows[0] ? rows[0] : null; });
  };
  api.countPinyinProposals = function () {
    return call("/pinyin_proposals?select=status&limit=5000").then(function (rows) {
      var out = { all: 0 };
      (rows || []).forEach(function (r) {
        out.all += 1;
        var st = String((r && r.status) || "pending");
        out[st] = (out[st] || 0) + 1;
      });
      return out;
    });
  };
  return api;
}

var FEEDBACK_THREAD_COLS = "tid,uid,device_id,email,nickname,kind,content,status,created_at,updated_at";
var FEEDBACK_COMMENT_COLS = "cid,tid,uid,device_id,author_role,nickname,content,created_at";

function feedbackThreadFilterQs(filter) {
  var parts = [];
  if (filter && filter.uid) parts.push("uid=eq." + q(filter.uid));
  if (filter && filter.deviceId) parts.push("device_id=eq." + q(filter.deviceId));
  if (filter && filter.status) parts.push("status=eq." + q(filter.status));
  return parts.length ? "&" + parts.join("&") : "";
}

function attachFeedbackApi(api, call) {
  api.putFeedbackThread = function (row) {
    return call("/feedback_threads", { method: "POST", body: row, prefer: "return=minimal" }).then(function () {
      return { tid: row.tid };
    });
  };
  api.getFeedbackThread = function (tid) {
    return call("/feedback_threads?tid=eq." + q(tid) + "&select=" + FEEDBACK_THREAD_COLS + "&limit=1")
      .then(function (rows) { return rows && rows[0] ? rows[0] : null; });
  };
  api.listFeedbackThreads = function (filter, limit) {
    var p = "/feedback_threads?select=" + FEEDBACK_THREAD_COLS + feedbackThreadFilterQs(filter) +
      "&order=updated_at.desc&limit=" + encodeURIComponent(String(limit || 200));
    return call(p).then(function (rows) { return rows || []; });
  };
  api.patchFeedbackThread = function (tid, patch) {
    return call("/feedback_threads?tid=eq." + q(tid), {
      method: "PATCH", body: patch, prefer: "return=representation"
    }).then(function (rows) { return rows && rows[0] ? rows[0] : null; });
  };
  api.deleteFeedbackThread = function (tid) {

    return call("/feedback_threads?tid=eq." + q(tid), { method: "DELETE", prefer: "return=minimal" })
      .then(function () { return true; });
  };
  api.countFeedbackThreads = function (filter) {
    var base = "/feedback_threads?select=status" + feedbackThreadFilterQs(filter) + "&limit=5000";
    return call(base).then(function (rows) {
      var out = { all: 0 };
      (rows || []).forEach(function (r) {
        out.all += 1;
        var st = String((r && r.status) || "open");
        out[st] = (out[st] || 0) + 1;
      });
      return out;
    });
  };

  api.putFeedbackComment = function (row) {
    return call("/feedback_comments", { method: "POST", body: row, prefer: "return=minimal" }).then(function () {
      return { cid: row.cid };
    });
  };
  api.getFeedbackComment = function (cid) {
    return call("/feedback_comments?cid=eq." + q(cid) + "&select=" + FEEDBACK_COMMENT_COLS + "&limit=1")
      .then(function (rows) { return rows && rows[0] ? rows[0] : null; });
  };
  api.listFeedbackComments = function (filter, limit) {
    var p = "/feedback_comments?select=" + FEEDBACK_COMMENT_COLS;
    if (filter && filter.tid) p += "&tid=eq." + q(filter.tid);
    else if (filter && filter.tids) p += "&tid=in.(" + filter.tids.map(q).join(",") + ")";
    p += "&order=created_at.asc&limit=" + encodeURIComponent(String(limit || 2000));
    return call(p).then(function (rows) { return rows || []; });
  };
  api.deleteFeedbackComment = function (cid) {
    return call("/feedback_comments?cid=eq." + q(cid), { method: "DELETE", prefer: "return=minimal" })
      .then(function () { return true; });
  };
  return api;
}

var EXAM_RECORD_COLS = "eid,uid,scope_id,scope_label,size,score,total,duration_sec,items,created_at";

function attachExamRecordApi(api, call) {
  api.putExamRecord = function (row) {
    return call("/exam_records", { method: "POST", body: row, prefer: "return=minimal" }).then(function () {
      return { eid: row.eid };
    });
  };
  api.getExamRecord = function (eid) {
    return call("/exam_records?eid=eq." + q(eid) + "&select=" + EXAM_RECORD_COLS + "&limit=1")
      .then(function (rows) { return rows && rows[0] ? rows[0] : null; });
  };
  api.listExamRecords = function (filter, limit) {
    var f = filter || {};
    var p = "/exam_records?select=" + EXAM_RECORD_COLS;
    if (f.uid) p += "&uid=eq." + q(f.uid);
    p += "&order=created_at.desc&limit=" + encodeURIComponent(String(limit || 50));
    return call(p).then(function (rows) { return rows || []; });
  };
  api.deleteExamRecord = function (eid) {
    return call("/exam_records?eid=eq." + q(eid), { method: "DELETE", prefer: "return=minimal" })
      .then(function () { return true; });
  };
  return api;
}

var singleton = null;
function getStore(cfg) {
  if (singleton) return singleton;
  singleton = memoryStore();
  return singleton;
}

module.exports = {
  memoryStore: memoryStore,
  objectStore: objectStore,
  getStore: getStore,
  _reset: function () { singleton = null; }
};
