# 增量 A 运行与恢复

## 完整本机启动

运行 `python scripts/test_backend.py` 为隔离的 writing_test 创建迁移并运行竞态测试和静态检查。实际用户库与测试库分开；不再对用户库运行会清理历史的集成测试。

配置 .env 后：

```sh
docker compose --profile mail --profile maintenance --profile ops up -d api web gateway mail-worker maintenance monitor
```

MySQL 保持 version 6。monitor、maintenance 和 mail-worker 缺一不可：入队不等于已发出，进程重启策略不等于故障告警。

## 告警

独立 monitor 直接使用 Resend 发送摘要，不依赖被监控的邮件队列。检查周期 30 秒；心跳超过 150 秒、成功维护超过 180 秒、有效邮件等待超过两分钟、近期终态发送失败，以及数据库表与索引超过默认 512 MiB 时告警。API 5xx 通过聚合计数观察；没有正文、邮箱或凭据进入心跳与故障摘要。

通知状态保存到 .runtime/monitor；同一故障十分钟提醒一次，状态变化最短一分钟间隔，恢复单独通知。邮件发送失败会记录安全错误并重试。告警邮件仍可能因同一服务商故障无法送达；这不是独立于主机与发信服务的高可用监控。正式上线前补外部存活探针。

用户已授权向其控制邮箱发送测试与故障摘要，实际收到测试通知。维护进程停止演练检测到 maintenance_stale，恢复后检测正常并由服务商接受恢复通知；不得将服务商接受直接算作本人实际收件。

## 加密备份与恢复

安装 scripts/requirements.txt 中的 Python 依赖；保持 BACKUP_ENCRYPTION_KEY 为独立 32 字节随机密钥（64 位十六进制），单独保存在密码管理器。AUTH_PEPPER、MAIL_ENCRYPTION_KEY 和业务配置也必须单独保管，不与备份对象放在一起。

```sh
python scripts/recovery.py backup
python scripts/recovery.py restore --file backups/具体文件.tako.enc
python scripts/recovery.py drill
```

使用 MySQL single-transaction 导出，明文不落盘，压缩后 AES-256-GCM 加密，文件与运行报告被 Git 忽略。恢复只发生在随机命名、无网络无宿主端口的临时 MySQL；不覆盖源库。逐表核对所有字段指纹，含正文、修订与幂等确认；易变 runtime_health 不纳入一致性指纹。

备份前后比较业务数据；期间发生变化则拒绝声称已验证，需在相对安静时重试。当前适用于初期小库，不承诺大库流式导出或持续写入时的自动验收。没有实现自动删除旧备份。

2026-10-30 本机演练：9 张业务/迁移表指纹匹配，最新一次恢复约 18 秒；另执行密文篡改拒绝检查。原库未覆盖。本机恢复不等于离机备份。

## OSS 离机往返验收

.env 配置 OSS_REGION、OSS_BUCKET、OSS_ACCESS_KEY_ID、OSS_ACCESS_KEY_SECRET，可选 OSS_SESSION_TOKEN。使用专用 RAM 权限，限定 tako-backups/ 前缀的 PutObject、GetObject、PutObjectAcl、GetObjectAcl；不需要删除或管理全桶。优先专用私有 Bucket；若复用现有 Bucket，所有备份对象必须显式 private 且匿名 HEAD 返回 403。工具在上传时指定 private 并执行这两项检查。Key 不进入命令行参数。

```sh
python scripts/oss_backup.py
```

工具只上传 .tako.enc，下载后校验 SHA256 并运行独立恢复。使用阿里云官方 ossutil 2.4.1，准备时已验证官方 SHA256，二进制位于被忽略的 .runtime/tools；其他环境需自行安装并调整路径。支持范围目前为本机 Windows 验收，不当作 ECS 自动备份定时任务已交付。

ECS 云端加密备份已完成 OSS 往返和本机独立恢复。用户确认每天一次、保留 30 天；ECS 的 systemd 服务已手工执行成功，timer 每日北京时间 03:00 至 03:05 运行。正常离机恢复点约落后一天，失败会更久。monitor 读取独立状态文件，检测失败、卡住及超过 26 小时未成功。

## 按授权恢复一个历史修订

普通管理员无草稿浏览接口。操作者必须先在独立记录中确认草稿所有者的恢复请求、账号 ID、源草稿与目标修订，为该请求分配 authorization-ref UUID。引用值不是授权凭证，也不能代替真实用户确认。

```sh
docker compose --profile recovery run --rm draft-restore -owner 账号UUID -draft 草稿UUID -revision 修订号 -mutation 固定请求UUID -authorization-ref 授权记录UUID
```

默认只报告修订是否存在及保存时间，不输出正文。核对后加 -apply，另存新草稿；原稿不覆盖。重试沿用 mutation，避免重复副本。请求前和完成后写入 .runtime/recovery-audit/recovery.jsonl 并刷盘，不记录正文；如果完成确认丢失，重放原 mutation 核对。超过保留期的快照可能已不存在。

## 当前明确取舍

- A 使用 database/sql 参数化手写 SQL，保持事务测试；sqlc 不作为 A 交付条件，不再把它列为已集成工具。
- 草稿幂等元数据暂不自动过期，避免长期离线请求重放重复创建；容量由告警观察，后续若引入清理，必须先定义客户端兼容期。
- 退出保留本机数据，不自动删稿；本机容量清理作为独立需求，不为收口擅自删除用户内容。
- 前端审计当前仍有 7 个低危传递项，未发现 moderate 及以上；不执行会降级 Nuxt 的强制修复。升级需复测，临时 rolldown override 仍有记录。
