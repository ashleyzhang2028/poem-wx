# 服务端契约的只读副本

自检要拿一份**不会被本地改动牵连**的基准来比自己：能力表、路由表、报文清洗、
存储层的形状。这些是后端**契约**，不是本仓库要改的代码。

| 文件 | 取自 | 自检拿它比什么 |
|---|---|---|
| `js/entitlement.js` | 能力表 | `parity.js`：网页版每个能力键这边都要有交代 |
| `routes.js` | `api/_lib/routes.js` | 同步路径逐条在不在路由表里 |
| `core.js` + `identity/config/session/turnstile/http/mail/game` | `api/_lib/` | 报文过一遍 `sanitizePayload`、`SETTINGS_KEYS` 白名单 |
| `store-api.js` | `api/_lib/store.js` | `mysqlStore` 有没有实现 memory 档的每一个方法 |

**照原样摆着，不跟着本仓库的改动走。** 本仓库的后端实现在仓库根的 `api/`
（`deploy/store-mysql.js` 接上 MySQL）—— 那个是可以改的，这份不是基准之外的任何东西。
