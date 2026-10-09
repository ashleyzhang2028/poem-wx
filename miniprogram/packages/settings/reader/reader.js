const store = require("../../../utils/store");
const sfx = require("../../../utils/sfx");
const gate = require("../../../utils/gate");
const theme = require("../../../utils/theme");

/* 这一页只装答题音效。
 *
 * 注音三档原来在这儿（MODES / SAMPLE / descOf / onMode），2026-10-04
 * 整块搬去了通用设置的「版式」页 —— 对齐 / 注音 / 字号是同一组版式偏好
 * （正文里它们本来就共用一行），分两页改一处要跑两趟。
 * 这里不再留副本：两处各写一份，早晚会分叉。
 *
 * 搬走之后这一页剩下的只有声音，所以页头也从「阅读」改成「声音」——
 * 页头说的是这一页装什么，不是它原来装过什么。 */

Page({
  data: {
    sfxVisible: false,
    sfxOn: true,
    locked: false
  },

  onShow() {
    theme.apply(this);
    // 未登录：整页换成一张门禁卡。与别页同一道门、同一句话。
    if (!gate.logged()) {
      this.setData({ locked: true, sfxVisible: false });
      return;
    }
    const fx = sfx.readiness();
    // 音效这一格：环境没有音频接口时整块不渲染
    this.setData({ locked: false, sfxVisible: fx.visible, sfxOn: sfx.enabled() });
  },

  onLogin() {
    wx.navigateTo({ url: "/pages/mine/mine?login=1" });
  },

  onSfx(e) {
    this.setData({ sfxOn: sfx.setEnabled(e.detail.value) });
  },

  /** 试听一声：把开关摆在旁边却不给听见的机会，等于让人盲选 */
  onSfxTest() {
    if (!sfx.preview()) {
      wx.showToast({ title: "这台设备出不了声", icon: "none" });
    }
  }
});
