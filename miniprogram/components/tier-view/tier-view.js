const entitlement = require("../../utils/entitlement");
const view = require("../../utils/tier-view");

Component({
  data: {
    logged: false,
    status: {},
    heads: [],
    compareGroups: [],
    compareSummary: [],
    stats: { caps: 0, enabled: 0 }
  },

  attached() {
    this.refresh();
  },

  pageLifetimes: {
    show() {
      this.refresh();
    }
  },

  methods: {
    refresh() {
      const snap = entitlement.snapshot();

      this.setData({
        logged: snap.logged,
        status: snap,
        heads: entitlement.compareCols(snap),
        compareGroups: entitlement.compareGroups(snap),
        compareSummary: entitlement.compareSummary(snap),
        stats: view.stats()
      });
    }
  }
});
