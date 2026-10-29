# 增量 A：当前 HTTP 接口

当前实现为测试阶段，未完成前端和真实邮件验收。所有业务响应禁止缓存。

机器可读契约以 `backend/internal/contract/openapi.yaml` 为准，此文件仅作补充。Swagger UI 在 http://localhost:3000/docs/，JSON 在 /openapi.json。本地资源不依赖外部 CDN。

所有 API 响应提供 X-Request-ID；错误体包含 error 和 request_id。日志只记录路由模板、方法、状态码、耗时及错误代码，不记录原始 URL、请求正文或认证头。请求执行严格 JSON 与契约校验，拒绝未知字段、错误类型、尾随 JSON 和超限输入。

## 同源与会话

- 写接口要求 `Origin` 精确匹配 `APP_ORIGIN`，以及 JSON Content-Type。
- 会话 Cookie：`tako_session`，HttpOnly、SameSite=Lax，生产必须 Secure 和 HTTPS。
- 不信任客户端提供的账号 ID。草稿归属来自会话。
- 默认不信任转发 IP；部署反向代理时应只配置信任实际代理，不能直接相信任意 X-Forwarded-For。

| 方法 | 路径 | 请求／用途 |
|---|---|---|
| POST | /api/auth/code | `{email,delivery_id}`，202 返回持久化任务状态；未配置 SMTP 拒绝新任务 |
| POST | /api/auth/verify | `{email,code}`，登录或注册并设置 Cookie |
| POST | /api/auth/logout | `{}`，撤销当前会话，不删除浏览器草稿 |
| GET | /api/me | 当前账号 ID、笔名 |
| PATCH | /api/me | `{nickname}`，笔名允许重名 |
| POST | /api/drafts/create | `{mutation_id,title,content}` |
| POST | /api/drafts/save | `{mutation_id,draft_id,base_revision,title,content}` |
| POST | /api/drafts/recover | 同 save，另存并关联来源草稿 |
| GET | /api/drafts/:id | 读取自己的正文及修订号 |
| GET | /api/drafts | limit 1–100（默认 20）与 cursor，稳定分页，仅返回自己的元数据 |

首次写草稿前需要设置非空笔名。mutation_id 为 UUID；同一请求重试沿用 ID，载荷改变必须使用新 ID。写入结果包含 draft_id 与 revision。

0.3.0 补充 saved_at：读取和保存确认使用数据库记录的 UTC 时间，幂等重放返回原确认时间。列表按创建时间与 ID 倒序，修改不改变位置。历史保留和迁移边界见 [草稿存储说明](draft-storage.md)。

错误：400 invalid_input；401 authentication_required；403 origin_rejected；404 draft_not_found；409 revision_conflict / mutation_id_reused / nickname_required；429 rate_limited；503 mail_unavailable / service_unavailable。

## 当前限制

- 草稿列表已实现；编辑页面和本机恢复仍未完成，不能宣称完整增量 A 已完成。
- 验证码已采用加密持久化任务与独立 worker，超时重试沿用 delivery_id，任务终态不自动重发；具体语义见 [持久化邮件说明](mail-delivery.md)。真实 SMTP 仍未验收。
- 限流：发送全局每小时 100、同 IP 每小时 10、同邮箱每分钟 1；验证同 IP 每分钟 30，单码最多 5 次错误。当前为测试默认值，真实反向代理下 IP 策略尚需验证。
- 验证码十分钟、会话七天为建议默认值的实现，后续可配置化。
- 邮件 worker 已提供有界清理，任务幂等记录至少保留 24 小时；草稿快照已实现 30 天分层保留，草稿保存请求去重记录清理策略仍待收口。
- 应用日志尚需补请求标识和脱敏错误分类；不能记录正文、验证码、Cookie、SMTP 密码。

## SMTP 本机配置

修改被 Git 忽略的 `.env`，设置 `SMTP_HOST`、`SMTP_PORT`、`SMTP_USERNAME`、`SMTP_PASSWORD`、`SMTP_FROM` 和 `SMTP_TLS_MODE`。支持强制 STARTTLS 或 implicit TLS，不支持明文 SMTP。不要把密码粘贴到源码、文档或提交中。

`AUTH_PEPPER` 是稳定随机密钥，不随进程启动重新生成；切换会使未消费验证码失效。生产不得使用测试密钥。SMTP 与账号配置后重建／重启 API，再进行真实送达验收。
