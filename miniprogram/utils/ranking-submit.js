const store = require("./store");
const remote = require("./remote");
const ranking = require("./ranking");

function selfEntry(game) {
  const self = ranking.selfGrade(store.settings());
  return { game: game, stage: self.stage, grade: self.grade, term: self.term };
}

function entryOf(game, fact) {
  const f = fact || {};
  const stage = f.stage || "all";
  const grade = stage === "all" ? 0 : Number(f.grade) || 0;
  return {
    game: game,
    stage: stage,
    grade: grade,
    term: grade && Number(f.term) ? Number(f.term) : 0
  };
}

function submit(entry) {
  return remote.rankingVisible(entry.game).then((vis) => {
    if (!vis.on) return { ok: false, skipped: true };
    return remote.rankingSubmit(entry);
  });
}

function submitPlay(game, fact) {
  const f = fact || {};
  const total = Number(f.total) || 0;
  if (!total) return Promise.resolve({ ok: false, skipped: true });
  return submit(
    Object.assign(entryOf(game, f), {
      scopeId: f.scopeId || "",
      score: Math.max(0, Math.min(total, Number(f.score) || 0)),
      total: total,
      durationSec: Number(f.durationSec) || 0
    })
  );
}

module.exports = { submit, submitPlay, selfEntry, entryOf };
