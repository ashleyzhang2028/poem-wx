const tabPage = require("../../utils/tab-page");
Component({
  properties: {
    title: { type: String, value: "登录可用" },
    note: { type: String, value: "" },

    mark: { type: String, value: "" },

    backTo: { type: String, value: "" }
  },

  data: { markText: "" },

  attached() {
    this.setData({ markText: this.data.mark || this.data.title.charAt(0) });
  },

  methods: {
    onLogin() {
      tabPage.back(this.data.backTo);
    }
  }
});
