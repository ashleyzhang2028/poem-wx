-- 跬步 · 腾讯云 MySQL 建表语句
-- ==========================================================================
-- 这是 `poem/api/_lib/schema.sql`（网页版那份 Postgres 建表语句）的 MySQL 译本。
-- 在云托管控制台旁边那台 MySQL 里整段执行即可（幂等，可重复跑）。
--
--   cloud.weixin.qq.com → 云托管 → 服务 poetry 的那个环境 → MySQL
--   → 数据管理 / SQL 窗口 → 粘贴执行
--
-- ⚠️ 两份**先决条件**，少一样整段都会红，而且红法看着像建表语句写错了：
--
--   ① **库要先建**：实例自带的只有 MySQL 自己的那几个库
--      （information_schema / performance_schema / mysql / sys / __cdb_recycle_bin__），
--      DMS 里只列得出它们 —— 不是选错了，是 `poem` 这个库还没建。那五个
--      一个都不能当落点（在 `mysql` 库里建 accounts，是在改账号字典）：
--
--        CREATE DATABASE IF NOT EXISTS `poem`
--          DEFAULT CHARSET utf8mb4 COLLATE utf8mb4_unicode_ci;
--
--   ② **执行前要切库**：下面每一条 `CREATE TABLE` 都**不带库名**，靠的就是当前库。
--      没切会得到一片 `No database selected`：
--
--        USE `poem`;
--        SELECT DATABASE();   -- 回 poem 才算切上了；结尾再 SHOW TABLES; 确认
--
--   库名必须与云托管那栏 `MYSQL_DATABASE` 逐字相同，否则驱动抛
--   `ER_BAD_DB_ERROR`，而进程照起 —— 见 docs/wx-cloud-setup.md § 3.1。
--
-- 与 Postgres 版的三处差别（换库时最容易踩的三个，逐条写在这儿）：
--
--   ① **`jsonb` → `json`**。MySQL 的 `json` 不做 GIN 索引、也不做规范化。
--      这里 `payload` 一直是整取整存（没有行内 JSON 查询），所以没影响 ——
--      但**别顺手加**「按 payload 里某个键筛选」的新查询：那条会全表扫。
--
--   ② **没有 `WHERE` 的 `ON DUPLICATE KEY UPDATE`**。
--      Postgres 那句 `on conflict ... do update ... where excluded.updated_at >= t.updated_at`
--      在 MySQL 里**没有等价写法**，条件只能挪进赋值表达式（见本文件末尾的
--      `kb_upsert_progress`）。**不要**改成应用层的「读-比-写」：那有竞态。
--
--   ③ **`bigint` 的时间戳**。这里存的是 `Date.now()` 毫秒。`bigint` 没问题，
--      但**驱动默认会把超过 2^53 的整数转成字符串** —— 所以
--      `deploy/store-mysql.js` 里每一处读出来的数都过一遍 `Number()`。
--      不这么做，某一天会得到「时间戳是字符串」这种要查半天的错。
--
-- 全局口径（与 Postgres 版同）：
--   1. 不存明文口令，只存 scrypt$N$r$p$salt$hash。
--   2. 账号表里 `email` 是明文（显示与管理员认人用），登录查找走 `email_hash`。
--   3. 索引按查询必用列建：`email_hash` 唯一（登录）、
--      `progress(uid, child_id, poem_id)` 唯一（条件 upsert 用）、
--      `progress(uid, child_id, updated_at)`（增量拉取）。
-- ==========================================================================

-- ---------------------------------------------------------------- accounts
CREATE TABLE IF NOT EXISTS `accounts` (
  `uid`               VARCHAR(64)  NOT NULL,
  `email_hash`        VARCHAR(128) NOT NULL DEFAULT '',
  `nickname`          VARCHAR(64)  NOT NULL DEFAULT '',
  `plan`              VARCHAR(16)  NOT NULL DEFAULT 'free',
  `plan_until`        BIGINT       NULL,
  `role`              VARCHAR(16)  NOT NULL DEFAULT 'user',
  `created_at`        BIGINT       NOT NULL,
  -- 是否登录过的唯一判据：只增不减，每签发一次会话 +1，0 = 从未登录。
  -- 不要用 last_login_at 与 created_at 比大小判断 —— 注册与首次登录可能同一毫秒。
  `last_login_at`     BIGINT       NOT NULL DEFAULT 0,
  `login_count`       INT          NOT NULL DEFAULT 0,
  `status`            VARCHAR(16)  NOT NULL DEFAULT 'active',
  `email`             VARCHAR(255) NOT NULL DEFAULT '',
  `email_verified_at` BIGINT       NULL,
  `password_hash`     VARCHAR(255) NOT NULL DEFAULT '',
  `password_salt`     VARCHAR(128) NOT NULL DEFAULT '',
  -- 锁定改为「锁到几点」：locked_until 空即未锁。status 只表示 pending / active。
  `locked_until`      BIGINT       NULL,
  PRIMARY KEY (`uid`),
  UNIQUE KEY `accounts_email_hash_key` (`email_hash`),
  KEY `accounts_role_idx` (`role`),
  KEY `accounts_email_idx` (`email`(191))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------- 微信账号
-- 微信没有邮箱，所以**不在 accounts 里加列** —— 那会让 email_hash 的唯一索引拦住
-- 第二个微信用户。认人只认 openid / unionid。
-- ⚠️ `uid` 必须与 `accounts.uid` 同一个域，否则同步与管理两头认不出是同一个人。
CREATE TABLE IF NOT EXISTS `wx_accounts` (
  `uid`           VARCHAR(64)  NOT NULL,
  `openid`        VARCHAR(128) NOT NULL,
  `unionid`       VARCHAR(128) NULL,
  `nickname`      VARCHAR(64)  NOT NULL DEFAULT '',
  -- 微信账号的头像地址。当用户授权时由服务端写入；空 = 还没有。
  -- 端上拿不到时会回落到昵称首字印，不拿灰头像冒充（见 docs/design-system.md）。
  `avatar_url`    VARCHAR(512) NOT NULL DEFAULT '',
  `plan`          VARCHAR(16)  NOT NULL DEFAULT 'free',
  `plan_until`    BIGINT       NULL,
  `role`          VARCHAR(16)  NOT NULL DEFAULT 'user',
  `created_at`    BIGINT       NOT NULL,
  `last_login_at` BIGINT       NULL,
  PRIMARY KEY (`uid`),
  UNIQUE KEY `wx_accounts_openid_idx` (`openid`),
  KEY `wx_accounts_unionid_idx` (`unionid`),
  CONSTRAINT `wx_accounts_uid_fkey` FOREIGN KEY (`uid`)
    REFERENCES `accounts` (`uid`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------------- codes
CREATE TABLE IF NOT EXISTS `codes` (
  `code_id`     VARCHAR(64)  NOT NULL,
  `uid`         VARCHAR(64)  NOT NULL,
  `purpose`     VARCHAR(32)  NOT NULL,
  `channel`     VARCHAR(16)  NOT NULL DEFAULT 'email',
  `sent_to`     VARCHAR(255) NOT NULL DEFAULT '',
  `code_hash`   VARCHAR(255) NOT NULL,
  `salt`        VARCHAR(128) NOT NULL,
  `issued_at`   BIGINT       NOT NULL,
  `expires_at`  BIGINT       NOT NULL,
  `attempts`    INT          NOT NULL DEFAULT 0,
  `consumed_at` BIGINT       NULL,
  PRIMARY KEY (`code_id`),
  KEY `codes_uid_purpose_idx` (`uid`, `purpose`),
  KEY `codes_expires_idx` (`expires_at`),
  CONSTRAINT `codes_uid_fkey` FOREIGN KEY (`uid`) REFERENCES `accounts` (`uid`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------- sessions
CREATE TABLE IF NOT EXISTS `sessions` (
  `sid`           VARCHAR(64)  NOT NULL,
  `uid`           VARCHAR(64)  NOT NULL,
  `iat`           BIGINT       NOT NULL,
  `exp`           BIGINT       NOT NULL,
  `revoked`       INT          NOT NULL DEFAULT 0,
  `device`        VARCHAR(64)  NULL,
  -- 刷新那条路要能按 refreshToken 找回这一行 —— 它就是同一枚会话令牌。
  -- 不落这一列的话，刷新永远验不过（见 poem 的 wxIssueSession 那段注释）。
  `refresh_token` VARCHAR(512) NULL,
  PRIMARY KEY (`sid`),
  KEY `sessions_uid_idx` (`uid`),
  KEY `sessions_exp_idx` (`exp`),
  CONSTRAINT `sessions_uid_fkey` FOREIGN KEY (`uid`) REFERENCES `accounts` (`uid`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------- progress
-- 一行 = 一个账号 + 一个孩子 + 一篇。`payload` 整取整存（见文件头上那条 ①）。
CREATE TABLE IF NOT EXISTS `progress` (
  `uid`        VARCHAR(64) NOT NULL,
  `child_id`   VARCHAR(64) NOT NULL DEFAULT '',
  `poem_id`    VARCHAR(80) NOT NULL,
  `payload`    JSON        NOT NULL,
  `updated_at` BIGINT      NOT NULL,
  `deleted`    INT         NOT NULL DEFAULT 0,
  PRIMARY KEY (`uid`, `child_id`, `poem_id`),
  KEY `progress_uid_child_updated_idx` (`uid`, `child_id`, `updated_at`),
  CONSTRAINT `progress_uid_fkey` FOREIGN KEY (`uid`) REFERENCES `accounts` (`uid`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ==========================================================================
-- 条件 upsert：「新的赢，旧的到了也不许覆盖」
-- ==========================================================================
-- ⚠️ **这是整个库唯一一条不许「等价改写」的语句。**
--
-- Postgres 版长这样（条件写在 `WHERE` 上）：
--
--   insert into progress (...) values (...)
--   on conflict (uid, child_id, poem_id) do update
--      set payload = excluded.payload, updated_at = excluded.updated_at, deleted = excluded.deleted
--    where excluded.updated_at >= progress.updated_at;
--
-- MySQL 的 `ON DUPLICATE KEY UPDATE` **没有 `WHERE`**，条件只能塞进赋值表达式，
-- 而且**每一列都要写**：只给 payload 加 `IF(...)`、把 updated_at 无条件盖上去，
-- 就会造出「payload 是旧的、updated_at 是新的」这种一半新一半旧的行 ——
-- 它下一次还会把真正的新值顶掉，而且**到处都不报错**。
--
-- 为什么必须是数据库层的一句话，而不是应用层的「读-比-写」：
-- 断网重连后一批旧数据补发时，两条请求并发会互相穿插，
-- 读到的 `updated_at` 可能已经过时 —— 那就会用旧值盖新值。
-- InnoDB 的行锁在，所以这一句仍然是原子的。
--
-- 下面这个存储过程只是把这条不变式**落在数据库里**，供 DBA 手动核对 / 冷启动
-- 补数据用；服务端实际走的是 `deploy/store-mysql.js` 里拼好的那条多值
-- `INSERT ... ON DUPLICATE KEY UPDATE`（同一个语义，形如）：
--
--   INSERT INTO progress (uid, child_id, poem_id, payload, updated_at, deleted)
--   VALUES (?,?,?,?,?,?)
--   ON DUPLICATE KEY UPDATE
--     payload    = IF(VALUES(updated_at) >= updated_at, VALUES(payload), payload),
--     updated_at = GREATEST(updated_at, VALUES(updated_at)),
--     deleted    = IF(VALUES(updated_at) >= updated_at, VALUES(deleted), deleted)
--
-- ⚠️ `VALUES(col)` 在 MySQL 8.0.20 起被标记为过时（8.4 仍能用，只是警告）。
-- 保留它是因为它从 5.7 起就可用，而云托管那台 MySQL 的版本不一定在 8.0.20 以上。
-- 哪天整个迁到 8.4+，换成 `INSERT ... AS new ON DUPLICATE KEY UPDATE payload = IF(new.updated_at >= updated_at, new.payload, payload) …`。
DROP PROCEDURE IF EXISTS `kb_upsert_progress`;
DELIMITER $$
CREATE PROCEDURE `kb_upsert_progress`(IN p_uid VARCHAR(64), IN p_child_id VARCHAR(64),
                                       IN p_poem_id VARCHAR(80), IN p_payload JSON,
                                       IN p_updated_at BIGINT, IN p_deleted INT)
BEGIN
  INSERT INTO `progress` (`uid`, `child_id`, `poem_id`, `payload`, `updated_at`, `deleted`)
  VALUES (p_uid, p_child_id, p_poem_id, p_payload, p_updated_at, p_deleted)
  ON DUPLICATE KEY UPDATE
    `payload`    = IF(VALUES(`updated_at`) >= `updated_at`, VALUES(`payload`), `payload`),
    `updated_at` = GREATEST(`updated_at`, VALUES(`updated_at`)),
    `deleted`    = IF(VALUES(`updated_at`) >= `updated_at`, VALUES(`deleted`), `deleted`);
END$$
DELIMITER ;

-- -------------------------------------------------------------- 过期清理
-- 对应 Postgres 版的 `kb_purge_expired`。定时探活顺手调一次即可（可选）。
DROP PROCEDURE IF EXISTS `kb_purge_expired`;
DELIMITER $$
CREATE PROCEDURE `kb_purge_expired`(IN now_ms BIGINT)
BEGIN
  DELETE FROM `codes`         WHERE `expires_at` < now_ms;
  DELETE FROM `verifications` WHERE `expires_at` < now_ms;
  DELETE FROM `resets`        WHERE `expires_at` < now_ms;
  DELETE FROM `sessions`      WHERE `exp`        < now_ms;
END$$
DELIMITER ;

-- --------------------------------------------------------- verifications
CREATE TABLE IF NOT EXISTS `verifications` (
  `vid`         VARCHAR(64)  NOT NULL,
  `uid`         VARCHAR(64)  NOT NULL,
  `email_hash`  VARCHAR(128) NOT NULL DEFAULT '',
  `token_hash`  VARCHAR(255) NOT NULL,
  `salt`        VARCHAR(128) NOT NULL,
  `issued_at`   BIGINT       NOT NULL,
  `expires_at`  BIGINT       NOT NULL,
  `attempts`    INT          NOT NULL DEFAULT 0,
  `consumed_at` BIGINT       NULL,
  PRIMARY KEY (`vid`),
  KEY `verifications_uid_idx` (`uid`),
  KEY `verifications_expires_idx` (`expires_at`),
  CONSTRAINT `verifications_uid_fkey` FOREIGN KEY (`uid`) REFERENCES `accounts` (`uid`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------------- resets
CREATE TABLE IF NOT EXISTS `resets` (
  `rid`         VARCHAR(64)  NOT NULL,
  `uid`         VARCHAR(64)  NOT NULL,
  `email`       VARCHAR(255) NOT NULL DEFAULT '',
  `token_hash`  VARCHAR(255) NOT NULL,
  `salt`        VARCHAR(128) NOT NULL,
  `issued_at`   BIGINT       NOT NULL,
  `expires_at`  BIGINT       NOT NULL,
  `attempts`    INT          NOT NULL DEFAULT 0,
  `consumed_at` BIGINT       NULL,
  PRIMARY KEY (`rid`),
  KEY `resets_uid_idx` (`uid`),
  KEY `resets_expires_idx` (`expires_at`),
  CONSTRAINT `resets_uid_fkey` FOREIGN KEY (`uid`) REFERENCES `accounts` (`uid`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------------ reports
-- 报告是写给管理员看的台账，不随账号删除（uid 置空、邮箱快照留住）。
CREATE TABLE IF NOT EXISTS `reports` (
  `rid`         VARCHAR(64)  NOT NULL,
  `uid`         VARCHAR(64)  NULL,
  `email`       VARCHAR(255) NOT NULL DEFAULT '',
  `nickname`    VARCHAR(64)  NOT NULL DEFAULT '',
  `kind`        VARCHAR(32)  NOT NULL DEFAULT 'other',
  `status`      VARCHAR(16)  NOT NULL DEFAULT 'new',
  `poem_id`     VARCHAR(80)  NOT NULL DEFAULT '',
  `poem_title`  VARCHAR(255) NOT NULL DEFAULT '',
  `book`        VARCHAR(64)  NOT NULL DEFAULT '',
  `quote`       TEXT         NULL,
  `context`     TEXT         NULL,
  `note`        TEXT         NULL,
  `suggestion`  TEXT         NULL,
  `device`      VARCHAR(64)  NOT NULL DEFAULT '',
  `ua`          VARCHAR(512) NOT NULL DEFAULT '',
  `created_at`  BIGINT       NOT NULL,
  `updated_at`  BIGINT       NOT NULL,
  `handled_at`  BIGINT       NULL,
  `handled_by`  VARCHAR(64)  NOT NULL DEFAULT '',
  `reply`       TEXT         NULL,
  PRIMARY KEY (`rid`),
  KEY `reports_status_created_idx` (`status`, `created_at`),
  KEY `reports_created_idx` (`created_at`),
  KEY `reports_poem_idx` (`poem_id`),
  KEY `reports_uid_idx` (`uid`),
  CONSTRAINT `reports_uid_fkey` FOREIGN KEY (`uid`) REFERENCES `accounts` (`uid`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------- pinyin_proposals
CREATE TABLE IF NOT EXISTS `pinyin_proposals` (
  `fid`              VARCHAR(64)  NOT NULL,
  `wid`              VARCHAR(80)  NOT NULL,
  `line`             VARCHAR(64)  NOT NULL,
  `at`               INT          NOT NULL DEFAULT 0,
  `ch`               VARCHAR(16)  NOT NULL DEFAULT '',
  `py`               VARCHAR(64)  NOT NULL,
  `prev_py`          VARCHAR(64)  NOT NULL DEFAULT '',
  `poem_title`       VARCHAR(255) NOT NULL DEFAULT '',
  `book`             VARCHAR(64)  NOT NULL DEFAULT '',
  `status`           VARCHAR(16)  NOT NULL DEFAULT 'pending',
  `proposed_by`      VARCHAR(64)  NOT NULL DEFAULT '',
  `proposed_by_name` VARCHAR(64)  NOT NULL DEFAULT '',
  `note`             TEXT         NULL,
  `created_at`       BIGINT       NOT NULL,
  `updated_at`       BIGINT       NOT NULL,
  `reviewed_by`      VARCHAR(64)  NOT NULL DEFAULT '',
  `reviewed_at`      BIGINT       NULL,
  PRIMARY KEY (`fid`),
  KEY `pinyin_proposals_key_idx` (`wid`, `line`, `at`, `status`),
  KEY `pinyin_proposals_status_idx` (`status`, `updated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -------------------------------------------------------- feedback_threads
CREATE TABLE IF NOT EXISTS `feedback_threads` (
  `tid`        VARCHAR(64)  NOT NULL,
  `uid`        VARCHAR(64)  NULL,
  `device_id`  VARCHAR(64)  NOT NULL DEFAULT '',
  `email`      VARCHAR(255) NOT NULL DEFAULT '',
  `nickname`   VARCHAR(64)  NOT NULL DEFAULT '',
  `kind`       VARCHAR(32)  NOT NULL DEFAULT 'other',
  `content`    TEXT         NULL,
  `status`     VARCHAR(16)  NOT NULL DEFAULT 'open',
  `created_at` BIGINT       NOT NULL,
  `updated_at` BIGINT       NOT NULL,
  PRIMARY KEY (`tid`),
  KEY `feedback_threads_uid_idx` (`uid`),
  KEY `feedback_threads_device_idx` (`device_id`),
  KEY `feedback_threads_status_idx` (`status`, `updated_at`),
  CONSTRAINT `feedback_threads_uid_fkey` FOREIGN KEY (`uid`) REFERENCES `accounts` (`uid`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------- feedback_comments
CREATE TABLE IF NOT EXISTS `feedback_comments` (
  `cid`         VARCHAR(64) NOT NULL,
  `tid`         VARCHAR(64) NOT NULL,
  `uid`         VARCHAR(64) NULL,
  `device_id`   VARCHAR(64) NOT NULL DEFAULT '',
  `author_role` VARCHAR(16) NOT NULL DEFAULT 'user',
  `nickname`    VARCHAR(64) NOT NULL DEFAULT '',
  `content`     TEXT        NULL,
  `created_at`  BIGINT      NOT NULL,
  PRIMARY KEY (`cid`),
  KEY `feedback_comments_tid_idx` (`tid`, `created_at`),
  CONSTRAINT `feedback_comments_tid_fkey` FOREIGN KEY (`tid`)
    REFERENCES `feedback_threads` (`tid`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------ exam_records
CREATE TABLE IF NOT EXISTS `exam_records` (
  `eid`          VARCHAR(64)  NOT NULL,
  `uid`          VARCHAR(64)  NOT NULL,
  `scope_id`     VARCHAR(64)  NOT NULL DEFAULT '',
  `scope_label`  VARCHAR(255) NOT NULL DEFAULT '',
  `size`         INT          NOT NULL DEFAULT 0,
  `score`        INT          NOT NULL DEFAULT 0,
  `total`        INT          NOT NULL DEFAULT 0,
  `duration_sec` INT          NOT NULL DEFAULT 0,
  `items`        JSON         NOT NULL,
  `created_at`   BIGINT       NOT NULL,
  PRIMARY KEY (`eid`),
  KEY `exam_records_uid_idx` (`uid`, `created_at`),
  CONSTRAINT `exam_records_uid_fkey` FOREIGN KEY (`uid`) REFERENCES `accounts` (`uid`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ==========================================================================
-- 建完表之后：第一个管理员
-- ==========================================================================
-- 第一个管理员直接在库里改：
--   UPDATE accounts SET role = 'owner' WHERE uid = '<你的 uid>';
-- 其余人由这个 owner 在小程序「我的 → 管理」里发。
