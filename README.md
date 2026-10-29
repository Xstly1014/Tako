# 文字创作社区

Go、MySQL 与 Nuxt 驱动的文字创作社区。当前开发增量 A：邮箱登录与可靠草稿保存。

## 业务约束

- 服务端事务提交后才能确认保存。
- 旧修订不得覆盖新正文，冲突自动另存，恢复操作幂等。
- 本机未同步文字在退出后保留，仅原账号恢复，不跨账号上传。
- 不记录正文、验证码、会话凭据和 SMTP 密码。
- 暂不实现发布、删除、回收站、富文本或离线启动。

## 文档

- [业务决策](项目业务共识.html)
- [增量 A 规格](增量A开发规格.html)
- [开发进展](docs/development.md)

生产凭据仅通过环境变量配置，不提交 `.env`。邮件必须使用真实发送服务验收；本地模拟服务仅验证协议流程。

## 容器开发

本机需 Docker Desktop（Linux containers）与 Compose。复制 `.env.example` 为 `.env`，先设置 MYSQL_PASSWORD、MYSQL_ROOT_PASSWORD、AUTH_PEPPER（至少 32 字节随机值）和 MAIL_ENCRYPTION_KEY（独立 32 字节随机值的 64 位十六进制编码），再执行以下命令。不要输出或提交这些值。

```sh
docker compose up -d mysql
docker compose run --rm tools go run github.com/pressly/goose/v3/cmd/goose@v3.26.0 -dir migrations up
docker compose run --rm tools go test -race ./...
docker compose run --rm tools go vet ./...
docker compose up -d --build api
docker compose up -d gateway
```

数据库只绑定本机 `127.0.0.1:3307`，API 只绑定 `127.0.0.1:8080`。这是本地开发配置，不可原样作为公网部署。

## 接口契约与阶段复盘

- 同源 Swagger UI：http://localhost:3000/docs/ （先启动 gateway）
- OpenAPI JSON：http://localhost:3000/openapi.json
- 唯一契约源：`backend/internal/contract/openapi.yaml`，运行时请求校验与自动化测试共用。
- 文档由 `API_ENABLE_DOCS` 显式控制，程序默认关闭，本地 Compose 默认开启；公网部署保持关闭或另行限制访问。
- 浏览器通过验证码接口登录后自动携带 Cookie，无须复制令牌。不得为调试绕过 Origin 校验。
- [阶段复盘与阻断项](docs/reviews/2026-10-29-server-review.md)

自动化检查覆盖文档有效性、双向路由覆盖、正常链路响应、非法输入、错误响应关联与故意破坏响应的反例。GitHub Actions 已配置，但未推送，不能宣称远程 CI 已通过。

- `/health/live`：进程存活。
- `/health/ready`：仅检查数据库连接，尚不代表登录、迁移版本或保存链路已验收。

测试使用真实 MySQL；缺少 `TEST_MYSQL_DSN` 时集成测试跳过，不可把跳过当作验证通过。Compose tools 已配置此变量。测试账号和草稿具有随机标识，测试后清理自身数据；只在开发数据库执行。

登录、会话与草稿 API 已接入并完成真实 MySQL 集成测试，详见 [接口说明](docs/api.md)。身份从服务端会话取得，不接受客户端 owner_id 冒充身份。前端和真实邮件验收尚未完成。

前端进展更新：Nuxt 私密写作空间已接入登录协议、草稿和本机同步，见 [前端说明](docs/frontend.md) 与 [阶段复盘](docs/reviews/2026-10-29-frontend-review.md)。真实邮件、浏览器 Cookie 全链路及完整 A 验收尚未完成，测试夹具不等于生产登录。

本机启动前端：`docker compose up -d --build api web gateway`。访问 http://localhost:3000/ 或 http://localhost:3000/workspace 。已有网关更新配置后需 `nginx -t` 通过再重载。邮件 worker 独立运行；真实登录环境必须同时启动：`docker compose --profile mail up -d mail-worker`。仅启动前端和 API 无法发出验证码。

启动新版 API 前，还需要在 `.env` 配置至少 32 字节随机的 `AUTH_PEPPER`；不要在重启时重新生成。真实邮件配置也放入 `.env`。仅本机开发允许 `COOKIE_SECURE=false`，生产必须 HTTPS。

验证码现在通过持久化队列发送，还需独立 `MAIL_ENCRYPTION_KEY`。配置 SMTP 并构建 API 后，用 `docker compose --profile mail up -d mail-worker` 启动发送进程。发送接口新增必填 `delivery_id`，详见 [邮件任务与恢复语义](docs/mail-delivery.md)。没有 worker 时入队任务不会发送，202 不等于送达。

草稿列表、保存确认时间和历史快照已接入；[保留规则与运行说明](docs/draft-storage.md)。通过 `docker compose --profile maintenance up -d maintenance` 独立执行历史清理，不启用邮件发送。迁移前必须备份，迁移不会补造旧版本。

Resend 本机验收：已验证本人收件箱真实收到。日常启动已配置邮件的完整环境：`docker compose --profile mail up -d api web gateway mail-worker`。worker 配置 unless-stopped，手动停止后需显式重新启动；本机启动不等于生产可用性保障。

当前增量 A 收口：[运行与恢复](docs/operations.md)、[2026-10-30 收口记录](docs/reviews/2026-10-30-a-closeout.md)。本地后端测试改用 `python scripts/test_backend.py`，隔离到 writing_test；不要在真实用户库运行清理测试。
