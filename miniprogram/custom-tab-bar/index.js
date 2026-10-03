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
 * 形状照参考图：一枚图标在上、一行小字在下；选中的那一项图标嵌进一枚
 * 主题色圆底（圆底说「当前在这」），圆底上再描一圈它自己的字色好让浅色
 * 主题也看得出选中。这是方案 A —— B 方案（整格填色）试过，用户选了 A，
 * 详见 index.wxss 开头。
 */
const theme = require("../utils/theme");

Component({
  data: {
    /** 当前选中项（0 起） */
    active: 0,
    /** 主题内联样式。底栏虽然在页面树里（CSS 变量会继承），
        但自定义 tabBar 的挂载位置由平台决定 —— 与其赌它一定继承得到，
        不如自己读一次。多读一次的成本是一件本机存储。 */
    themeStyle: "",
    list: [
      { pagePath: "/pages/home/home", text: "背诵", icon: "book" },
      { pagePath: "/pages/library/library", text: "课外", icon: "stack" },
      { pagePath: "/pages/search/search", text: "搜索", icon: "search" },
      { pagePath: "/pages/mine/mine", text: "我的", icon: "person" }
    ]
  },

  attached() {
    this.setData({ themeStyle: theme.style() });
  },

  methods: {
    setActive(index) {
      // 顺手刷一次主题：用户可能在设置页换了色，回来时底栏要跟上。
      // setActive 是每个 tab 页 onShow 都会调的那一拍，正好。
      const themeStyle = theme.style();
      const patch = { themeStyle };
      if (this.data.active !== index) patch.active = index;
      this.setData(patch);
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
