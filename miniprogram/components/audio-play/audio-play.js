const audio = require("../../utils/poem-audio");

Component({
  options: { addGlobalClass: true },

  properties: {
    kind: { type: String, value: "one" },
    poem: { type: String, value: "" },
    ids: { type: Array, value: [] },
    book: { type: String, value: "" }
  },

  data: {
    visible: false,
    icon: audio.icons.play,
    aria: "播放本篇"
  },

  attached() {
    this.onState = () => this.paint();
    audio.watch(this.onState);
    this.paint();
  },

  detached() {
    audio.unwatch(this.onState);
  },

  observers: {
    "kind, poem, ids, book": function () {
      this.paint();
    }
  },

  methods: {
    queue() {
      const list = this.data.ids && this.data.ids.length
        ? this.data.ids
        : audio.bookIds(this.data.book);
      return audio.matched(list);
    },

    paint() {
      const kind = this.data.kind;
      const list = this.queue();
      const visible = audio.readiness().visible && list.length > 0
        && (kind === "list" || audio.has(this.data.poem));
      const st = audio.status();
      const mine = kind === "one" && st.id === this.data.poem && st.playing;
      const next = {
        visible: visible,
        icon: kind === "list" ? audio.icons.featured : (mine ? audio.icons.pause : audio.icons.play),
        aria: kind === "list" ? "连续播放" : (mine ? "暂停" : "播放本篇")
      };
      if (next.visible === this.data.visible && next.icon === this.data.icon) return;
      this.setData(next);
    },

    onTap() {
      const list = this.queue();
      if (!list.length) return;
      if (this.data.kind === "list") {
        audio.start(list, list[0]);
        return;
      }
      if (audio.status().id === this.data.poem) audio.toggle();
      else audio.start(list, this.data.poem);
    }
  }
});
