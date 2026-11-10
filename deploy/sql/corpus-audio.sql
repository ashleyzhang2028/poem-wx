-- 朗读文件名补丁：只改 corpus_poems 的 audio 一列，篇目、正文、注释一个不动
-- 由 node scripts/gen-corpus-sql.js 从 audio/*_map.md 生成，重跑语料 SQL 也会写入同样的值
-- 每行一条 UPDATE，只按主键改 audio；库里没有那一条就一行不动，不新增行
-- 空串不写也不删；执行前先切库

SET NAMES utf8mb4;

START TRANSACTION;

UPDATE `corpus_poems` SET `audio` = 'yonge_luobinwang.mp3' WHERE `id` = 'poems-xx1-01';
UPDATE `corpus_poems` SET `audio` = 'jiangnan_hanyuefu.mp3' WHERE `id` = 'poems-xx1-02';
UPDATE `corpus_poems` SET `audio` = 'hua_yiming.mp3' WHERE `id` = 'poems-xx1-03';
UPDATE `corpus_poems` SET `audio` = 'minnong_lishen.mp3' WHERE `id` = 'poems-xx1-04';
UPDATE `corpus_poems` SET `audio` = 'gulangyuexing_libai.mp3' WHERE `id` = 'poems-xx1-05';
UPDATE `corpus_poems` SET `audio` = 'feng_liqiao.mp3' WHERE `id` = 'poems-xx1-06';
UPDATE `corpus_poems` SET `audio` = 'chunxiao_menghaoran.mp3' WHERE `id` = 'poems-xx1-07';
UPDATE `corpus_poems` SET `audio` = 'zengwanglun_libai.mp3' WHERE `id` = 'poems-xx1-08';
UPDATE `corpus_poems` SET `audio` = 'xunyinzhebuyu_jiadao.mp3' WHERE `id` = 'poems-xx1-10';
UPDATE `corpus_poems` SET `audio` = 'chishang_baijuyi.mp3' WHERE `id` = 'poems-xx1-11';
UPDATE `corpus_poems` SET `audio` = 'xiaochi_yangwanli.mp3' WHERE `id` = 'poems-xx1-12';
UPDATE `corpus_poems` SET `audio` = 'huaji_tangyin.mp3' WHERE `id` = 'poems-xx1-13';
UPDATE `corpus_poems` SET `audio` = 'meihua_wanganshi.mp3' WHERE `id` = 'poems-xx2-01';
UPDATE `corpus_poems` SET `audio` = 'xiaoerchuidiao_hulingneng.mp3' WHERE `id` = 'poems-xx2-02';
UPDATE `corpus_poems` SET `audio` = 'dengguanquelou_wangzhihuan.mp3' WHERE `id` = 'poems-xx2-03';
UPDATE `corpus_poems` SET `audio` = 'wanglushanpubu_libai.mp3' WHERE `id` = 'poems-xx2-04';
UPDATE `corpus_poems` SET `audio` = 'jiangxue_liuzongyuan.mp3' WHERE `id` = 'poems-xx2-05';
UPDATE `corpus_poems` SET `audio` = 'yesushansi_libai.mp3' WHERE `id` = 'poems-xx2-06';
UPDATE `corpus_poems` SET `audio` = 'chilege_beichaominge.mp3' WHERE `id` = 'poems-xx2-07';
UPDATE `corpus_poems` SET `audio` = 'cunju_gaoding.mp3' WHERE `id` = 'poems-xx2-08';
UPDATE `corpus_poems` SET `audio` = 'yongliu_hezhizhang.mp3' WHERE `id` = 'poems-xx2-09';
UPDATE `corpus_poems` SET `audio` = 'fudeguyuancaosongbie_baijuyi.mp3' WHERE `id` = 'poems-xx2-10';
UPDATE `corpus_poems` SET `audio` = 'xiaochujingcisisonglinzifang_yangwanli.mp3' WHERE `id` = 'poems-xx2-11';
UPDATE `corpus_poems` SET `audio` = 'jueju_dufu.mp3' WHERE `id` = 'poems-xx2-12';
UPDATE `corpus_poems` SET `audio` = 'minnong_lishen_2.mp3' WHERE `id` = 'poems-xx2-13';
UPDATE `corpus_poems` SET `audio` = 'zhouyeshusuojian_zhashenxing.mp3' WHERE `id` = 'poems-xx2-14';
UPDATE `corpus_poems` SET `audio` = 'suojian_yuanmei.mp3' WHERE `id` = 'poems-xx3-01';
UPDATE `corpus_poems` SET `audio` = 'shanxing_dumu.mp3' WHERE `id` = 'poems-xx3-02';
UPDATE `corpus_poems` SET `audio` = 'zengliujingwen_sushi.mp3' WHERE `id` = 'poems-xx3-03';
UPDATE `corpus_poems` SET `audio` = 'yeshusuojian_yeshaoweng.mp3' WHERE `id` = 'poems-xx3-04';
UPDATE `corpus_poems` SET `audio` = 'wangtianmenshan_libai.mp3' WHERE `id` = 'poems-xx3-05';
UPDATE `corpus_poems` SET `audio` = 'yinhushangchuqinghouyu_sushi.mp3' WHERE `id` = 'poems-xx3-06';
UPDATE `corpus_poems` SET `audio` = 'wangdongting_liuyuxi.mp3' WHERE `id` = 'poems-xx3-07';
UPDATE `corpus_poems` SET `audio` = 'zaofabaidicheng_libai.mp3' WHERE `id` = 'poems-xx3-08';
UPDATE `corpus_poems` SET `audio` = 'cailianqu_wangchangling.mp3' WHERE `id` = 'poems-xx3-09';
UPDATE `corpus_poems` SET `audio` = 'huichongchunjiangwanjing_sushi.mp3' WHERE `id` = 'poems-xx3-11';
UPDATE `corpus_poems` SET `audio` = 'sanqudaozhong_zengji.mp3' WHERE `id` = 'poems-xx3-12';
UPDATE `corpus_poems` SET `audio` = 'yijiangnan_baijuyi.mp3' WHERE `id` = 'poems-xx3-13';
UPDATE `corpus_poems` SET `audio` = 'yuanri_wanganshi.mp3' WHERE `id` = 'poems-xx3-14';
UPDATE `corpus_poems` SET `audio` = 'qingming_dumu.mp3' WHERE `id` = 'poems-xx3-15';
UPDATE `corpus_poems` SET `audio` = 'jiuyuejiuriyishandongxiongdi_wangwei.mp3' WHERE `id` = 'poems-xx3-16';
UPDATE `corpus_poems` SET `audio` = 'chuzhouxijian_weiyingwu.mp3' WHERE `id` = 'poems-xx3-17';
UPDATE `corpus_poems` SET `audio` = 'dalinsitaohua_baijuyi.mp3' WHERE `id` = 'poems-xx3-18';
UPDATE `corpus_poems` SET `audio` = 'mujiangyin_baijuyi.mp3' WHERE `id` = 'poems-xx4-01';
UPDATE `corpus_poems` SET `audio` = 'tixilinbi_sushi.mp3' WHERE `id` = 'poems-xx4-02';
UPDATE `corpus_poems` SET `audio` = 'xuemei_luyue.mp3' WHERE `id` = 'poems-xx4-03';
UPDATE `corpus_poems` SET `audio` = 'chusai_wangchangling.mp3' WHERE `id` = 'poems-xx4-04';
UPDATE `corpus_poems` SET `audio` = 'liangzhouci_wanghan.mp3' WHERE `id` = 'poems-xx4-05';
UPDATE `corpus_poems` SET `audio` = 'xiarijueju_liqingzhao.mp3' WHERE `id` = 'poems-xx4-06';
UPDATE `corpus_poems` SET `audio` = 'biedongda_gaoshi.mp3' WHERE `id` = 'poems-xx4-07';
UPDATE `corpus_poems` SET `audio` = 'suxinshixugongdian_yangwanli.mp3' WHERE `id` = 'poems-xx4-08';
UPDATE `corpus_poems` SET `audio` = 'sishitianyuanzaxing_fanchengda.mp3' WHERE `id` = 'poems-xx4-09';
UPDATE `corpus_poems` SET `audio` = 'qingpingyuecunju_xinqiji.mp3' WHERE `id` = 'poems-xx4-10';
UPDATE `corpus_poems` SET `audio` = 'busuanziyongmei_maozedong.mp3' WHERE `id` = 'poems-xx4-11';
UPDATE `corpus_poems` SET `audio` = 'feng_luoyin.mp3' WHERE `id` = 'poems-xx4-12';
UPDATE `corpus_poems` SET `audio` = 'duzuojingtingshan_libai.mp3' WHERE `id` = 'poems-xx4-13';
UPDATE `corpus_poems` SET `audio` = 'momei_wangmian.mp3' WHERE `id` = 'poems-xx4-15';
UPDATE `corpus_poems` SET `audio` = 'hanjianglinfan_wangwei.mp3' WHERE `id` = 'poems-xx4-16';
UPDATE `corpus_poems` SET `audio` = 'luchai_wangwei.mp3' WHERE `id` = 'poems-xx4-17';
UPDATE `corpus_poems` SET `audio` = 'change_lishangyin.mp3' WHERE `id` = 'poems-xx4-18';
UPDATE `corpus_poems` SET `audio` = 'zhuzhici_liuyuxi.mp3' WHERE `id` = 'poems-xx4-19';
UPDATE `corpus_poems` SET `audio` = 'furonglousongxinjian_wangchangling.mp3' WHERE `id` = 'poems-xx4-20';
UPDATE `corpus_poems` SET `audio` = 'saixiaqu_lulun.mp3' WHERE `id` = 'poems-xx4-21';
UPDATE `corpus_poems` SET `audio` = 'saixiaqu_lulun_2.mp3' WHERE `id` = 'poems-xx4-22';
UPDATE `corpus_poems` SET `audio` = 'huanghelousongmenghaoranzhiguangling_libai.mp3' WHERE `id` = 'poems-xx4-23';
UPDATE `corpus_poems` SET `audio` = 'qiuyejiangxiaochulimenyingliangyougan_luyou.mp3' WHERE `id` = 'poems-xx4-24';
UPDATE `corpus_poems` SET `audio` = 'chan_yushinan.mp3' WHERE `id` = 'poems-xx5-01';
UPDATE `corpus_poems` SET `audio` = 'qiqiao_linjie.mp3' WHERE `id` = 'poems-xx5-02';

COMMIT;
