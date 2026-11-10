-- 朗读文件名补丁：只改 corpus_poems 的 audio 一列，篇目、正文、注释一个不动
-- 由 node scripts/gen-corpus-sql.js 从 audio/*_map.md 生成，重跑语料 SQL 也会写入同样的值
-- 只写有文件的那几行，空串不写也不删；执行前先切库

SET NAMES utf8mb4;

START TRANSACTION;

INSERT INTO `corpus_poems` (`id`, `audio`) VALUES
  ('poems-xx1-01', 'yonge_luobinwang.mp3'),
  ('poems-xx1-02', 'jiangnan_hanyuefu.mp3'),
  ('poems-xx1-03', 'hua_yiming.mp3'),
  ('poems-xx1-04', 'minnong_lishen.mp3'),
  ('poems-xx1-05', 'gulangyuexing_libai.mp3'),
  ('poems-xx1-06', 'feng_liqiao.mp3'),
  ('poems-xx1-07', 'chunxiao_menghaoran.mp3'),
  ('poems-xx1-08', 'zengwanglun_libai.mp3'),
  ('poems-xx1-10', 'xunyinzhebuyu_jiadao.mp3'),
  ('poems-xx1-11', 'chishang_baijuyi.mp3'),
  ('poems-xx1-12', 'xiaochi_yangwanli.mp3'),
  ('poems-xx1-13', 'huaji_tangyin.mp3'),
  ('poems-xx2-01', 'meihua_wanganshi.mp3'),
  ('poems-xx2-02', 'xiaoerchuidiao_hulingneng.mp3'),
  ('poems-xx2-03', 'dengguanquelou_wangzhihuan.mp3'),
  ('poems-xx2-04', 'wanglushanpubu_libai.mp3'),
  ('poems-xx2-05', 'jiangxue_liuzongyuan.mp3'),
  ('poems-xx2-06', 'yesushansi_libai.mp3'),
  ('poems-xx2-07', 'chilege_beichaominge.mp3'),
  ('poems-xx2-08', 'cunju_gaoding.mp3'),
  ('poems-xx2-09', 'yongliu_hezhizhang.mp3'),
  ('poems-xx2-10', 'fudeguyuancaosongbie_baijuyi.mp3'),
  ('poems-xx2-11', 'xiaochujingcisisonglinzifang_yangwanli.mp3'),
  ('poems-xx2-12', 'jueju_dufu.mp3'),
  ('poems-xx2-13', 'minnong_lishen_2.mp3'),
  ('poems-xx2-14', 'zhouyeshusuojian_zhashenxing.mp3'),
  ('poems-xx3-01', 'suojian_yuanmei.mp3'),
  ('poems-xx3-02', 'shanxing_dumu.mp3'),
  ('poems-xx3-03', 'zengliujingwen_sushi.mp3'),
  ('poems-xx3-04', 'yeshusuojian_yeshaoweng.mp3'),
  ('poems-xx3-05', 'wangtianmenshan_libai.mp3'),
  ('poems-xx3-06', 'yinhushangchuqinghouyu_sushi.mp3'),
  ('poems-xx3-07', 'wangdongting_liuyuxi.mp3'),
  ('poems-xx3-08', 'zaofabaidicheng_libai.mp3'),
  ('poems-xx3-09', 'cailianqu_wangchangling.mp3'),
  ('poems-xx3-11', 'huichongchunjiangwanjing_sushi.mp3'),
  ('poems-xx3-12', 'sanqudaozhong_zengji.mp3'),
  ('poems-xx3-13', 'yijiangnan_baijuyi.mp3'),
  ('poems-xx3-14', 'yuanri_wanganshi.mp3'),
  ('poems-xx3-15', 'qingming_dumu.mp3'),
  ('poems-xx3-16', 'jiuyuejiuriyishandongxiongdi_wangwei.mp3'),
  ('poems-xx3-17', 'chuzhouxijian_weiyingwu.mp3'),
  ('poems-xx3-18', 'dalinsitaohua_baijuyi.mp3'),
  ('poems-xx4-01', 'mujiangyin_baijuyi.mp3'),
  ('poems-xx4-02', 'tixilinbi_sushi.mp3'),
  ('poems-xx4-03', 'xuemei_luyue.mp3'),
  ('poems-xx4-04', 'chusai_wangchangling.mp3'),
  ('poems-xx4-07', 'biedongda_gaoshi.mp3')
ON DUPLICATE KEY UPDATE `audio` = VALUES(`audio`);

COMMIT;
