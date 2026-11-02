# 重启失败时如何处理

先用 `python scripts/local_restart.py check` 检查；不要直接换密码、造数或删库。工具不输出 Docker 原始错误（可能包含插值后的凭据）。人工诊断也不要打印 `.env`、Compose 完整 config 或容器环境变量。

| 现象 | 处理 |
|---|---|
| Docker 不可用 | 启动 Docker Desktop，等待引擎就绪，确认 Linux containers；再执行 start |
| API/Web 镜像不存在 | start 自动构建；下载失败检查网络与 Docker 构建依赖，不改业务数据 |
| 镜像存在但代码更新 | start 加 `--rebuild`，避免旧镜像看不到新代码 |
| 配置/身份 SQL 缺失 | 从本机保留文件恢复配套版本；不要对现有库执行 init 生成另一套密钥 |
| 数据卷不存在 | start 会拒绝空库替代；先确定恢复还是另建完全独立测试环境 |
| 凭据或 namespace 不一致 | 检查是否用了另一电脑配置，不能修改数据库账号来“试通” |
| 迁移失败 | 保留数据与当前 schema，检查相关 migration；禁止 seed/降级掩盖错误 |
| 502 / readiness 失败 | 核对 api/web/mysql/gateway 状态、容器退出码和经过脱敏的安全日志；不要先启动旧 3000 |
| 3300 被占用 | 确认占用进程属于谁，不能杀其他项目；当前浏览器/App 契约固定 3300，改端口需同时调整 |
| App 无法读取 | 先确认电脑 3300 API 可用，再确认 USB 授权与 reverse；不自动开公网或全局放开 CORS |

## 丢卷时的恢复边界

本次约定保留卷，所以正常重启不走此路径。若意外删卷：保留 `.runtime/local-test/.env`、`recovery.key` 和 `backups/local-test/*.tako.enc`，停止反复启动。已有 `scripts/local_test_restore.py` 会**新建快照后隔离演练**；它不是“从现有备份恢复业务卷”的命令，源库已经丢失时不能拿它恢复。

交接者应先用 `scripts/recovery.py` 的 AES-GCM 读取/隔离恢复能力，适配本机测试 Compose 与对应 recovery.key，在隔离容器验证现有备份。该脚本命令行默认读取根 `.env`，**不要直接用于本机测试库**。核对快照日期、namespace、表指纹后，与用户确认恢复目标；仅在新建的空测试目标导入，经核对再接入，不能覆盖现有卷。

如果用户明确接受丢弃原测试状态，可按 [交接 02](../handoff/02-engineering-and-setup.md) 为新环境创建独立配置/namespace/合成数据；需先归档旧本机配置和备份，不静默覆盖。没有配套备份或密钥时不能保证还原。此意外丢卷恢复不是本批已经执行的验收。

## 验收与证据

每次正常重启核对数据库 test/namespace、迁移退出状态、`/health/ready`、`/community` 和 `/api/community` 的 test 响应头。脚本成功只说明这些检查通过。

账号/收藏/评论的真实 API 检查、组件夹具、Android 构建、真机操作是不同证据；详见 [交接工程说明](../handoff/02-engineering-and-setup.md) 和最新阶段复盘。不要为了重启跑全部 Android native 编译、真实发信或云端恢复。
