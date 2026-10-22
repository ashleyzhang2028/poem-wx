const store = require("./store");
const remote = require("./remote");
const ranking = require("./ranking");

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

function submit(entry) {
  if (!remote.configured()) return Promise.resolve({ ok: false, offline: true });
  return remote.rankingSubmit(entry);
}

function optedIn() {
  return store.settings().leagueBoard !== false;
}

function submitPlay(game, fact) {
  const f = fact || {};
  const total = Number(f.total) || 0;
  if (!total) return Promise.resolve({ ok: false, skipped: true });
  if (!optedIn()) return Promise.resolve({ ok: false, unjoined: true });
  return submit(
    Object.assign(entryOf(game), {
      scopeId: f.scopeId || "",
      score: Math.max(0, Math.min(total, Number(f.score) || 0)),
      total: total,
      durationSec: Number(f.durationSec) || 0
    })
  );
}

module.exports = { submit, submitPlay, entryOf, optedIn };
