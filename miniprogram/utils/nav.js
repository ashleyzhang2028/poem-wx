const STATUS_FALLBACK = 20;
const NAV_FALLBACK = 44;
const GAP_FALLBACK = 8;

function statusBarHeight() {
  const read = (fn) => {
    try {
      return Number(fn().statusBarHeight) || 0;
    } catch (e) {
      return 0;
    }
  };
  return (wx.getWindowInfo && read(wx.getWindowInfo))
    || read(wx.getSystemInfoSync)
    || STATUS_FALLBACK;
}

function menuRect() {
  try {
    const r = wx.getMenuButtonBoundingClientRect();
    if (r && r.height > 0 && r.top > 0) return { top: r.top, height: r.height };
  } catch (e) {
    return null;
  }
  return null;
}

function top() {
  const statusBar = statusBarHeight();
  const menu = menuRect();
  return {
    statusBarHeight: statusBar,
    navTop: menu ? menu.top : statusBar + GAP_FALLBACK,
    navBottom: menu ? menu.top + menu.height : statusBar + NAV_FALLBACK,
    navHeight: menu ? (menu.top - statusBar) * 2 + menu.height : NAV_FALLBACK
  };
}

module.exports = { top };
