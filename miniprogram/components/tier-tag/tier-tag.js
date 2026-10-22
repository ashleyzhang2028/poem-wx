const tiers = require("../../utils/tiers");

Component({
  properties: {
    tier: { type: String, value: "pro" }
  },

  data: { text: "Pro 起" },

  observers: {
    tier(v) {
      const key = tiers.isTier(v) ? v : "pro";
      this.setData({ text: tiers.nameOf(key) + " 起" });
    }
  }
});
