# Tako 当前 HTTP 接口

当前为私有测试阶段，A 核心链路及本机 B1/B2 已验收，B3 仍待交付。所有业务响应禁止缓存。

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

## 当前阶段

A 核心链路已完成真实邮箱、设备及恢复验收；真机粘贴与网络切换补测仍搁置。登录与草稿的运行证据见阶段复盘，不再沿用“前端尚未完成”的历史状态。

B1 发布链路已交付；当前正式契约 0.5.0：新增固定预览、原子发布和稳定匿名读取。由 PUBLICATION_ENABLED 控制，默认关闭；本机已开启，ECS 未更新。B2 版本与隐藏入口已交付；运营审核/处置/复核界面仍待 B3，不能开放公众创作。

| 方法 | 路径 | 用途 |
|---|---|---|
| POST | /api/publication-previews | 固定本人 source_revision 和元数据，24 小时未提交预览 |
| GET | /api/publication-previews/{id} | 本人读取固定预览；未提交过期返回 410 |
| POST | /api/publications | 同事务写正式版本、后审待办、幂等确认 |
| GET | /api/works/{id} | 匿名读取当前允许展示的正式版 |
| GET | /api/works/{id}/versions/{number} | 同时检查隐藏、限制与历史权限 |

发布结果是原提交确认，不代表当前仍然公开。相同 mutation_id/载荷重试和同一预览多次确认不重复发布；同 key 不同载荷拒绝。过时的正式版本基线返回 publication_conflict，不能自动追加版本。观察期及 B1 尚未支持的状态返回 unsupported_publication_state，不绕过审核。任一正式写入失败均回滚。

预览正文独立于 A 历史清理；过期且未提交正文按有界批次清理，保留小型幂等记录避免旧 ID 复活。每账号每小时最多创建 30 份新预览，幂等重试不扣额度。简介上限 300 字符，六个初始标签中选 1～3 个，正文不足 300 字只提示。

404 resource_not_found 对不存在/越权/隐藏/受限读取统一，不包含私密标题正文；410 preview_expired 要求重新准备。503 publication_disabled 表示功能开关关闭。所有页面、API、SSR 维持 no-store，公开页默认 noindex；搜索不收录不能替代访问控制。

邮件发送状态、限流、worker 与真实收件边界见 [持久化邮件说明](mail-delivery.md)；当前使用 Resend，SMTP 兼容配置仍保留。日志有请求标识和脱敏分类，不记录正文或凭据。当前实际结果见 [B1 阶段复盘](reviews/2026-10-30-b1-review.md)。

## SMTP 本机配置

修改被 Git 忽略的 `.env`，设置 `SMTP_HOST`、`SMTP_PORT`、`SMTP_USERNAME`、`SMTP_PASSWORD`、`SMTP_FROM` 和 `SMTP_TLS_MODE`。支持强制 STARTTLS 或 implicit TLS，不支持明文 SMTP。不要把密码粘贴到源码、文档或提交中。

`AUTH_PEPPER` 是稳定随机密钥，不随进程启动重新生成；切换会使未消费验证码失效。生产不得使用测试密钥。SMTP 与账号配置后重建／重启 API，再进行真实送达验收。

## B2 作品管理与时间线

- GET /api/my/works：本人作品列表，创建时间/ID 稳定分页，cursor。
- GET /api/my/works/{id}：独立状态与 state_revision。
- GET /api/my/works/{id}/versions：本人正式版本/事件，两种 before 游标独立，每页 20。
- GET /api/my/works/{id}/versions/{number}：本人正文，受限版本也可本人查看导出。
- POST /api/my/works/{id}/actions：hide/restore/switch_display/set_history，mutation_id 和 expected_state_revision 必填；目标版本/历史开关按动作提供。
- GET /api/works/{id}/timeline：匿名安全版本/展示记录，无旧标题正文、处置版本或私有管理事件。

409 work_state_conflict 要求重新读取并确认，不能自动套用旧操作；version_unavailable 要求明确选择正常旧版；work_restricted 不能由作者解除。成功重试返回原确认，界面随后获取现状。正式发布也推进状态号，防止隐藏期间新发布后旧页面恢复错版本。管理与事件写入失败一并回滚。

预览可返回可选 published 原发布确认，用于识别已消费预览；新修订必须重新确认授权，未知提交结果不能被静默丢弃。详细证据见 [B2 复盘](reviews/2026-10-30-b2-review.md)。
