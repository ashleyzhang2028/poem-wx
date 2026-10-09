-- 跬步 · 数据库（Supabase / Postgres）
-- ==========================================================================
-- 四张基表 + 后续迁移，与 docs/architecture.md §2.1 对应。
-- 在 Supabase 控制台的 SQL Editor 里整段执行即可（幂等，可重复跑）。
--
-- ⚠️ 本文件是累计的：后面的迁移会改掉前面建表时的形状，以最后落定的为准。
--
-- 全局口径：
--   1. 不存明文口令，只存 scrypt$N$r$p$salt$hash（参数写进串里，便于日后调参）。
--      邮箱明文是落库的（accounts.email），登录查找仍走 email_hash；明文只用于
--      显示与管理员认人。
--   2. RLS 全部开启且不给任何策略——所有访问走服务端 service key，anon key
--      读不到任何一行。
--   3. 索引按查询必用列建：email_hash 唯一（登录）、
--      progress(uid, child_id, poem_id) 唯一（条件 upsert 用）。
-- ==========================================================================

-- ---------------------------------------------------------------- accounts
create table if not exists public.accounts (
  uid           text primary key,
  email_hash    text        not null,
  nickname      text        not null default '',
  plan          text        not null default 'free',
  plan_until    bigint,
  role          text        not null default 'user',
  created_at    bigint      not null,
  last_login_at bigint      not null,
  -- 是否登录过的唯一判据：只增不减，每签发一次会话 +1，0 = 从未登录。
  -- 不要用 last_login_at 与 created_at 比大小判断——注册与首次登录可能同一毫秒。
  login_count   int         not null default 0,
  status        text        not null default 'active'
);
create unique index if not exists accounts_email_hash_key on public.accounts (email_hash);
create index if not exists accounts_role_idx on public.accounts (role) where role <> 'user';

-- ------------------------------------------------------------------- codes
create table if not exists public.codes (
  code_id     text primary key,
  uid         text   not null references public.accounts(uid) on delete cascade,
  purpose     text   not null,
  channel     text   not null default 'email',
  sent_to     text   not null,
  code_hash   text   not null,
  salt        text   not null,
  issued_at   bigint not null,
  expires_at  bigint not null,
  attempts    int    not null default 0,
  consumed_at bigint
);
create index if not exists codes_uid_purpose_idx on public.codes (uid, purpose);
create index if not exists codes_expires_idx on public.codes (expires_at);

-- ---------------------------------------------------------------- sessions
create table if not exists public.sessions (
  sid     text primary key,
  uid     text   not null references public.accounts(uid) on delete cascade,
  iat     bigint not null,
  exp     bigint not null,
  revoked int    not null default 0,
  device  text
);
create index if not exists sessions_uid_idx on public.sessions (uid);

-- ---------------------------------------------------------------- progress
create table if not exists public.progress (
  uid        text   not null references public.accounts(uid) on delete cascade,
  poem_id    text   not null,
  payload    jsonb  not null default '{}'::jsonb,
  updated_at bigint not null,
  deleted    int    not null default 0,
  primary key (uid, poem_id)
);
create index if not exists progress_uid_updated_idx on public.progress (uid, updated_at);

-- -------------------------------------------------------------------- RLS
alter table public.accounts enable row level security;
alter table public.codes    enable row level security;
alter table public.sessions enable row level security;
alter table public.progress enable row level security;

-- ---------------------------------------------------------------- 条件 upsert
-- 不用 PostgREST 的 merge-duplicates：它展开成无条件 UPDATE，同步到达顺序
-- 不保证时（断网重连后一批旧数据补发）会用旧值覆盖新值。where 子句把
-- “只接受更新的时间戳”这条约束下沉到数据库层，不能只留在 JS 里。
create or replace function public.kb_upsert_progress(rows jsonb)
returns void
language sql
security definer
as $$
  insert into public.progress (uid, poem_id, payload, updated_at, deleted)
  select r->>'uid',
         r->>'poem_id',
         coalesce(r->'payload', '{}'::jsonb),
         (r->>'updated_at')::bigint,
         coalesce((r->>'deleted')::int, 0)
    from jsonb_array_elements(rows) as r
  on conflict (uid, poem_id) do update
     set payload    = excluded.payload,
         updated_at = excluded.updated_at,
         deleted    = excluded.deleted
   where excluded.updated_at >= public.progress.updated_at;
$$;

-- ==========================================================================
-- 5.3 跨设备分档案：进度按孩子（child_id）分区
-- ==========================================================================
-- 一个账号下可以有几个孩子（不建独立账号，只是同一账号下的展示名 + 一份进度）。
-- 第一个孩子的 child_id 是空串而非新编号，与本机键映射同源，避免迁移半途
-- 断电导致数据错位。名册（一个账号一行）也存在 progress 里（poem_id =
-- 'family:v1'），不新开表，避免两套存储实现的键集合不一致。
-- --------------------------------------------------------------------------

alter table public.progress add column if not exists child_id text not null default '';

alter table public.progress drop constraint if exists progress_pkey;
alter table public.progress add primary key (uid, child_id, poem_id);

drop index if exists public.progress_uid_updated_idx;
create index if not exists progress_uid_child_updated_idx
  on public.progress (uid, child_id, updated_at);

-- on conflict 的列必须与主键逐字一致，故整段重写。
create or replace function public.kb_upsert_progress(rows jsonb)
returns void
language sql
security definer
as $$
  insert into public.progress (uid, child_id, poem_id, payload, updated_at, deleted)
  select r->>'uid',
         coalesce(r->>'child_id', ''),
         r->>'poem_id',
         coalesce(r->'payload', '{}'::jsonb),
         (r->>'updated_at')::bigint,
         coalesce((r->>'deleted')::int, 0)
    from jsonb_array_elements(rows) as r
  on conflict (uid, child_id, poem_id) do update
     set payload    = excluded.payload,
         updated_at = excluded.updated_at,
         deleted    = excluded.deleted
   where excluded.updated_at >= public.progress.updated_at;
$$;

-- ==========================================================================
-- 6. 完整登录流程：注册 / 确认邮件 / 登录 / 忘记密码 / 重设密码
-- ==========================================================================
-- 口令是随机码登录之外新加的一条路，codes 表不受影响。明文口令永远不落库，
-- 只存 scrypt 摘要。邮箱明文落库，登录仍走 email_hash。email_verified_at
-- 为空则不能登录——它是登录闸（core.emailGate() 读取），不是参考字段。
-- ==========================================================================

-- 明文邮箱 + 确认时刻 + 口令摘要：均可为空，兼容未回填的老账号。
alter table public.accounts add column if not exists email              text not null default '';
alter table public.accounts add column if not exists email_verified_at  bigint;
alter table public.accounts add column if not exists password_hash      text not null default '';
alter table public.accounts add column if not exists password_salt      text not null default '';

create index if not exists accounts_email_idx on public.accounts (lower(email)) where email <> '';

-- 邮箱确认令牌：与 codes 分表，因为两者的空间与防护策略不同（6 位数字 vs
-- 64 位 hex），合表会导致 TTL / 失败上限互相污染。
create table if not exists public.verifications (
  vid         text primary key,
  uid         text   not null references public.accounts(uid) on delete cascade,
  email_hash  text   not null,
  token_hash  text   not null,
  salt        text   not null,
  issued_at   bigint not null,
  expires_at  bigint not null,
  attempts    int    not null default 0,
  consumed_at bigint
);
create index if not exists verifications_uid_idx on public.verifications (uid);
create index if not exists verifications_expires_idx on public.verifications (expires_at);

create table if not exists public.resets (
  rid         text primary key,
  uid         text   not null references public.accounts(uid) on delete cascade,
  email       text   not null default '',
  token_hash  text   not null,
  salt        text   not null,
  issued_at   bigint not null,
  expires_at  bigint not null,
  attempts    int    not null default 0,
  consumed_at bigint
);
create index if not exists resets_uid_idx on public.resets (uid);
create index if not exists resets_expires_idx on public.resets (expires_at);

alter table public.verifications enable row level security;
alter table public.resets        enable row level security;

create or replace function public.kb_purge_expired(now_ms bigint)
returns void
language sql
security definer
as $$
  delete from public.codes         where expires_at < now_ms;
  delete from public.verifications where expires_at < now_ms;
  delete from public.resets        where expires_at < now_ms;
$$;

-- ==========================================================================
-- 7. 用户报告 / 勘误
-- ==========================================================================
-- 独立表而非 progress 里的一行：报告是写给管理员看的台账，不分区、不参与
-- 同步、需要按状态检索与回写。quote/context 存下上下文原句，避免半年后
-- 只剩两个字看不出说的是哪一句。状态机只在服务端流转（new → accepted →
-- fixed / rejected），用户端只读。
--
-- uid 与邮箱快照两样都留：uid 防刷与回信，邮箱快照用于账号注销后仍可
-- 追溯是谁提交的。
-- ==========================================================================

create table if not exists public.reports (
  rid          text primary key,
  uid          text   not null references public.accounts(uid) on delete cascade,
  email        text   not null default '',
  nickname     text   not null default '',
  kind         text   not null default 'other',
  status       text   not null default 'new',
  poem_id      text   not null default '',
  poem_title   text   not null default '',
  book         text   not null default '',
  quote        text   not null default '',
  context      text   not null default '',
  note         text   not null default '',
  suggestion   text   not null default '',
  device       text   not null default '',
  ua           text   not null default '',
  created_at   bigint not null,
  updated_at   bigint not null,
  handled_at   bigint,
  handled_by   text   not null default '',
  reply        text   not null default ''
);

create index if not exists reports_status_created_idx on public.reports (status, created_at);
create index if not exists reports_created_idx on public.reports (created_at);
create index if not exists reports_poem_idx on public.reports (poem_id) where poem_id <> '';
create index if not exists reports_uid_idx on public.reports (uid);

alter table public.reports enable row level security;

-- 不参与过期清理：报告是人工处理的台账，且体积很小（截断上界见
-- core.reportCreate），留着才能回溯历史反馈。

-- ==========================================================================
-- 8. 去掉掩码邮箱
-- ==========================================================================
-- 邮箱明文已落库后，掩码（b***@163.com）只剩“把自己看得见的邮箱对自己掩起来”
-- 这一个用处，属多余的一次点击。整块撤掉：
--   ① accounts.email_mask 删列。
--   ② reports.email_mask 改名为 email，内容从掩码换成明文快照（不可回填，
--      已有的掩码行清空，新记录起落明文）。
--   ③ 报文里的 emailMask 字段一并撤掉，改回 email。
--
-- 本机体验版（poem_auth_v1 里的掩码记法）不受影响，是独立的本机专用字段。
-- --------------------------------------------------------------------------

alter table public.accounts drop column if exists email_mask;

-- 用 DO 块包裹：新库建表时该列已叫 email，重跑时裸写 rename 会报错。
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'reports' and column_name = 'email_mask') then
    alter table public.reports rename column email_mask to email;
  end if;
end $$;
update public.reports set email = '' where email like '%*%';

-- ==========================================================================
-- 9. 登录流程体检（锁定 / 外键 / 函数权限）
-- ==========================================================================

-- login_count 建表语句里有，但老库没有 alter 补上，导致老库登录报错。
alter table public.accounts add column if not exists login_count int not null default 0;

-- 锁定改为“锁到几点”：locked_until 缺列会导致锁定无法解除、或误将未验证
-- 邮箱的账号解锁成 active。现在 status 只表示 pending / active，锁定只看
-- locked_until。
alter table public.accounts add column if not exists locked_until bigint;
update public.accounts
   set status = case when email_verified_at is not null then 'active' else 'pending' end
 where status = 'locked';

-- 报告不随账号删除：uid 外键改为 on delete set null，账号注销后仍可凭
-- 邮箱快照追溯。
alter table public.reports alter column uid drop not null;
alter table public.reports drop constraint if exists reports_uid_fkey;
alter table public.reports
  add constraint reports_uid_fkey foreign key (uid)
  references public.accounts(uid) on delete set null;

create or replace function public.kb_purge_expired(now_ms bigint)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.codes         where expires_at < now_ms;
  delete from public.verifications where expires_at < now_ms;
  delete from public.resets        where expires_at < now_ms;
  delete from public.sessions      where exp < now_ms;
$$;

-- security definer 函数默认对 PUBLIC 可执行，会让 anon key 绕过 RLS 写入
-- 任意账号的进度，只留给 service_role。
alter function public.kb_upsert_progress(jsonb) set search_path = public;
revoke all on function public.kb_upsert_progress(jsonb) from public, anon, authenticated;
revoke all on function public.kb_purge_expired(bigint) from public, anon, authenticated;
grant execute on function public.kb_upsert_progress(jsonb) to service_role;
grant execute on function public.kb_purge_expired(bigint) to service_role;

-- ==========================================================================
-- 10. 注音勘误 · 全站生效
-- ==========================================================================
-- 个人勘误（pinyin_fix:v1，存在 progress 里）只对做勘误的账号生效。要让
-- 全站生效且不依赖发版，改用服务端表 + 提交 → 审核 → 批准两步闸。
--
-- 一行 = 一处勘误的一个版本。同一处（wid+line+at）批准前，旧的 approved
-- 行仍保留，新的 pending 行并存，避免审核期间出现空窗；批准时把旧行标为
-- superseded（不删，留痕迹），任一时刻每处最多一条 approved。
--
-- 谁都能提交，只有 owner / admin 能批准（adminGate + isAdminRole，与用户
-- 报告同一条闸）。GET /api/pinyin-fixes 公开只读，只吐 status='approved'
-- 的四个字段，审核相关字段一律不对外。
-- ==========================================================================

create table if not exists public.pinyin_proposals (
  fid           text primary key,
  wid           text   not null,
  line          text   not null,
  at            int    not null default 0,
  ch            text   not null default '',
  py            text   not null,
  prev_py       text   not null default '',
  poem_title    text   not null default '',
  book          text   not null default '',
  status        text   not null default 'pending',
  proposed_by      text not null default '',
  proposed_by_name text not null default '',
  note             text not null default '',
  created_at    bigint not null,
  updated_at    bigint not null,
  reviewed_by   text   not null default '',
  reviewed_at   bigint
);

create index if not exists pinyin_proposals_key_idx on public.pinyin_proposals (wid, line, at, status);
create index if not exists pinyin_proposals_status_idx on public.pinyin_proposals (status, updated_at);

alter table public.pinyin_proposals enable row level security;

-- ==========================================================================
-- 11. 意见反馈
-- ==========================================================================
-- 与用户报告（第 7 节）不同：不针对某一篇，而是一段可来回跟帖的对话，
-- 拆成两张表——一条反馈本身（thread）与其下每一层跟帖（comment，含
-- 管理员回复）。
--
-- 未登录用户按 device_id 认（与限流用同一份设备号：js/auth-core.js 里
-- d_ 开头的 8 位十六进制，本机随机生成）。服务端要求必须是这个形状，
-- 不认占位值，否则所有存不住数据的访客会共用一个身份、彼此看到对方的
-- 内容。该设备号是客户端自证，伪造成本不高，属已知的残余风险。
--
-- 每个用户 / 每台设备只看得到自己的反馈；管理员看全站。删除权限不对称：
-- 普通用户只能删自己写的内容（含反馈正文），删不掉管理员的回复；管理员
-- 能删任何一条。
-- ==========================================================================

create table if not exists public.feedback_threads (
  tid          text primary key,
  uid          text references public.accounts(uid) on delete set null,
  device_id    text   not null default '',
  email        text   not null default '',
  nickname     text   not null default '',
  kind         text   not null default 'other',
  content      text   not null default '',
  status       text   not null default 'open',
  created_at   bigint not null,
  updated_at   bigint not null
);

create index if not exists feedback_threads_uid_idx on public.feedback_threads (uid) where uid is not null;
create index if not exists feedback_threads_device_idx on public.feedback_threads (device_id) where device_id <> '';
create index if not exists feedback_threads_status_idx on public.feedback_threads (status, updated_at);

alter table public.feedback_threads enable row level security;

create table if not exists public.feedback_comments (
  cid          text primary key,
  tid          text   not null references public.feedback_threads(tid) on delete cascade,
  uid          text references public.accounts(uid) on delete set null,
  device_id    text   not null default '',
  author_role  text   not null default 'user',
  nickname     text   not null default '',
  content      text   not null default '',
  created_at   bigint not null
);

create index if not exists feedback_comments_tid_idx on public.feedback_comments (tid, created_at);

alter table public.feedback_comments enable row level security;

-- ==========================================================================
-- 12. 考试历史（只记「考试」这一种形态，不含模拟考试 / 题库）
-- ==========================================================================
-- 只有登录用户能考「考试」（exam.formal，Max 门槛），交卷即写一条；用户能看
-- 自己的历史、能删自己的历史。这是个人记录，不是待复核的公共数据，不设
-- 审核 / 管理员这一层。
create table if not exists public.exam_records (
  eid           text primary key,
  uid           text   not null references public.accounts(uid) on delete cascade,
  scope_id      text   not null default '',
  scope_label   text   not null default '',
  size          int    not null default 0,
  score         int    not null default 0,
  total         int    not null default 0,
  duration_sec  int    not null default 0,
  items         jsonb  not null default '[]'::jsonb,
  created_at    bigint not null
);

create index if not exists exam_records_uid_idx on public.exam_records (uid, created_at desc);

alter table public.exam_records enable row level security;

