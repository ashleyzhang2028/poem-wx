const audio = require("../../utils/poem-audio");

Component({
  options: { addGlobalClass: true, virtualHost: true },

  properties: {
    kind: { type: String, value: "one" },
    poem: { type: String, value: "" },
    ids: { type: Array, value: [] },
    book: { type: String, value: "" },
    framed: { type: Boolean, value: false },
    plain: { type: Boolean, value: false }
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
    "kind, poem, ids, book, plain": function () {
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
      const ready = audio.readiness(kind === "list" ? "list" : "one");
      const visible = ready.visible && list.length > 0
        && (kind === "list" || audio.has(this.data.poem));
      const st = audio.status();
      const mine = kind === "one" && st.id === this.data.poem && st.playing;
      const next = {
        visible: visible,
        icon: kind === "list" ? audio.icons.featured : (mine ? audio.icons.pause : audio.icons.play),
        aria: kind === "list" ? "连续播放" : (mine ? "暂停" : "播放本篇"),
        reveal: !!this.data.plain && visible
      };
      if (next.visible === this.data.visible && next.icon === this.data.icon
        && next.reveal === this.data.reveal) return;
      this.setData(next);
    },

    onTap() {
      if (this.data.reveal) {
        this.setData({ plain: false }, () => this.paint());
        return;
      }
      const list = this.queue();
      if (!list.length) return;
      if (this.data.kind === "list") {
        audio.start(list, list[0]);
        return;
      }
      if (audio.status().id === this.data.poem) audio.toggle();
      else audio.play(this.data.poem);
    }
  }
});
