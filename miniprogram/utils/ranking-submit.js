const store = require("./store");
const remote = require("./remote");
const ranking = require("./ranking");
const league = require("./league");

function entryOf(game) {
  const self = ranking.selfGrade(store.settings());
  const stage = ranking.stageOfGrade(self.grade);
  return {
    game: game,
    stage: stage,
    grade: stage === "all" ? 0 : self.grade,
    term: stage === "all" ? 0 : self.term
  };
}

const tickets = {};

function begin(game) {
  tickets[game] = "";
  if (!remote.configured() || !optedIn()) return Promise.resolve();
  return remote.rankingStart(game).then((ticket) => {
    tickets[game] = ticket;
  });
}

function submit(entry) {
  if (!remote.configured()) return Promise.resolve({ ok: false, offline: true });
  return remote.rankingSubmit(entry);
}

function optedIn() {
  return league.optedIn();
}

function submitPlay(game, fact) {
  const f = fact || {};
  const total = Number(f.total) || 0;
  if (!total) return Promise.resolve({ ok: false, skipped: true });
  if (!optedIn()) return Promise.resolve({ ok: false, on: false, unjoined: true });
  return submit(
    Object.assign(entryOf(game), {
      scopeId: f.scopeId || "",
      score: Math.max(0, Math.min(total, Number(f.score) || 0)),
      total: total,
      durationSec: Number(f.durationSec) || 0,
      ticket: takeTicket(game)
    })
  );
}

function takeTicket(game) {
  const ticket = tickets[game] || "";
  tickets[game] = "";
  return ticket;
}

module.exports = { begin, submit, submitPlay, entryOf, optedIn };
