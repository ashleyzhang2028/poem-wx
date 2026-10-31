Component({
  properties: {
    state: { type: String, value: "" }
  },

  methods: {
    onRetry() {
      this.triggerEvent("retry");
    }
  }
});
