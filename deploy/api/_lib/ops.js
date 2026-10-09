"use strict";

var ENTRY = [
  {
    key: "SESSION_SECRET",
    level: "required",
    group: "会话",
    secret: true,
    what: "会话 Cookie 的签名密钥（至少 16 个字符）",
    missing: "缺它时 /api/* 一律回 503 E_NOT_CONFIGURED —— 「未开放」是如实回答，不是坏掉",
    how: "生成一串随机字符（openssl rand -hex 32），填进托管平台的环境变量"
  },
  {
    key: "SESSION_KEY",
    level: "optional",
    group: "会话",
    secret: true,
    what: "会话签名密钥的**别名**（与 SESSION_SECRET 二选一，配置里优先读 SESSION_SECRET）",
    missing: "不影响：SESSION_SECRET 填了就够；两条都空才会回 503 E_NOT_CONFIGURED。这一条的用处是「发信有密钥、会话暂时不想占那个变量名」时仍能把会话签起来",
    how: "与 SESSION_SECRET 同一条命令生成（openssl rand -hex 32），**二选一**填进托管平台；两条都填时以 SESSION_SECRET 为准"
  },
  {
    key: "SUPABASE_URL",
    level: "required",
    group: "数据库",
    secret: false,
    what: "Supabase 项目的 URL（形如 https://xxxx.supabase.co）",
    missing: "缺它时自动降级为**内存存储**：本实例重启即丢账号与进度（进程内的假象）",
    how: "Supabase 建项目 → Project Settings → API → Project URL"
  },
  {
    key: "SUPABASE_SERVICE_KEY",
    level: "required",
    group: "数据库",
    secret: true,
    what: "Supabase 的 service_role key（**只在服务端**，绝不进浏览器）",
    missing: "同 SUPABASE_URL：降级为内存存储",
    how: "Supabase → Project Settings → API → service_role（不是 anon）"
  },
  {
    key: "OWNER_EMAILS",
    level: "optional",
    group: "管理员",
    secret: false,
    what: "管理员（owner）邮箱名单：**完整邮箱**，逗号或空格分隔（Issue #276）",
    missing: "不填时**一个 owner 都没有** —— `/admin/` 对所有人关门并如实说「本站还没有管理员」。这不是坏掉，是「还没指定主人」",
    how: "填你自己的完整邮箱（如 `belem@163.com`）。名单里的邮箱在注册 / 确认 / 登录时被认成 owner（写进 `accounts.role`）；之后改别人的角色在 `/admin/` 的账号名录里点，不必改环境变量 —— 环境变量只决定「谁是种子主人」"
  },
  {
    key: "SUPABASE_AVATAR_BUCKET",
    level: "optional",
    group: "头像存储",
    secret: false,
    what: "头像图片的 Storage bucket 名（缺省 `avatars`；必须是一个 **public** bucket）",
    missing: "不填时按 `avatars` 找桶；桶不存在时上传接口如实回 503「存储桶还没建好」，头像退回只存本机（功能不坏）",
    how: "Supabase → Storage → New bucket → 名字填 `avatars`、勾上 Public。**不用建表、不用改 RLS**：图片是公开读的，写只有服务端的 service key 做得到"
  },
  {
    key: "MAIL_TRANSPORT",
    level: "optional",
    group: "发信",
    secret: false,
    what: "发信通道：sendgrid | resend | console（缺省按「有哪个密钥用哪个」推）",
    missing: "不填也能跑：自动落到 console —— **真实用户收不到信**，只往服务端日志写一行",
    how: "只填了 RESEND_API_KEY 时不必填（推断就是 resend）；两个密钥都填时必须填 resend，否则缺省会挑 sendgrid；本地开发不必填"
  },
  {
    key: "RESEND_API_KEY",
    level: "needed",
    group: "发信",
    secret: true,
    what: "Resend 的 API key（当前主选通道）",
    missing: "发不出真邮件；登录验证码只能走 ALLOW_CODE_ECHO 冒烟模式手动取",
    how: "Resend → API Keys → 建一枚 key；再在 Domains 里验发信子域（SPF/DKIM/DMARC）"
  },
  {
    key: "SENDGRID_API_KEY",
    level: "optional",
    group: "发信",
    secret: true,
    what: "SendGrid 的 API key（曾经的备选；2026-09-16 起 SendGrid 已转向收费，**默认不再用它**）",
    missing: "不影响：Resend 能用就用 Resend。除非你另有 SendGrid 付费账号，否则这一项不用填",
    how: "SendGrid → Settings → API Keys → 建一枚 Mail Send 权限的 key（**只有你已经付费时才填**）"
  },
  {
    key: "MAIL_FROM",
    level: "optional",
    group: "发信",
    secret: false,
    what: "发信人地址（默认 noreply@mail.kuibu.app）",
    missing: "用默认值；但**域名没做 SPF/DKIM/DMARC 时会被判垃圾邮件**",
    how: "在发信商后台验证域名 → 按提示加 SPF / DKIM / DMARC 三条 DNS 记录"
  },
  {
    key: "MAIL_FROM_NAME",
    level: "optional",
    group: "发信",
    secret: false,
    what: "发信人显示名（默认「跬步」）",
    missing: "用默认值",
    how: "照实填"
  },
  {
    key: "SITE_URL",
    level: "optional",
    group: "站点",
    secret: false,
    what: "站点对外地址（默认 https://kuibu.app），写进邮件正文",
    missing: "用默认值",
    how: "填你自己的域名"
  },

  {
    key: "PASSWORD_MIN",
    level: "optional",
    group: "登录",
    secret: false,
    what: "密码最短长度（默认 8，按**码点**数）",
    missing: "用默认值 8",
    how: "一般不必改。调短会削弱账号安全，调长会把用户挡在注册门外"
  },
  {
    key: "PASSWORD_MAX",
    level: "optional",
    group: "登录",
    secret: false,
    what: "密码最长长度（默认 72）",
    missing: "用默认值 72",
    how: "**不要往上调** —— 这不是「防用户填太长」，是防 DoS（超长输入 scrypt 一样要算）"
  },
  {
    key: "VERIFY_TTL_MS",
    level: "optional",
    group: "登录",
    secret: false,
    what: "邮箱确认链接的有效期（毫秒，默认 24 小时）",
    missing: "用默认值 24 小时",
    how: "一般不必改"
  },
  {
    key: "RESET_TTL_MS",
    level: "optional",
    group: "登录",
    secret: false,
    what: "重设密码链接的有效期（毫秒，默认 1 小时）",
    missing: "用默认值 1 小时",
    how: "重设链接比确认链接短得多 —— 它能直接改掉账号凭据，时效要更紧"
  },
  {
    key: "REQUIRE_EMAIL_VERIFIED",
    level: "optional",
    group: "登录",
    secret: false,
    what: "邮箱没确认时**不许登录**（默认 1 = 拦；写 0 才关掉）",
    missing: "用默认值 1（拦）。用户 2026-09-16 裁的就是这一条",
    how: "⚠️ 只在**发信真的通不了**的实例上才写 0 —— 那时确认邮件送不到真人的收件箱，" +
      "开着这道闸等于谁也别想注册。关掉时界面会如实标注（服务端把它自报在 /api/me 的 channel.requireVerified 里），" +
      "不会让人误以为「没确认就进不来」。配好发信商（RESEND_API_KEY）之后请把它删掉（回到默认拦）"
  },
  {
    key: "MAIL_RETRY_MAX",
    level: "optional",
    group: "发信",
    secret: false,
    what: "发信失败时**重试几次**（默认 2，不含第一次 → 最多共 3 次）",
    missing: "用默认值 2",
    how: "一般不必改。只重试「可能自愈」的错（网络抖动 / 429 / 5xx）；" +
      "4xx（密钥不对、收件人被拒、域名未验证）**不重试** —— 重试它们只会烧光额度、埋掉错因"
  },
  {
    key: "MAIL_RETRY_BUDGET_MS",
    level: "optional",
    group: "发信",
    secret: false,
    what: "这一次请求内重试的**总预算**（毫秒，默认 6000）",
    missing: "用默认值 6 秒",
    how: "压在 Serverless 函数超时（Vercel 默认 10s）之前收手，" +
      "免得「为了重试把整个注册请求拖成 504」。⚠️ 它**不是**后台补发队列 —— " +
      "Serverless 里没有常驻进程，「过五分钟再试」需要一个真队列（Redis / 云任务），那是另一件事"
  },
  {
    key: "MAIL_RETRY_BASE_MS",
    level: "optional",
    group: "发信",
    secret: false,
    what: "重试退避的**基数**（毫秒，默认 400；实际等待是 400 × 3ⁿ 再加抖动）",
    missing: "用默认值 400",
    how: "线上不必改。它是留给测试的旋钮：重试的**判据**（该不该重试 / 最多几次 / " +
      "预算怎么算）与「等多久」是两件事，后者在测试里压到 1ms 就能把十几秒的白等还回来，判据一条不动"
  },
  {
    key: "COOKIE_NAME",
    level: "optional",
    group: "会话",
    secret: false,
    what: "会话 Cookie 的名字（默认 kbsid）",
    missing: "用默认值",
    how: "同域部署多站点时才需要改"
  },
  {
    key: "SMS_ENABLED",
    level: "optional",
    group: "短信",
    secret: false,
    what: "是否允许尝试短信通道（SMS_ENABLED=1 才是「允许」）",
    missing: "默认 0 / 关闭。**开了也不等于能发** —— 还要 SMS_TRANSPORT 指向已实现的商",
    how: "签了短信商 + 模板报备通过之后再开（3~7 工作日，日历时间）"
  },
  {
    key: "SMS_TRANSPORT",
    level: "optional",
    group: "短信",
    secret: false,
    what: "短信商的名字（指向 api/_lib/mail/index.js 里已实现的 transports.<名>）",
    missing: "没有实现可指：只开开关不接商，请求**仍然是 503 E_SMS_NOT_OPEN**（2B 的核心口径）",
    how: "先签商 + 模板报备，再实现 transports.<商名>；在此之前这一项**不填**"
  },

  {
    key: "TURNSTILE_ENABLED",
    level: "optional",
    group: "人机校验",
    secret: false,
    what: "是否开启人机校验（Cloudflare Turnstile）。默认 0 / 关",
    missing: "默认关。**没配好密钥时开着它 = 谁也别想登录**（与 SMS_ENABLED 同一条理由）",
    how: "在 Cloudflare 后台建好 widget、拿到两个 key 之后，设成 1；本地开发 / CI 用 TURNSTILE_BYPASS=1 绕开（**那条只在服务端读**，绝不能上生产）"
  },
  {
    key: "TURNSTILE_SITE_KEY",
    level: "optional",
    group: "人机校验",
    secret: false,
    what: "Turnstile 的 **Site Key**（公开值，由 /api/config 下发给浏览器渲染 widget）",
    missing: "缺它时前端**一个字节都不发给 Cloudflare**（不渲染 widget、连脚本都不加载），如实自报「本站没开人机校验」",
    how: "Cloudflare 控制台 → Turnstile → Add site → 填本站域名 → 复制 **Site Key**（⚠️ 它是公开的，进浏览器是它的设计；别与 Secret Key 弄混）"
  },
  {
    key: "TURNSTILE_SECRET_KEY",
    level: "optional",
    group: "人机校验",
    secret: true,
    what: "Turnstile 的 **Secret Key**（**只在服务端**，核 token 时用）",
    missing: "缺它时服务端不校验（`turnstileReady()` 为 false）—— 与没开开关是同一档",
    how: "与 Site Key 同一页 → 复制 **Secret Key** → 填进托管平台的环境变量（⚠️ 绝不进仓库、不进浏览器）"
  },
  {
    key: "TURNSTILE_BYPASS",
    level: "optional",
    group: "人机校验",
    secret: false,
    what: "**绕过**人机校验（只给本地开发 / 测试 / CI）",
    missing: "默认 0 / 不绕过",
    how: "只在本地与 CI 设 1。⚠️ **生产绝不许开** —— 它等于把人机校验整个关掉，而且**不经过 TURNSTILE_ENABLED**（后者至少还在配置清单里看得见）。它刻意**不随任何响应下发**，生产环境无从察觉它开着"
  },
  {
    key: "ALLOW_CODE_ECHO",
    level: "optional",
    group: "冒烟",
    secret: false,
    what: "把明文验证码随响应回给调用方（**只给冒烟自测用**）",
    missing: "默认关闭。生产**绝不许开** —— 开了等于把验证码送给任何调接口的人",
    how: "本地联调临时开；上线前确认它是 0"
  },
  {
    key: "REQUIRE_EMAIL_VERIFIED",
    level: "optional",
    group: "注册与口令",
    secret: false,
    what: "邮箱没确认就不让登录（**默认开**；用户 2026-09-16 在 Issue #197 裁决）",
    missing: "默认 1 / 开着 —— 这正是要的口径。设成 0 才关掉这道闸",
    how: "只在「发信商还没配好、确认邮件送不到真实收件箱」的实例上显式设 0。"
      + "关口诀：**必须同时**把 MAIL_TRANSPORT 配成能真发的通道，否则这道闸 "
      + "开着就是「谁也别想用」—— 而且界面会如实显示「这台服务器现在没能把确认邮件发出去」；"
      + "关掉时界面也会如实说「这台服务器没有拦确认」，不会假装拦着"
  }
];

var TIER_TEXT = {
  required: "必须",
  needed: "这一件需要",
  optional: "可选"
};

function isSet(v) {
  return !(v === undefined || v === null || String(v).trim() === "");
}

function valueOf(cfg, key) {
  if (!cfg) return undefined;
  return cfg[key];
}

function check(cfg) {
  var items = ENTRY.map(function (e) {
    var set = isSet(valueOf(cfg, e.key));
    return {
      key: e.key, level: e.level, group: e.group, secret: !!e.secret,
      set: set, what: e.what, missing: e.missing, how: e.how
    };
  });

  var missing = items.filter(function (i) { return !i.set; });
  var blocking = missing.filter(function (i) { return i.level === "required"; });

  var hasSession = typeof cfg.hasSession === "function" ? !!cfg.hasSession() : isSet(cfg.sessionSecret);
  var hasDb = typeof cfg.hasDb === "function" ? !!cfg.hasDb() : (isSet(cfg.supabaseUrl) && isSet(cfg.supabaseServiceKey));
  var mail = typeof cfg.mail === "function" ? cfg.mail() : "console";
  var smsEnabled = cfg.smsEnabled === true;
  var smsTransport = isSet(cfg.smsTransport) ? cfg.smsTransport : null;

  var turnstile = typeof cfg.turnstileReady === "function" ? !!cfg.turnstileReady() : false;

  var notes = [];
  if (!hasSession) notes.push("缺 SESSION_SECRET：所有 /api/* 会回 503 —— 本站仍可完全离线使用（这是设计好的降级，不是坏掉）");
  if (hasSession && !hasDb) notes.push("会话可签但没配库：账号与进度只活在**当前实例的内存**里，重启即丢");
  if (mail === "console") notes.push("当前发信通道是 console：真实用户**收不到**验证码邮件（本地开发与 CI 正是靠它跑完整链路）");

  if (!cfg.mailTransport && isSet(cfg.sendgridKey) && isSet(cfg.resendKey)) {
    notes.push("SENDGRID_API_KEY 与 RESEND_API_KEY **都填了**，又没设 MAIL_TRANSPORT：" +
      "缺省选中的是 sendgrid（推断顺序里它在前面）—— 你以为在用 Resend，实际走的是 SendGrid。" +
      "想用 Resend 就显式写 MAIL_TRANSPORT=resend，或把 SENDGRID_API_KEY 去掉");
  }
  if (smsEnabled && !smsTransport) notes.push("SMS_ENABLED=1 但没接短信商：请求仍是 503 E_SMS_NOT_OPEN（这是 2B 定死的口径，不是 bug）");

  if (isSet(cfg.turnstileBypass) && cfg.turnstileBypass === true) {
    notes.push("⚠️ TURNSTILE_BYPASS=1：**人机校验被整个绕开了**，而且这件事不随任何响应下发 —— 生产环境绝不许开它");
  } else if (cfg.turnstileEnabled === true && !isSet(cfg.turnstileSecretKey)) {
    notes.push("TURNSTILE_ENABLED=1 但没填 TURNSTILE_SECRET_KEY：**看着像开着，实际一处都不校验** —— " +
      "判据是 `turnstileReady()`（开关 + 密钥**两者都要**），请补上密钥或把开关改回 0");
  } else if (turnstile && !isSet(cfg.turnstileSiteKey)) {
    notes.push("人机校验在服务端开着，但没填 TURNSTILE_SITE_KEY：**前端不会渲染 widget**（一个字节都不发给 Cloudflare），" +
      "于是**每一次登录/注册都会被服务端拒**（E_TURNSTILE）。这两个 key 是一对，缺一个都跑不起来");
  }
  if (smsTransport) notes.push("SMS_TRANSPORT 指向了 " + smsTransport + "：请确认 api/_lib/mail/index.js 里真的实现了它，否则投递会以 E_SMS_FAIL 失败");

  return {
    ok: hasSession && hasDb,
    hasSession: hasSession,
    hasDb: hasDb,
    mail: mail,
    smsReady: !!(smsEnabled && smsTransport),

    turnstile: turnstile,
    items: items,
    missing: missing,
    blocking: blocking,
    notes: notes
  };
}

function report(cfg) {
  var r = check(cfg);
  var lines = [];
  lines.push(r.ok ? "✅ 最低线已过：会话可签 + 数据库已配（能真跑）"
    : "⚠️ 还没到「能真跑」的最低线（缺 " + r.blocking.map(function (i) { return i.key; }).join("、") + "）");
  lines.push("");
  lines.push("发信通道：" + r.mail + (r.mail === "console" ? "（用户收不到信，只写服务端日志）" : ""));
  lines.push("短信通道：" + (r.smsReady ? "已接商 " + cfg.smsTransport : "未开通（如实回 503，不假装发短信）"));
  lines.push("人机校验：" + (r.turnstile ? "已开启（Cloudflare Turnstile）" : "未开启（前端不渲染 widget，服务端也不校验）"));
  lines.push("");
  lines.push("-- 已设置的项 --");
  r.items.filter(function (i) { return i.set; }).forEach(function (i) {
    lines.push("  [" + (i.secret ? "已设置" : "有值") + "] " + i.key + "（" + i.group + "）" + i.what);
  });
  var un = r.items.filter(function (i) { return !i.set; });
  lines.push("");
  lines.push("-- 未设置的项 --");
  if (!un.length) lines.push("  （无）");
  un.forEach(function (i) {
    lines.push("  [" + TIER_TEXT[i.level] + "] " + i.key + "（" + i.group + "）：" + i.missing);
    lines.push("        怎么补：" + i.how);
  });
  if (r.notes.length) {
    lines.push("");
    lines.push("-- 口径提醒 --");
    r.notes.forEach(function (n) { lines.push("  · " + n); });
  }
  return lines.join("\n");
}

var VERIFY_DB = 'curl -sS -o /dev/null -w \'%{http_code}\\n\' "$SUPABASE_URL/rest/v1/accounts?select=uid&limit=1" -H "apikey: $SUPABASE_SERVICE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_KEY"';

var STEPS = [
  {
    id: "A",
    title: "生成会话密钥",
    level: "required",
    where: "托管平台的环境变量（一个 SESSION_SECRET）",
    why: "会话 Cookie 靠它签名。缺它时 /api/* 一律回 503 —— 「未开放」是如实回答，不是坏掉",
    how: [
      "本机执行：openssl rand -hex 32",
      "把输出**整串**填进托管平台的环境变量 SESSION_SECRET",
      "至少 16 个字符才算设上了（`config.hasSession()` 判的就是这一条）"
    ],
    check: "自检里 SESSION_SECRET 从「未设置」变「已设置」，并且 hasSession 为 true"
  },
  {
    id: "B",
    title: "建 Supabase 项目并跑到能连",
    level: "required",
    where: "Supabase 控制台 + 托管平台的环境变量（两个值）",
    why: "不配库时自动降级为**内存存储**：本实例重启即丢账号与进度（进程内的假象）",
    how: [
      "supabase.com 建项目（免费档即可；免费项目连续 7 天没有请求会被暂停 —— 见第 D 步）",
      "控制台左侧 SQL Editor：整段粘贴 api/_lib/schema.sql 并执行（四张表 + 条件 upsert 函数 + 四表 RLS 全开）",
      "Project Settings → API：复制 Project URL → 填 SUPABASE_URL",
      "**同一页**复制 service_role key → 填 SUPABASE_SERVICE_KEY（⚠️ 不是 anon key）"
    ],
    check: "自检里「最低线已过」（hasSession 且 hasDb），并且这段命令回 200：" + VERIFY_DB
  },
  {
    id: "C",
    title: "注册发信商并把域名验到能真发信",
    level: "needed",
    where: "发信商后台 + 域名 DNS + 托管平台的环境变量（一个密钥）",
    why: "不配时落到 console 通道：**真实用户收不到信**，只往服务端日志写一行（本地开发与 CI 正是靠它跑完整链路）",
    how: [
      "注册 **Resend**（当前主选：免费档 100 封/天、3000 封/月）。⚠️ **SendGrid 已转向收费**（2026-09-16 起限时免费额度收窄），所以本站默认不再以它为主 —— 除非你本来就有它的付费账号",
      "Resend → API Keys → 建一枚 key → 填 RESEND_API_KEY",
      "（可选）另有 SendGrid 付费账号时：Settings → API Keys → 建一枚 **Mail Send** 权限的 key → 填 SENDGRID_API_KEY。两个都填也不必指定谁主谁备：下面那条 MAIL_TRANSPORT 说了算",
      "⚠️ 两个密钥都填、又**没有**设 MAIL_TRANSPORT 时，缺省按「有哪个密钥用哪个」推，而推断的顺序里 SendGrid 在前 —— 想真的用 Resend，就显式写 MAIL_TRANSPORT=resend",
      "在发信商后台验证**发信子域**（如 mail.kuibu.app）→ 按提示加 SPF / DKIM / DMARC 三条 DNS 记录",
      "MAIL_FROM 填验证过的子域里的地址（默认 noreply@mail.kuibu.app）"
    ],
    verify: [
      "POST /api/send-code 看看 delivered 是不是 true（false 就是还在 console 通道）",
      "往自己的 QQ / 163 邮箱发一封：**缺 SPF/DKIM/DMARC 会被直接判成垃圾邮件或拒收**，只验证域名不够",
      "收不到时先看垃圾箱，再看发信商后台的投递日志（那一页会说 ISP 为什么拒）"
    ],
    check: "自检里「发信通道」从 console 变成你配的那一家；发一封真信，delivered 为 true"
  },
  {
    id: "F",
    title: "接上人机校验（Cloudflare Turnstile）",
    level: "optional",
    where: "Cloudflare 控制台 + 托管平台的环境变量（两个 key + 一个开关）",
    why: "登录 / 注册 / 密码找回 / 发送随机码这几条**匿名可写、会发信、会建号**的口子，"
      + "光靠频控只能压住「刷多快」，压不住「脚本批量打」。人机校验把「你是不是真人」"
      + "这件事挡在这些口子的前面。**默认关** —— 没配好两个 key 就打开它 = 谁也别想登录",
    how: [
      "① Cloudflare 控制台 → **Turnstile** → Add site → 填本站域名（`kuibu.app` 那种，不带 https）→ Create",
      "② 建完那一页给你**两个 key**，它们是一对，缺一个都跑不起来：**Site Key**（公开，进浏览器渲染 widget）与 **Secret Key**（保密，只在服务端核 token）",
      "③ 托管平台 → 项目 → Settings → Environment Variables → 建**三个**：`TURNSTILE_ENABLED=1`、`TURNSTILE_SITE_KEY=<Site Key>`、`TURNSTILE_SECRET_KEY=<Secret Key>`",
      "④ **重新部署一次** —— Vercel 的环境变量**只在新部署里生效**，光改不重新部署 = 没改（这是「我明明配了」里最常见的一种）",
      "⑤ 回来验：终端 `curl -sS \"$SITE_URL/api/config\"` 应当回 `{\"turnstile\":{\"enabled\":true,\"siteKey\":\"0x…\"}}`；打开 `/login/` 应当看见那个方框",
      "⚠️ 本地开发 / CI 不想真接 Cloudflare，就给 `TURNSTILE_BYPASS=1`（**只在服务端读**，生产绝不许开）"
    ],
    verify: [
      "GET /api/config 回 `turnstile.enabled:true` 且带 `siteKey`（没带 = 开关开了但缺 Site Key）",
      "打开 /login/，**「密码登录」那一屏**的登录键上方应当出现 Cloudflare 的方框（口令登录也挂，见 docs/auth-design.md §4.4.12）；不出现就看浏览器控制台（多半是 Site Key 填错或域名没加进 widget 的允许列表）",
      "切屏时方框跟着走：切到「快捷登录 / 注册 / 忘记密码」，同一时刻页面上**只有一块**方框",
      "故意不勾就点「注册」：前端会就地提示「请先完成人机校验」，**不会**发出那次请求",
      "把 widget 删掉再点「注册」（模拟绕过前端）：服务端回 400 `E_TURNSTILE` —— **这才证明闸在服务端**",
      "服务端日志里搜 `api.turnstile_blocked`：它带着 Cloudflare 的 error-codes（如 invalid-input-secret），是排查「密钥配错了」的唯一材料"
    ],
    check: "GET /api/config 的 turnstile.enabled 为 true 且带 siteKey；不勾提交时服务端回 400 E_TURNSTILE；`npm run doctor` 里「人机校验」那一行从「未开启」变「已开启」"
  },
  {
    id: "D",
    title: "上探活与备份（可用性兜底，不是可靠性方案）",
    level: "optional",
    where: "本仓库的 .cnb.yml（两条 crontab 流水线）+ CNB 密钥仓库",
    why: "免费档连续 7 天没有请求就**整个项目停机**。用户看到的是「打不开」，不是「有点慢」—— 这是本方案里唯一会直接砸在用户身上的平台限制",
    how: [
      "把 SUPABASE_URL / SUPABASE_SERVICE_KEY 放进**密钥仓库**（禁止本地克隆，只由流水线引用）",
      "在 .cnb.yml 里加两条定时任务：supabase-keepalive 与 supabase-backup",
      "探活的请求**必须打到数据库**（PostgREST 查询算活动，根路径与状态页不算）",
      "探活排**每 5 天**而不是每 7 天：平台可能延迟数小时甚至跳过，留 2 天缓冲",
      "备份每周一次 pg_dump（免费档没有自动备份，误删就是永久消失）",
      "备份还要第三个值 SUPABASE_DB_URL —— 它**不能在控制台复制**，只能去 Project Settings → Database → Connection string 那一页取模板，再把里面的 [YOUR-PASSWORD] 换成数据库密码（那串明文密码只在建项目时出现过一次；忘了就点 Reset database password 重设）。模板形如 postgresql://postgres:[YOUR-PASSWORD]@db.<ref>.supabase.co:5432/postgres，把 [YOUR-PASSWORD] 整体替换掉再填进密钥仓库",
      "密码里有 @ : / # ? 这类字符时必须**百分号编码**（@ → %40，: → %3A，/ → %2F，# → %23，? → %3F），否则 pg_dump 会把密码里那一段当成主机名，报的是「could not translate host name」—— **看着像 DNS 坏了，其实只是密码没转义**",
      "填完先验 URL 形状：整串必须以 postgresql:// 或 postgres:// 开头；用户名 / 密码 / 主机三段里，**@ 只许出现一次**（就是分隔密码与主机的那一个）。多了就说明密码没编码 —— .cnb.yml 的备份脚本已把这两条做成开跑前的自检，命中会直接教你改哪里，而不是等你去看那句「could not translate host name」",
      "备份镜像的**大版本要跟服务端一致**：Supabase 现在是 PostgreSQL 17，所以镜像用 postgres:17（不是 postgres:16）。pg_dump **不改**连比自己新的服务端 —— 落后一个大版本时它会在读到数据之前就以「aborting because of server version mismatch」退出，而这句话看着像连接串配错了，其实只是客户端旧了。服务端升大版本时，.cnb.yml 里那一行要跟着升",
      "密码忘了：Project Settings → Database → Reset database password，重设后把新密码编码再填回密钥仓库（旧的立刻失效）",
      "跑通一次看回执：备份产出 backup/kuibu-<日期>.sql 并打印字节数（0 字节不算备份 —— 脚本会删掉失败留下的半截文件）",
      "⚠️ 镜像里的 pg_dump 大版本**必须 ≥ Supabase 服务端**（现在服务端是 17.6，所以 .cnb.yml 用的是 postgres:17）。低一个大版本时 pg_dump 会**直接 abort**，不是警告：`pg_dump: error: aborting because of server version mismatch` / `detail: server version: 17.6; pg_dump version: 16.15`。这时备份是零产出的（postgres:16 对 17 就是这么红过一次）。pg_dump 允许比服务端**高**，不允许低；服务端升到 18 就把 docker.image 换成 postgres:18",
      "见到 could not translate host name 时先看**引号里那串主机名**：带 [at] 或密码尾巴 = 密码没编码（改密钥仓库里的值）；干净的 db.<ref>.supabase.co = URL 已解析，是**这个名字解析不到**。后者按代价从低到高试：① 刚建的项目 DNS 可能还没发布完，过一会儿重跑；② 直连主机名 db.<ref>.supabase.co 在新项目上只有 IPv6（AAAA，IPv4 要另开 add-on），零成本的替代是同一页 Connection string 上的 **Session pooler**（…@aws-0-<region>.pooler.supabase.com:5432，用户名是 postgres.<ref> 而不是 postgres）",
      "⚠️ Transaction pooler 那个 **6543** 端口**不要**给 pg_dump 用 —— 它不支持 pg_dump 需要的会话级特性（给应用连接池用）",
      "兜底：只要探活是通的（SUPABASE_URL + SUPABASE_SERVICE_KEY 都在），导出可以不依赖 Postgres 直连，直接用 PostgREST 逐表拉 JSON；数据量小的时候够用"
    ],
    check: "仓库的流水线列表里能看见这两条；手动触发一次探活，成功即回执"
  },
  {
    id: "E",
    title: "配完当场验收（七步，每步一个明确结论）",
    level: "required",
    where: "本机终端（对着已部署的站点）",
    why: "「配完了」和「配对了」是两件事。这一段把前者变成后者 —— 只回答事实，不做「应该没问题」这类判断",
    how: [
      "① 库连通：期望回 200 —— " + VERIFY_DB,
      "② 会话可签：curl -sS \"$SITE_URL/api/me\" | head -c 200 —— 期望 401 E_NO_SESSION；**回 503 E_NOT_CONFIGURED 就是 SESSION_SECRET 没生效**",
      "③ 真发信：POST /api/send-code → delivered:true 且 transport 是你配的那一家（console 通道**永远**是 false，这是 2C 定的，2D 不改）",
      "④ 注销可达：curl -sS -o /dev/null -w '%{http_code}\\n' -X DELETE \"$SITE_URL/api/account\" —— 期望 401（不是 500）",

      "⑤ 部署形态：本条与「环境变量」无关，但它是同一类问题（配了才会好）。" +
      "线上 `api/` 下**只有 1 个** Serverless 函数入口（`api/handler.js`，" +
      "固定路径），19 条路由的实现都在 `api/_routes/`" +
      "（`_` 开头 = 平台不当函数），而整个 `/api/*` 靠 `vercel.json` 的" +
      " **一条 rewrite**（`/api/:path*` → `/api/handler?__path=:path*`）转进那个函数。" +
      "本机判据：`find api -name '*.js' -not -path 'api/_*' -not -path 'api/_*/*'`" +
      " 应只回一行 `api/handler.js`；" +
      "`cat vercel.json` 里那条 rewrite 的 destination 必须是" +
      " `/api/handler?__path=:path*`。见 docs/architecture.md §2.2.1",

      "⑥ **接口真的活着**：`curl -sS -o /dev/null -w '%{http_code}\\n' \"$SITE_URL/api/config\"`" +
      " 期望 **200**；`curl -sS \"$SITE_URL/api/me\"` 期望 401 E_NO_SESSION。" +
      "**回 404 且正文是 `The page could not be found`（带头 `x-vercel-error: NOT_FOUND`），" +
      "那是 Vercel 平台层报的 —— 函数压根没被调起来" +
      "（不是本站：本站的 404 形状是 `{\"code\":\"E_404\",\"message\":\"没有这个接口。\"}`）**。" +
      " 意思是 `/api/*` 没接到函数上，站点看着正常、整套账号体系是死的。" +
      " 本站那种 404 才是「路径不在路由表里」，要查 api/_lib/routes.js。" +
      " ⚠️ **2026-09-20 实测：不要依赖动态 catch-all 文件名承接这条 rewrite。**" +
      " `api/[...path].js` 在部署详情里看得见，但三个部署域名的 `/api/config`" +
      " 都是平台层 404；全站 `/api/*` 没有进入函数，" +
      " 连函数日志都没有；而静态页面照旧 200、本地测试全绿" +
      "（测试挂的是模块本身，平台那一层在测试里不存在）。" +
      " 现在用固定的 `api/handler.js`，由 rewrite 的 `__path` 参数传入原路径" +
      "（见 docs/architecture.md §2.2.1.1）。",

      "⑦ **一条命令看全部（Issue #225）**：`curl -sS \"$SITE_URL/api/diag\"` ——" +
      " 它逐环节回：会话密钥配没配、库是内存还是 Supabase、六张表逐张的 HTTP、" +
      " 列形状、以及**写入实跑一次**（插一行标 __diag__ 的 progress，读完即删）。" +
      " 结论互斥：`no_secret` / `db_not_configured` / `db_unreachable` / `db_bad_key` /" +
      " `db_no_table` / `db_no_column` / `db_write_fail` / `ok`。" +
      " ⚠️ 它**只回形状与 HTTP 状态，永不回密钥**（主机名脱敏、值一个字都不出现）。" +
      " 不想敲命令就走页面：设置 → 关于 → 自检（/self-check/），" +
      " 它把同样的结论摊成一页，并给一颗「复制报告」。" +
      " ⚠️ 页面与那条入口**只对已登录的管理员**（`accounts.role` 是 owner / admin）" +
      " 开放（Issue #276 后续）；未登录 / 普通用户看不到入口，直接敲地址也只会" +
      " 拿到一张「没有权限」的卡（一句话 + 一颗「返回」），自检脚本根本不会被加载。" +
      " 而**这一条命令仍对所有人可用** —— 它按设计只回形状不回值，" +
      " 正是留给「页面打不开的人」的那条出路。"
    ],
    check: "七条全对：① 200 ② 401 ③ delivered=true ④ 401 ⑤ 函数入口只有 1 个（handler.js，且 rewrite 带 __path） ⑥ /api/config 回 200（不是平台层的 404）⑦ /api/diag 的 verdict 回 ok。任何一条不对，回到它上面那一步"
  }
];

function stepsReport(cfg) {
  var lines = [];
  lines.push("跬步 · 配置与真开通（2D：Supabase + 发信商 + 会话密钥 + 探活 + 人机校验）");
  lines.push("=".repeat(60));
  lines.push("五步，按顺序做。每一步做完都有一条**本机就能跑的判据**，不必先部署。");
  lines.push("真值进托管平台的环境变量，**不进仓库**（.env 被 .gitignore 挡着）。");
  lines.push("");
  STEPS.forEach(function (st) {
    lines.push("── 第 " + st.id + " 步 · " + st.title + "  [" + TIER_TEXT[st.level] + "]");
    lines.push("   在哪配：" + st.where);
    lines.push("   为什么：" + st.why);
    lines.push("   怎么做：");
    st.how.forEach(function (h, i) { lines.push("     " + (i + 1) + ". " + h); });
    if (st.verify) {
      lines.push("   怎么验：");
      st.verify.forEach(function (h) { lines.push("     · " + h); });
    }
    lines.push("   判据：" + st.check);
    lines.push("");
  });
  lines.push("-- 现在到哪一步了（据当前环境变量如实报，不报值）--");
  var r = check(cfg);
  lines.push("   第 A/B 步（最低线）：" + (r.ok ? "已过" : "未过（缺 " + r.blocking.map(function (i) { return i.key; }).join("、") + "）"));
  lines.push("   第 C 步（真发信）：" + (r.mail === "console" ? "未过（发信通道是 console）" : "已过（" + r.mail + "）"));
  lines.push("   第 F 步（人机校验）：" + (r.turnstile ? "已过（Cloudflare Turnstile）" : "未过（默认关；要开就照着第 F 步走）"));
  lines.push("   第 D 步（探活与备份）：不在环境变量里，看仓库 .cnb.yml 的两条 crontab");
  lines.push("   第 E 步（验收）：上面七条命令，对着**线上**跑");
  lines.push("");
  lines.push("短信不在五步里：要先签商 + 模板报备（3~7 工作日，**日历时间不是人日**），");
  lines.push("再实现 transports.<商名>，最后才开 SMS_ENABLED=1。开了但不接商，仍是 503 E_SMS_NOT_OPEN。");
  return lines.join("\n");
}

function envExample() {
  var out = [
    "# 跬步 · 服务端环境变量（由 `node scripts/env-example.js` 生成，**不要手改**）",
    "#",
    "# 全部可选：一个都不配，本站照样能完全离线使用（打开即背）。",
    "# 配齐「必须」两项之后，账号与进度才会真的落到服务端。",
    "#",
    "# 用法：把这份内容复制到托管平台的环境变量里（Vercel / 其它 Node 托管均可）。",
    "#      **不要提交填了真值的 .env**（.gitignore 已经挡着）。",
    "#"
  ];
  ["必须", "这一件需要", "可选"].forEach(function (label) {
    var level = label === "必须" ? "required" : (label === "这一件需要" ? "needed" : "optional");
    out.push("# ---------------------------------------------------------------------------");
    out.push("# " + label);
    out.push("# ---------------------------------------------------------------------------");
    ENTRY.filter(function (e) { return e.level === level; }).forEach(function (e) {
      out.push("# " + e.what);
      out.push("#   缺它：" + e.missing);
      out.push("#   怎么补：" + e.how);
      out.push(e.key + "=");
      out.push("");
    });
  });
  return out.join("\n");
}

module.exports = {
  ENTRY: ENTRY,
  STEPS: STEPS,
  check: check,
  report: report,
  stepsReport: stepsReport,
  envExample: envExample
};
