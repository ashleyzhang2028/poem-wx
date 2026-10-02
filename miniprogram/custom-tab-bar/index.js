/**
 * 自绘底栏（custom tabBar）。
 *
 * 为什么不用原生 tabBar：**原生 tabBar 只认图片**（iconPath / selectedIconPath），
 * 图标必须是 png —— 本项目一条图片资源都不引（主包余量、也免去多套倍图），
 * 图标一律用 CSS 画。原生 tabBar 给不了这个，所以整条底栏自己画。
 *
 * 代价要说清：自绘之后，底栏不再由平台托管 —— 每个 tab 页 onShow 里
 * 要调一次 this.getTabBar().setActive(n)，否则高亮不跟着走。
 * 这一步写在 pages/home · library · search · mine 四个页面的 onShow 里。
 *
 * 形状照参考图：一枚图标在上、一行小字在下；选中的那一项图标嵌进一块
 * 墨黑圆底（填色说「当前在这」），与页面里「选中 = 填墨黑」同一条规矩。
 */
Component({
  data: {
    /** 当前选中项（0 起） */
    active: 0,
    list: [
      { pagePath: "/pages/home/home", text: "背诵", icon: "book" },
      { pagePath: "/pages/library/library", text: "课外", icon: "stack" },
      { pagePath: "/pages/search/search", text: "搜索", icon: "search" },
      { pagePath: "/pages/mine/mine", text: "我的", icon: "person" }
    ]
  },

  methods: {
    setActive(index) {
      if (this.data.active !== index) this.setData({ active: index });
    },

    onTap(e) {
      const i = Number(e.currentTarget.dataset.index);
      const item = this.data.list[i];
      if (!item) return;
      if (i === this.data.active) return;
      wx.switchTab({ url: item.pagePath });
    }
  }
});
