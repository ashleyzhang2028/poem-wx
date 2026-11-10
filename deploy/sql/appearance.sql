-- 主题与字体清单的初始值：theme_swatches / font_faces 两张表
-- 由 node scripts/gen-appearance-sql.js 从 utils/theme.js 与 utils/font.js 里那份初始清单生成
-- 只在初始化时灌一次；之后改库即改线上，重跑这份 SQL 会把库里手工改过的行冲回去
-- 题图只存文件名（目录在 utils/theme.js 的 THEME_BANNER_BASE），字体子集只存目录名
-- 执行前先切库

SET NAMES utf8mb4;

START TRANSACTION;

INSERT INTO `theme_swatches` (`key`, `name`, `rgb_r`, `rgb_g`, `rgb_b`, `banner`, `group_key`, `pos`) VALUES
  ('daiqing', '黛青', 2, 54, 51, 'hero.png', 'tradition', 0),
  ('ink', '墨色', 8, 8, 10, 'hero.png', 'tradition', 1),
  ('muse', '暮色', 79, 96, 114, 'hero.png', 'tradition', 2),
  ('nuahui', '暖灰', 164, 86, 104, 'hero.png', 'tradition', 3),
  ('mich', '米褐', 126, 101, 84, 'hero.png', 'tradition', 4),
  ('shilv', '石绿', 108, 127, 79, 'hero.png', 'tradition', 5),
  ('yanzhi', '胭脂', 157, 41, 51, 'hero.png', 'tradition', 6),
  ('yuqing', '雨过天青', 47, 96, 85, 'hero.png', 'tradition', 7),
  ('datongxuankongsi', '大同悬空寺', 203, 142, 79, 'datong_xuankongsi.png', 'landscape', 8),
  ('eergunashidi', '额尔古纳', 205, 83, 63, 'eerguna_shidi.png', 'landscape', 9),
  ('hulunbeiershiwei', '呼伦贝尔室韦', 53, 131, 166, 'hulunbeier_shiwei.png', 'landscape', 10),
  ('dandongyalujiang', '丹东鸭绿江', 16, 50, 59, 'dandong_yalujiang.png', 'landscape', 11),
  ('benxiguanmenshan', '本溪关门山', 205, 20, 11, 'benxi_guanmenshan.png', 'landscape', 12),
  ('changchunnanling', '长春南岭', 243, 61, 104, 'changchun_nanling.png', 'landscape', 13),
  ('baishanchangbaishan', '白山长白山', 11, 41, 74, 'baishan_changbaishan.png', 'landscape', 14),
  ('chizhoujiuhuashan', '池州九华山', 218, 62, 29, 'chizhou_jiuhuashan.png', 'landscape', 15),
  ('yangzhouguojijichang', '扬州国际机场', 52, 102, 40, 'yangzhou_dinggou.png', 'landscape', 16),
  ('yangzhoushxihu', '扬州瘦西湖', 145, 207, 8, 'yangzhou.png', 'landscape', 17),
  ('chunanqiandaohu', '淳安千岛湖', 23, 100, 59, 'chunan_qiandaohu.png', 'landscape', 18),
  ('fuyangfuchunjiang', '富阳富春江', 26, 37, 35, 'fuyang_fuchunjiang.png', 'landscape', 19),
  ('wenzhouyandangshan', '温州雁荡山', 22, 53, 46, 'wenzhou_yandangshan.png', 'landscape', 20),
  ('nanpingwuyishan', '南平武夷山', 14, 133, 118, 'nanping_wuyishan.png', 'landscape', 21),
  ('zhuhaidongaodao', '珠海东澳岛', 3, 65, 109, 'zhuhai_dongaodao.png', 'landscape', 22),
  ('qingdaolaoshan', '青岛崂山', 33, 56, 63, 'qingdao_laoshan.png', 'landscape', 23),
  ('jiaozuoyuntaishan', '焦作云台山', 96, 146, 64, 'jiaozuo_yuntaishan.png', 'landscape', 24),
  ('qingmingshanghetu', '开封上河图', 107, 153, 7, 'kaifeng.png', 'landscape', 25),
  ('beihaiweizhoudao', '北海涠洲岛', 29, 137, 175, 'beihai-weizhoudao.png', 'landscape', 26),
  ('ganziyading', '甘孜亚丁', 236, 158, 1, 'ganzhi_yading.png', 'landscape', 27),
  ('lijianghutiaoxia', '丽江虎跳峡', 44, 62, 62, 'yunnan_hutiaoxia.png', 'landscape', 28),
  ('lijiangluguhu', '丽江泸沽湖', 25, 91, 108, 'lijiang_luguhu.png', 'landscape', 29),
  ('diqingpudacuo', '迪庆普达措', 20, 151, 190, 'xianggelila_pudacuo.png', 'landscape', 30),
  ('xianbingmayong', '西安兵马俑', 53, 22, 3, 'xian_bingmayong.png', 'landscape', 31),
  ('jiayuguan', '嘉峪关', 249, 139, 57, 'jiayuguan.png', 'landscape', 32),
  ('dunhuangmogaoku', '敦煌莫高窟', 91, 54, 41, 'dunhuang_mogaoku.png', 'landscape', 33),
  ('qinghaiqinghaihu', '青海湖', 10, 49, 76, 'qinghai_qinghaihu.png', 'landscape', 34),
  ('fuyunkeketuohai', '富蕴可可托海', 236, 145, 14, 'fuyun_keketuohai.png', 'landscape', 35),
  ('aletailhemu', '阿勒泰禾木', 35, 60, 75, 'aletai_hemu.png', 'landscape', 36)
ON DUPLICATE KEY UPDATE `name` = VALUES(`name`), `rgb_r` = VALUES(`rgb_r`), `rgb_g` = VALUES(`rgb_g`), `rgb_b` = VALUES(`rgb_b`), `banner` = VALUES(`banner`), `group_key` = VALUES(`group_key`), `pos` = VALUES(`pos`);

INSERT INTO `font_faces` (`key`, `name`, `note`, `dir`, `pos`) VALUES
  ('zhuque', '朱雀仿宋', '仿宋 · 清瘦利落', 'zhuquefangsong-regular', 0),
  ('oldsong', '京华老宋', '老宋 · 旧籍纸墨', 'kinghwa_oldsong_v3', 1),
  ('jinshu', '寒蝉锦书宋', '宋体 · 锦纹细密', 'chilljinshusongpro_regular', 2),
  ('zhenhei', '思源真黑', '黑体 · 笔画匀净', 'siyuan-zhenhei', 3),
  ('huiwen', '汇文明朝', '明朝 · 横细竖粗', 'huiwenmincho-improved', 4),
  ('hanamina', '花园明朝', '明朝 · 平实端正', 'hanamina', 5),
  ('chillkai', '寒蝉正楷', '正楷 · 端正写意', 'chillkai', 6),
  ('cooper', '汇迹正楷', '正楷 · 刚劲挺括', 'cooperzhengkai', 7),
  ('longcang', '寒蝉龙藏楷', '楷体 · 藏锋有力', 'chilllongcangkai_regular', 8),
  ('wenkai', '霞鹜文楷', '楷体 · 温润随和', 'lxgwwenkai-regular', 9),
  ('yozai', '悠哉', '圆体 · 闲散绵软', 'yozai-regular', 10),
  ('qiji', '黄令东齐伋', '宋体 · 古本筋骨', 'qiji', 11),
  ('zhushi', '杨任东竹石', '行书 · 竹石清劲', 'yangrendong-zhushiti', 12),
  ('qingyan', '乐米清砚方墨', '方墨 · 棱角分明', 'lemi-qingyanfangmo', 13),
  ('linhai', '临海隶书', '隶书 · 蚕头燕尾', 'linhai-lishu', 14)
ON DUPLICATE KEY UPDATE `name` = VALUES(`name`), `note` = VALUES(`note`), `dir` = VALUES(`dir`), `pos` = VALUES(`pos`);

COMMIT;
