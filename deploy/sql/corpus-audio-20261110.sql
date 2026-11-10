-- 朗读文件名增量补丁：只改 audio 一列，篇目、正文、注释一个不动
-- 由 node scripts/gen-corpus-sql.js 生成，语句与 deploy/sql/corpus-audio.sql 同源
-- 只含这一批 20 首（课内 20 条、目录 0 条），别的行一句不写
-- 每行一条 UPDATE，只按主键改 audio；库里没有那一条就一行不动，不新增行
-- 与 corpus-audio.sql 效果相同，重复执行安全；执行前先切库

SET NAMES utf8mb4;

START TRANSACTION;

UPDATE `corpus_poems` SET `audio` = 'liangzhouci_wanghan.mp3' WHERE `id` = 'poems-xx4-05';
UPDATE `corpus_poems` SET `audio` = 'xiarijueju_liqingzhao.mp3' WHERE `id` = 'poems-xx4-06';
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
