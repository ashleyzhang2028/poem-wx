-- 朗读文件名增量补丁：只改 audio 一列，篇目、正文、注释一个不动
-- 由 node scripts/gen-corpus-sql.js 生成，语句与 deploy/sql/corpus-audio.sql 同源
-- 只含这一批 30 首（课内 30 条、目录 0 条），别的行一句不写
-- 每行一条 UPDATE，只按主键改 audio；库里没有那一条就一行不动，不新增行
-- 与 corpus-audio.sql 效果相同，重复执行安全；执行前先切库

SET NAMES utf8mb4;

START TRANSACTION;

UPDATE `corpus_poems` SET `audio` = 'shier_luyou.mp3' WHERE `id` = 'poems-xx5-03';
UPDATE `corpus_poems` SET `audio` = 'tilinandi_linsheng.mp3' WHERE `id` = 'poems-xx5-04';
UPDATE `corpus_poems` SET `audio` = 'jihaizashi_gongzizhen.mp3' WHERE `id` = 'poems-xx5-05';
UPDATE `corpus_poems` SET `audio` = 'shanjuqiuming_wangwei.mp3' WHERE `id` = 'poems-xx5-06';
UPDATE `corpus_poems` SET `audio` = 'fengqiaoyebo_zhangji.mp3' WHERE `id` = 'poems-xx5-07';
UPDATE `corpus_poems` SET `audio` = 'changxiangsi_nalanxingde.mp3' WHERE `id` = 'poems-xx5-08';
UPDATE `corpus_poems` SET `audio` = 'sishitianyuanzaxing_fanchengda_2.mp3' WHERE `id` = 'poems-xx5-09';
UPDATE `corpus_poems` SET `audio` = 'zhizinongbing_yangwanli.mp3' WHERE `id` = 'poems-xx5-10';
UPDATE `corpus_poems` SET `audio` = 'cunwan_leizhen.mp3' WHERE `id` = 'poems-xx5-11';
UPDATE `corpus_poems` SET `audio` = 'youziyin_mengjiao.mp3' WHERE `id` = 'poems-xx5-12';
UPDATE `corpus_poems` SET `audio` = 'niaomingjian_wangwei.mp3' WHERE `id` = 'poems-xx5-13';
UPDATE `corpus_poems` SET `audio` = 'congjunxing_wangchangling.mp3' WHERE `id` = 'poems-xx5-14';
UPDATE `corpus_poems` SET `audio` = 'wenguanjunshouhenanhebei_dufu.mp3' WHERE `id` = 'poems-xx5-16';
UPDATE `corpus_poems` SET `audio` = 'yugezi_zhangzhihe.mp3' WHERE `id` = 'poems-xx5-17';
UPDATE `corpus_poems` SET `audio` = 'guanshuyougan_zhuxi.mp3' WHERE `id` = 'poems-xx5-18';
UPDATE `corpus_poems` SET `audio` = 'guanshuyougan_zhuxi_2.mp3' WHERE `id` = 'poems-xx5-19';
UPDATE `corpus_poems` SET `audio` = 'changgexing_hanyuefu.mp3' WHERE `id` = 'poems-xx5-21';
UPDATE `corpus_poems` SET `audio` = 'fushudengchengkouzhanshijiaren_linzexu.mp3' WHERE `id` = 'poems-xx5-22';
UPDATE `corpus_poems` SET `audio` = 'songyuanershianxi_wangwei.mp3' WHERE `id` = 'poems-xx5-23';
UPDATE `corpus_poems` SET `audio` = 'hanju_zhengsixiao.mp3' WHERE `id` = 'poems-xx5-24';
UPDATE `corpus_poems` SET `audio` = 'xiangcunsiyue_wengjuan.mp3' WHERE `id` = 'poems-xx5-25';
UPDATE `corpus_poems` SET `audio` = 'sujiandejiang_menghaoran.mp3' WHERE `id` = 'poems-xx6-01';
UPDATE `corpus_poems` SET `audio` = 'liuyueershiqiriwanghulouzuishu_sushi.mp3' WHERE `id` = 'poems-xx6-02';
UPDATE `corpus_poems` SET `audio` = 'xijiangyueyexinghuangshadaozhong_xinqiji.mp3' WHERE `id` = 'poems-xx6-03';
UPDATE `corpus_poems` SET `audio` = 'langtaosha_liuyuxi.mp3' WHERE `id` = 'poems-xx6-04';
UPDATE `corpus_poems` SET `audio` = 'jiangnanchun_dumu.mp3' WHERE `id` = 'poems-xx6-05';
UPDATE `corpus_poems` SET `audio` = 'shuhuyinxianshengbi_wanganshi.mp3' WHERE `id` = 'poems-xx6-06';
UPDATE `corpus_poems` SET `audio` = 'huixiangoushu_hezhizhang.mp3' WHERE `id` = 'poems-xx6-07';
UPDATE `corpus_poems` SET `audio` = 'chunri_zhuxi.mp3' WHERE `id` = 'poems-xx6-19';
UPDATE `corpus_poems` SET `audio` = 'mashi_lihe.mp3' WHERE `id` = 'poems-xx6-22';

COMMIT;
