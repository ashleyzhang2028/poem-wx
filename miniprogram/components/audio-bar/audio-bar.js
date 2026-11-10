const audio = require("../../utils/poem-audio");

Component({
  options: { addGlobalClass: true },

  properties: {
    lift: { type: Number, value: 0 }
  },

  data: {
    open: false,
    title: "",
    nextTitle: "",
    cover: audio.COVER,
    coverShown: true,
    playing: false,
    playIcon: audio.icons.play,
    modeIcon: audio.icons.repeat,
    modeLabel: audio.MODES[0].label,
    modeOn: audio.MODES[0].on,
    prevIcon: audio.icons.stepBack,
    nextIcon: audio.icons.stepForward,
    stopIcon: audio.icons.stop,
    percent: 0,
    dragging: false
  },

  attached() {
    this.onState = (st) => this.setData(st);
    audio.watch(this.onState);
    this.onProgress = (percent) => {
      if (!this.data.dragging) this.setData({ percent: percent });
    };
    audio.watchProgress(this.onProgress);
    this.setData(audio.status());
  },

  detached() {
    audio.unwatch(this.onState);
    audio.unwatchProgress(this.onProgress);
  },

  methods: {
    onCoverLoad() {
      if (!this.data.coverShown) this.setData({ coverShown: true });
    },

    onCoverError() {
      if (this.data.coverShown) this.setData({ coverShown: false });
    },

    onDragStart(e) {
      const x = e.touches[0].clientX;
      this.setData({ dragging: true });
      this.createSelectorQuery().select(".audio-bar-line").boundingClientRect((rect) => {
        this.line = rect;
        this.dragTo(x);
      }).exec();
    },

    onDragMove(e) {
      this.dragTo(e.touches[0].clientX);
    },

    onDragEnd() {
      if (!this.data.dragging) return;
      this.setData({ dragging: false });
      audio.seek(this.data.percent);
    },

    dragTo(x) {
      if (!this.line || !this.line.width) return;
      const ratio = (x - this.line.left) / this.line.width * 100;
      this.setData({ percent: Math.max(0, Math.min(100, ratio)) });
    },

    onToggle() {
      audio.toggle();
    },

    onPrev() {
      audio.prev();
    },

    onNext() {
      audio.next();
    },

    onStop() {
      audio.stop();
    },

    onMode() {
      audio.cycle();
    }
  }
});
