const store = require("../../../utils/store");
const remote = require("../../../utils/remote");
const ranking = require("../../../utils/ranking");
const theme = require("../../../utils/theme");
const tabbar = require("../../../utils/tabbar");
const gate = require("../../../utils/gate");
const tabPage = require("../../../utils/tab-page");

Page({
  data: {
    themeStyle: "",
    barBelow: true,
    logged: false,
    games: ranking.GAMES,
    game: "exam",
    gameDesc: "",
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
    me: null,
    size: ranking.DEFAULT_SIZE,
    beyond: 0,
    label: "",
    empty: ranking.emptyOf("exam"),
    state: "loading",
    reason: ""
  },

  onLoad() {
    const self = ranking.selfGrade(store.settings());
    const query = ranking.queryOf({ stage: self.stage, grade: self.grade, term: self.term, period: "day" });
    this.setData({
      stage: query.stage,
      grade: query.grade,
      term: query.term,
      grades: ranking.gradesOf(query.stage),
      gameDesc: ranking.gameOf("exam").desc
    });
  },

  onShow() {
    theme.apply(this);
    this.setData({
      barBelow: !!tabbar.pick(this),
      logged: gate.logged()
    });
    this.load();
  },

  load() {
    if (!this.data.logged) {
      this.setData({ state: "login", reason: "" });
      return;
    }
    this.setData({ state: "loading" });
    const game = this.data.game;
    remote
      .rankingVisible(game)
      .then((vis) => {
        if (vis.offline) {
          this.setData({ state: "offline", reason: "同步服务没接上，榜单看不了" });
          return null;
        }
        if (!vis.on) {
          this.setData({ state: "off", reason: "" });
          return null;
        }
        return remote.rankingList({
          game: game,
          stage: this.data.stage,
          grade: this.data.grade,
          term: this.data.term,
          period: this.data.period,
          size: ranking.DEFAULT_SIZE
        });
      })
      .then((res) => {
        if (!res) return;
        if (!res.ok) {
          this.setData({ state: "offline", reason: "榜单没读上来，稍后再试" });
          return;
        }
        const board = (res.board || []).map(ranking.maskRow);
        const size = res.size || this.data.size;
        this.setData({
          state: board.length ? "board" : "empty",
          board: board,
          size: size,
          me: res.me ? ranking.maskRow(res.me) : null,
          beyond: ranking.beyondOf(board, size, res.total),
          podium: ranking.podiumOf(board),
          rest: ranking.restOf(board),
          label: res.label || ranking.labelOf(this.data),
          empty: ranking.emptyOf(game)
        });
      })
      .catch(() => {
        this.setData({ state: "offline", reason: "榜单没读上来，稍后再试" });
      });
  },

  onGame(e) {
    const game = e.currentTarget.dataset.k;
    if (!game || game === this.data.game) return;
    this.setData({ game: game, gameDesc: ranking.gameOf(game).desc, board: [], podium: [], rest: [], me: null, beyond: 0 });
    this.load();
  },

  onStage(e) {
    const stage = e.currentTarget.dataset.k;
    if (!stage || stage === this.data.stage) return;
    const grades = ranking.gradesOf(stage);
    const grade = grades.length ? grades[0].key : 0;
    this.setData({ stage: stage, grades: grades, grade: grade, term: grade ? 1 : 0 });
    this.load();
  },

  onGrade(e) {
    const grade = Number(e.currentTarget.dataset.k) || 0;
    if (grade === this.data.grade) return;
    this.setData({ grade: grade, term: grade && !this.data.term ? 1 : this.data.term });
    this.load();
  },

  onTerm(e) {
    const term = Number(e.currentTarget.dataset.k) || 0;
    if (term === this.data.term) return;
    this.setData({ term: term });
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

  onLogin() {
    tabPage.mine();
  },

  onShareAppMessage() {
    return { title: "跬步 · 古诗词大会排行榜", path: "/packages/ranking/index/index" };
  }
});
