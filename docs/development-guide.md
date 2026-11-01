# 本机开发与验证

[返回 Tako](../README.md)

> 2026-11-01：新电脑请先按 [本机独立测试环境启动](handoff/02-engineering-and-setup.md)，使用 3300。下方根 Compose / 3000 / ECS 是历史流程，不是本轮默认启动方案。当前 App 优先，ECS 已停机，切勿照历史说明连接生产。

## 本机开发

需要 Docker Desktop（Linux containers）/Compose。宿主不要求安装 Go/Node；运维脚本需要 Python，备份加密依赖见 scripts/requirements.txt。

复制 .env.example 为 .env，填写数据库密码、至少 32 字节随机 AUTH_PEPPER，以及独立 32 字节随机 MAIL_ENCRYPTION_KEY（64 位十六进制）。密钥生成后保持稳定，单独保管，不随启动重置。真实 SMTP 或 Resend、告警收件人也仅填本机 .env。

```sh
docker compose up -d mysql
docker compose run --rm tools go run github.com/pressly/goose/v3/cmd/goose@v3.26.0 -dir migrations up
docker compose up -d --build api web gateway
docker compose --profile mail --profile maintenance up -d mail-worker maintenance
```

配置 Resend 告警后启用 monitor：

```sh
docker compose --profile ops up -d monitor
```

独立 worker 才会持续发送验证码。202 仅表示入队，sent 仅表示服务商接受，不能冒充真实收件。Resend 测试发件人只向其注册邮箱发送；对公众发信须验证自有域名。

本机入口：http://localhost:3000/ 。MySQL 只绑定 127.0.0.1:3307，API 只绑定 127.0.0.1:8080。这些是开发配置，不能原样公开。

## 验证

```sh
python scripts/test_backend.py
docker compose run --rm frontend-tools npm ci
docker compose run --rm frontend-tools npm test
docker compose run --rm frontend-tools npm run typecheck
docker compose run --rm browser-tests npm run test:e2e
```

后端测试在独立 writing_test 数据库中执行迁移、race、真实 MySQL 集成与 go vet；不能在用户库运行历史清理测试。缺少 TEST_MYSQL_DSN 时集成测试会跳过，不算通过。

前端有 12 项同步核心测试及 8 项 Chromium 场景；浏览器 API 夹具不冒充真实邮件或真机验收。CI 运行后端契约/MySQL检查与前端单元、类型、构建和依赖审计；真实设备/恢复另留验收记录。

## 契约和诊断

backend/internal/contract/openapi.yaml 是唯一 HTTP 契约，运行时校验、路由覆盖与响应测试共用。Swagger 资源自托管；本地 API_ENABLE_DOCS=true 时访问 http://localhost:3000/docs/ ，云端关闭。Cookie 由浏览器管理，不手工复制令牌或绕过 Origin。

/health/live 表示进程存活，/health/ready 仅表示数据库连接，不宣称全部业务已验收。请求 ID、结构化错误与后台任务状态用于定位故障；详细运行方式见文档。

## 云端与备份

ECS 使用独立空库，核心应用镜像 37b3086，迁移 version 6；通过 SSH 转发后的 http://localhost:3100/workspace 访问。3000 和 3100 是不同数据环境。隧道在电脑切网或休眠后可能需重连，ECS 服务和定时备份不依赖电脑持续在线。

每日北京时间 03:00～03:05 加密备份至 OSS，保留策略 30 天。正常离机恢复点约一天，失败会更久并告警。已验证上传私有 ACL、匿名拒绝、下载校验与独立恢复；不把未来自然到期删除称为已实测。

.env、.runtime、备份、开发证书、私钥、构建及测试产物均禁止提交。公开测试仍需域名实名/备案/DNS/HTTPS、自有发信域名与主机外探针；不宣称高可用、无中断部署或高并发性能。
