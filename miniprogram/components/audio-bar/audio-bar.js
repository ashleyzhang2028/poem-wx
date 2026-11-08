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
    playing: false,
    playIcon: audio.icons.play,
    modeIcon: audio.icons.repeat,
    modeLabel: audio.MODES[0].label,
    modeOn: audio.MODES[0].on,
    prevIcon: audio.icons.stepBack,
    nextIcon: audio.icons.stepForward,
    stopIcon: audio.icons.stop
  },

  attached() {
    this.onState = (st) => this.setData(st);
    audio.watch(this.onState);
    this.setData(audio.status());
  },

  detached() {
    audio.unwatch(this.onState);
  },

  methods: {
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
