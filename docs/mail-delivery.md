# 验证码持久化发送 · 阶段收口

## 用户可观察行为

客户端为一次发送动作生成并保留 `delivery_id`（非零 UUID），提交：

```json
{"email":"writer@example.com","delivery_id":"061e8d55-f4a0-47b2-b3d5-3ed4b464b0d1"}
```

返回 202，包含 delivery_id、status、expires_at。202 表示数据库已提交，不表示邮件送达。

| 状态 | 含义 |
|---|---|
| queued | 等待 worker 或退避重试 |
| sending | worker 已领取，SMTP 结果尚未确认 |
| sent | 邮件服务接受；不保证进入收件箱 |
| failed | 超过重试上限或载荷不可用，不再自动重试 |
| expired | 已过期、被新请求替代或对应验证码已消费，停止发送 |

网络超时沿用相同 delivery_id 与邮箱重试，返回已有任务状态，不生成新码、不再次消耗发送额度。轮询也复用同一请求，建议低频并在终态停止。不同邮箱复用同一 ID 返回 409 delivery_id_reused。

主动重发使用新 ID，受发送冷却限制；新请求取代旧验证码。验证码从入队时起十分钟有效，不因延迟或重试延长。幂等记录至少保留 24 小时，超过该期限不能重用旧 ID。

## 事务与恢复

- 限流计数、验证码挑战与邮件任务在同一事务提交。并发重试在短事务内串行核对；SMTP 不占数据库事务锁。
- 验证码校验值使用 HMAC；待发明文通过标准库 AES-GCM 加密，绑定任务 ID 与邮箱，终态清除加密载荷。
- 独立 worker 用行锁、SKIP LOCKED 和 30 秒租约领取任务，SMTP 调用最多 15 秒且不超过剩余有效期。
- worker 中断后，租约到期可重新领取。完成更新校验租约令牌，旧 worker 不能覆盖后来领取者的结果。
- 失败最多尝试 5 次，退避 5／10／20／40 秒；过期、已消费或被取代的任务不再开始发送。终态失败使对应旧验证码失效，不影响新验证码。
- SMTP 接受后数据库确认丢失，恢复时可能重复发送同一个验证码；这是明确的至少一次语义，不承诺外部系统只执行一次。
- 已经在网络中发送的邮件无法撤回，用户应使用最新请求的验证码。租约是并发保护，不是分布式外部调用的绝对去重保证。

## 运行配置

1. 保留 `.env` 中的 AUTH_PEPPER，并新增独立随机 MAIL_ENCRYPTION_KEY（32 字节，64 个十六进制字符）。密钥不随启动生成、不提交、不打印；备份恢复需同时保有密钥。轮换不是无损操作，需单独方案。
2. 填写真实 SMTP 配置。
3. 执行迁移并构建 API：

```sh
docker compose run --rm tools go run github.com/pressly/goose/v3/cmd/goose@v3.26.0 -dir migrations up
docker compose up -d --build api gateway
docker compose --profile mail up -d mail-worker
```

worker 仅通过 mail profile 启动。缺少 SMTP 配置时拒绝启动；API 缺 SMTP 时拒绝新发送，但可查询既有任务。不要把入队成功误认为 worker 已运行。

worker 每分钟执行限量清理：过期待办清除载荷，终态任务至少 24 小时后删除，过期会话／旧挑战／旧限流记录按批清理。没有 worker 时清理也不会运行，运维必须监测进程与积压。

## 已验证和未验证

真实 MySQL 自动化覆盖：同 ID 并发入队、异载荷冲突、冷却不部分写入、跨 Service 实例恢复、超时重试同码、租约竞争、模拟 SMTP 接受后丢失确认、过期／取代／消费不发送、上限失败失效、清理保留期。

“重启恢复”自动化使用持久化任务与新 Service 实例模拟进程丢失，不等同于已经完成真实 SMTP 网络故障或生产整机恢复演练。真实邮件送达、部署告警、端到端浏览器登录仍待配置后验证。

契约从 0.1.0 改为 0.2.0：发送请求新增必填 delivery_id，响应由同步 sent 改为持久化任务状态。目前尚未公开发布，无需保留旧的演示语义；后续客户端必须按新契约实现。


## Resend 接入（2026-10-29）

`MAIL_PROVIDER=resend` 使用 HTTPS API；`MAIL_PROVIDER=smtp`（缺省）保留原 SMTP 行为。Resend 模式仅使用 RESEND_API_KEY 与 RESEND_FROM，旧 SMTP 配置不会参与发送。未知服务名和不完整配置在启动时拒绝。

开发测试发件人 `onboarding@resend.dev` 仅允许向 Resend 账号自身邮箱投递。向其他用户发信前必须验证自有域名并更换发件地址；不得把此测试配置作为公开注册验收。

HTTP 408、429、5xx 及网络失败按原退避策略重试；其他 4xx 明确拒绝直接终止，失效该验证码并清除密文。日志只记录 mail_delivery_failed 或 mail_provider_rejected，不记录服务商原始错误体。服务商成功响应须含邮件 ID 才确认 accepted。该适配继续承诺至少一次，尚未接入服务商幂等键。

本次已执行一次指定任务：第 1 次尝试即被 Resend 接受，用户确认收件箱实际收到。未启动全局 mail-worker；浏览器输入验证码登录及草稿写入尚待用户操作验证。现有 /auth/code 契约不变，sent 仍仅表示服务商接受。

参考：https://resend.com/docs/api-reference/errors 、https://resend.com/pricing
