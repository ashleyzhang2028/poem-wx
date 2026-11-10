const BANNER_BASE = "https://706f-poem-d9g1bqeq978682c58-1502724481.tcb.qcloud.la/themes/city/";

const FONT_BASE = "https://706f-poem-d9g1bqeq978682c58-1502724481.tcb.qcloud.la/fonts/";

const DEFAULT_BANNER = "hero.png";

const GROUP = {
  tradition: "tradition",
  landscape: "landscape"
};

const SEED_THEMES = [
  { key: "daiqing", name: "黛青", rgb: [2, 54, 51], group: GROUP.tradition },
  { key: "ink", name: "墨色", rgb: [8, 8, 10], group: GROUP.tradition },
  { key: "muse", name: "暮色", rgb: [79, 96, 114], group: GROUP.tradition },
  { key: "nuahui", name: "暖灰", rgb: [164, 86, 104], group: GROUP.tradition },
  { key: "mich", name: "米褐", rgb: [126, 101, 84], group: GROUP.tradition },
  { key: "shilv", name: "石绿", rgb: [108, 127, 79], group: GROUP.tradition },
  { key: "yanzhi", name: "胭脂", rgb: [157, 41, 51], group: GROUP.tradition },
  { key: "yuqing", name: "雨过天青", rgb: [47, 96, 85], group: GROUP.tradition },
  { key: "datongxuankongsi", name: "大同悬空寺", rgb: [203, 142, 79], banner: "datong_xuankongsi.png", group: GROUP.landscape },
  { key: "eergunashidi", name: "额尔古纳", rgb: [205, 83, 63], banner: "eerguna_shidi.png", group: GROUP.landscape },
  { key: "hulunbeiershiwei", name: "呼伦贝尔室韦", rgb: [53, 131, 166], banner: "hulunbeier_shiwei.png", group: GROUP.landscape },
  { key: "dandongyalujiang", name: "丹东鸭绿江", rgb: [16, 50, 59], banner: "dandong_yalujiang.png", group: GROUP.landscape },
  { key: "benxiguanmenshan", name: "本溪关门山", rgb: [205, 20, 11], banner: "benxi_guanmenshan.png", group: GROUP.landscape },
  { key: "changchunnanling", name: "长春南岭", rgb: [243, 61, 104], banner: "changchun_nanling.png", group: GROUP.landscape },
  { key: "baishanchangbaishan", name: "白山长白山", rgb: [11, 41, 74], banner: "baishan_changbaishan.png", group: GROUP.landscape },
  { key: "chizhoujiuhuashan", name: "池州九华山", rgb: [218, 62, 29], banner: "chizhou_jiuhuashan.png", group: GROUP.landscape },
  { key: "yangzhouguojijichang", name: "扬州国际机场", rgb: [52, 102, 40], banner: "yangzhou_dinggou.png", group: GROUP.landscape },
  { key: "yangzhoushxihu", name: "扬州瘦西湖", rgb: [145, 207, 8], banner: "yangzhou.png", group: GROUP.landscape },
  { key: "chunanqiandaohu", name: "淳安千岛湖", rgb: [23, 100, 59], banner: "chunan_qiandaohu.png", group: GROUP.landscape },
  { key: "fuyangfuchunjiang", name: "富阳富春江", rgb: [26, 37, 35], banner: "fuyang_fuchunjiang.png", group: GROUP.landscape },
  { key: "wenzhouyandangshan", name: "温州雁荡山", rgb: [22, 53, 46], banner: "wenzhou_yandangshan.png", group: GROUP.landscape },
  { key: "nanpingwuyishan", name: "南平武夷山", rgb: [14, 133, 118], banner: "nanping_wuyishan.png", group: GROUP.landscape },
  { key: "zhuhaidongaodao", name: "珠海东澳岛", rgb: [3, 65, 109], banner: "zhuhai_dongaodao.png", group: GROUP.landscape },
  { key: "qingdaolaoshan", name: "青岛崂山", rgb: [33, 56, 63], banner: "qingdao_laoshan.png", group: GROUP.landscape },
  { key: "jiaozuoyuntaishan", name: "焦作云台山", rgb: [96, 146, 64], banner: "jiaozuo_yuntaishan.png", group: GROUP.landscape },
  { key: "qingmingshanghetu", name: "开封上河图", rgb: [107, 153, 7], banner: "kaifeng.png", group: GROUP.landscape },
  { key: "beihaiweizhoudao", name: "北海涠洲岛", rgb: [29, 137, 175], banner: "beihai-weizhoudao.png", group: GROUP.landscape },
  { key: "ganziyading", name: "甘孜亚丁", rgb: [236, 158, 1], banner: "ganzhi_yading.png", group: GROUP.landscape },
  { key: "lijianghutiaoxia", name: "丽江虎跳峡", rgb: [44, 62, 62], banner: "yunnan_hutiaoxia.png", group: GROUP.landscape },
  { key: "lijiangluguhu", name: "丽江泸沽湖", rgb: [25, 91, 108], banner: "lijiang_luguhu.png", group: GROUP.landscape },
  { key: "diqingpudacuo", name: "迪庆普达措", rgb: [20, 151, 190], banner: "xianggelila_pudacuo.png", group: GROUP.landscape },
  { key: "xianbingmayong", name: "西安兵马俑", rgb: [53, 22, 3], banner: "xian_bingmayong.png", group: GROUP.landscape },
  { key: "jiayuguan", name: "嘉峪关", rgb: [249, 139, 57], banner: "jiayuguan.png", group: GROUP.landscape },
  { key: "dunhuangmogaoku", name: "敦煌莫高窟", rgb: [91, 54, 41], banner: "dunhuang_mogaoku.png", group: GROUP.landscape },
  { key: "qinghaiqinghaihu", name: "青海湖", rgb: [10, 49, 76], banner: "qinghai_qinghaihu.png", group: GROUP.landscape },
  { key: "fuyunkeketuohai", name: "富蕴可可托海", rgb: [236, 145, 14], banner: "fuyun_keketuohai.png", group: GROUP.landscape },
  { key: "aletailhemu", name: "阿勒泰禾木", rgb: [35, 60, 75], banner: "aletai_hemu.png", group: GROUP.landscape }
];

const SEED_FONTS = [
  { key: "zhuque", name: "朱雀仿宋", note: "仿宋 · 清瘦利落", dir: "zhuquefangsong-regular" },
  { key: "oldsong", name: "京华老宋", note: "老宋 · 旧籍纸墨", dir: "kinghwa_oldsong_v3" },
  { key: "jinshu", name: "寒蝉锦书宋", note: "宋体 · 锦纹细密", dir: "chilljinshusongpro_regular" },
  { key: "zhenhei", name: "思源真黑", note: "黑体 · 笔画匀净", dir: "siyuan-zhenhei" },
  { key: "huiwen", name: "汇文明朝", note: "明朝 · 横细竖粗", dir: "huiwenmincho-improved" },
  { key: "hanamina", name: "花园明朝", note: "明朝 · 平实端正", dir: "hanamina" },
  { key: "chillkai", name: "寒蝉正楷", note: "正楷 · 端正写意", dir: "chillkai" },
  { key: "cooper", name: "汇迹正楷", note: "正楷 · 刚劲挺括", dir: "cooperzhengkai" },
  { key: "longcang", name: "寒蝉龙藏楷", note: "楷体 · 藏锋有力", dir: "chilllongcangkai_regular" },
  { key: "wenkai", name: "霞鹜文楷", note: "楷体 · 温润随和", dir: "lxgwwenkai-regular" },
  { key: "yozai", name: "悠哉", note: "圆体 · 闲散绵软", dir: "yozai-regular" },
  { key: "qiji", name: "黄令东齐伋", note: "宋体 · 古本筋骨", dir: "qiji" },
  { key: "zhushi", name: "杨任东竹石", note: "行书 · 竹石清劲", dir: "yangrendong-zhushiti" },
  { key: "qingyan", name: "乐米清砚方墨", note: "方墨 · 棱角分明", dir: "lemi-qingyanfangmo" },
  { key: "linhai", name: "临海隶书", note: "隶书 · 蚕头燕尾", dir: "linhai-lishu" }
];

const THEME_GROUPS = [GROUP.tradition, GROUP.landscape];

const KEY = /^[a-z0-9_-]{1,48}$/;

const FILE = /^[A-Za-z0-9._-]{1,128}$/;

const DIR = /^[A-Za-z0-9._-]{1,128}$/;

const URL = /^https?:\/\/[A-Za-z0-9._\/-]+$/;

function swatch(row, pos) {
  if (!row || !KEY.test(String(row.key || ""))) return null;
  const name = String(row.name || "").trim();
  const rgb = Array.isArray(row.rgb) ? row.rgb.map((v) => Number(v)) : [];
  if (!name || rgb.length !== 3 || rgb.some((v) => !Number.isInteger(v) || v < 0 || v > 255)) return null;
  const group = String(row.group || "");
  const banner = String(row.banner || "");
  if (THEME_GROUPS.indexOf(group) < 0) return null;
  if (banner && !FILE.test(banner) && !URL.test(banner)) return null;
  return {
    key: String(row.key),
    name: name,
    rgb: rgb,
    banner: banner || DEFAULT_BANNER,
    group: group,
    pos: pos
  };
}

function face(row, pos) {
  if (!row || !KEY.test(String(row.key || ""))) return null;
  const name = String(row.name || "").trim();
  const base = baseOf(row.base);
  const dir = String(row.dir || "").trim() || (base ? base.slice(0, -1).split("/").pop() : "");
  if (!name || !DIR.test(dir) || !base) return null;
  return {
    key: String(row.key),
    name: name,
    note: String(row.note || "").trim(),
    dir: dir,
    base: base,
    pos: pos
  };
}

function baseOf(v) {
  const s = String(v || "");
  if (!s) return "";
  return s.charAt(s.length - 1) === "/" ? s : s + "/";
}

function list(rows, shape) {
  const out = [];
  const seen = {};
  (Array.isArray(rows) ? rows : []).forEach((row, i) => {
    const hit = shape(row, i);
    if (!hit || seen[hit.key]) return;
    seen[hit.key] = true;
    out.push(hit);
  });
  return out;
}

function themes(rows) {
  const hit = list(rows, swatch);
  if (hit.length) return hit;
  return SEED_THEMES.map((t, i) => Object.assign({}, t, {
    banner: t.banner || DEFAULT_BANNER,
    pos: i
  }));
}

function fonts(rows) {
  const seeded = SEED_FONTS.map((f, i) => Object.assign({ base: FONT_BASE + f.dir + "/" }, f, { pos: i }));
  return list(rows, face).length ? list(rows, face) : seeded;
}

function bannerUrl(file) {
  return BANNER_BASE + (FILE.test(String(file || "")) ? String(file) : DEFAULT_BANNER);
}

function fontUrl(base, size) {
  return String(base) + String(size) + ".";
}

module.exports = {
  BANNER_BASE, FONT_BASE, DEFAULT_BANNER, GROUP,
  SEED_THEMES, SEED_FONTS,
  themes, fonts, bannerUrl
};
