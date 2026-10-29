const remote = require("../../../utils/remote");
const sfx = require("../../../utils/sfx");
const ranking = require("../../../utils/ranking");
const theme = require("../../../utils/theme");
const font = require("../../../utils/font");
const tabbar = require("../../../utils/tabbar");
const gate = require("../../../utils/gate");
const guard = require("../../../utils/guard");
const entitlement = require("../../../utils/entitlement");

Page({
  data: {
    themeStyle: "",
    name: "",
    barBelow: true,
    logged: false,
    allowed: true,
    tier: "max",
    games: ranking.GAMES,
    game: "exam",
    stages: ranking.STAGES,
    periods: ranking.PERIODS,
    stage: "all",
    period: "day",
    grades: [],
    grade: 0,
    terms: [{ key: 1, name: "上册" }, { key: 2, name: "下册" }],
    term: 0,
    board: [],
    podium: [],
    rest: [],
    player: 0,
    me: null,
    beyond: 0,
    label: "",
    empty: ranking.emptyOf("exam"),
    state: "loading",
    reason: ""
  },

  onLoad() {
    const query = ranking.queryOf({ stage: "all", period: "day" });
    this.setData({
      stage: query.stage,
      grade: query.grade,
      term: query.term,
      grades: ranking.gradesOf(query.stage),
      label: ranking.labelOf(query)
    });
  },

  applyFont() {
    const hit = font.bind(theme.style());
    this.setData({ themeStyle: hit.page.themeStyle });
  },

  onShow() {
    this.applyFont();
    const allowed = entitlement.can("league");
    this.setData({
      barBelow: !!tabbar.pick(this),
      logged: gate.logged(),
      allowed: allowed,
      tier: entitlement.tierOf("league")
    });
    this.load();
  },

  onTierGate() {
    wx.navigateTo({ url: "/packages/mine/pricing/pricing" });
  },

  load() {
    if (!this.data.allowed) {
      this.setData({ state: "tier", reason: "" });
      return;
    }
    if (!this.data.logged) {
      this.setData({ state: "login", reason: "" });
      return;
    }
    const query = ranking.queryOf(this.data);
    const key = "rank:" + this.data.game;
    if (guard.busy(key)) return;
    sfx.play("tick");
    this.setData({ state: "loading" });
    this.query = query;
    guard
      .once(key, () => remote.rankingList({
        game: this.data.game,
        stage: query.stage,
        grade: query.grade,
        term: query.term,
        period: query.period,
        size: ranking.DEFAULT_SIZE
      }))
      .then((res) => {
        if (this.query !== query) return;
        if (res.ok) {
          const board = (res.board || []).map(ranking.maskRow);
          const me = res.me ? ranking.maskRow(res.me) : null;
          const mineOnBoard = !!me && board.filter((r) => r.uid === me.uid).length > 0;
          const self = mineOnBoard ? null : me;
          const player = board.filter((r) => r.me)[0];
          this.setData({
            state: board.length || self ? "board" : "empty",
            board: board,
            me: self,
            beyond: ranking.beyondOf(board, res.total),
            podium: ranking.podiumOf(board),
            rest: ranking.restOf(board),
            player: player ? player.rank : 0,
            label: res.label || ranking.labelOf(this.data),
            empty: ranking.emptyOf(this.data.game)
          });
          if (me && me.rank >= 1 && me.rank <= 3) sfx.play("rank");
          return;
        }
        this.setData({ state: "offline", reason: res.reason || "榜单没读上来，稍后再试" });
      })
      ["catch"](() => {
        if (this.query !== query) return;
        this.setData({ state: "offline", reason: "榜单没读上来，稍后再试" });
      });
  },

  onGame(e) {
    const game = e.currentTarget.dataset.k;
    if (!game || game === this.data.game) return;
    this.setData({
      game: game, board: [], podium: [], rest: [], me: null, beyond: 0,
      label: ranking.labelOf(this.data), empty: ranking.emptyOf(game)
    });
    this.load();
  },

  onStage(e) {
    const stage = e.currentTarget.dataset.k;
    if (!stage || stage === this.data.stage) return;
    const grades = ranking.gradesOf(stage);
    this.setData({
      stage: stage, grades: grades, grade: 0, term: 0, label: ranking.labelOf({ stage: stage })
    });
    this.load();
  },

  onGrade(e) {
    const grade = Number(e.currentTarget.dataset.k) || 0;
    if (!grade || grade === this.data.grade) return;
    this.setData({ grade: grade, label: ranking.labelOf({ stage: this.data.stage, grade: grade, term: this.data.term }) });
    this.load();
  },

  onTerm(e) {
    if (!this.data.grade) return;
    const raw = Number(e.currentTarget.dataset.k) || 0;
    const term = raw === this.data.term ? 0 : raw;
    this.setData({ term: term, label: ranking.labelOf({ stage: this.data.stage, grade: this.data.grade, term: term }) });
    this.load();
  },

  onPeriod(e) {
    const period = e.currentTarget.dataset.k;
    if (!period || period === this.data.period) return;
    this.setData({ period: period });
    this.load();
  },

  onRetry() {
    this.load();
  },


  onShareAppMessage() {
    return { title: "古诗文大会排行榜", path: "/packages/ranking/index/index" };
  }
});
