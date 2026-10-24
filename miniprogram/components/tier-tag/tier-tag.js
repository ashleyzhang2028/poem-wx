const tag = require("../../utils/tier-tag");
const entitlement = require("../../utils/entitlement");

Component({
  properties: {
    tier: { type: String, value: "pro" }
  },

  data: { text: "", show: false },

  observers: {
    tier(v) {
      this.setData({ text: tag.textOf(v), show: tag.shown(v, this.currentTier()) });
    }
  },

  pageLifetimes: {
    show() {
      this.setData({ show: tag.shown(this.data.tier, this.currentTier()) });
    }
  },

  methods: {
    currentTier() {
      return entitlement.status().tier;
    }
  }
});
