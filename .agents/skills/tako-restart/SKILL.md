---
name: tako-restart
description: Restart Tako's existing local 3300 test services after Docker shutdown or container/image removal, preserving database volumes and local credentials. Use for local service recovery, not ECS deployment or new business development.
---

# Tako 本机重启

以本技能所在目录向上三级定位仓库根目录，所有命令在根目录执行；不要假设另一台电脑使用相同盘符。

先读根 `AGENTS.md`、[重启入口](../../../docs/restart/README.md) 和 [当前环境](../../../docs/restart/01-local-state.md)。检查 Git 状态，保留未提交改动。

目标是恢复现有本机测试服务并报告可访问地址，不是继续业务开发。

1. 检查 Docker Desktop 已运行 Linux containers。未运行时提示启动；可根据用户授权启动本机 Docker，但不连接 ECS。
2. 执行 `python scripts/local_restart.py start`。源码较现有镜像更新时加 `--rebuild`；镜像缺失时脚本自动构建。执行期间及时报告进度。
3. 执行 `python scripts/local_restart.py check`，核对测试环境身份、数据库连接、Web 与真实社区接口。成功后给出 `http://127.0.0.1:3300/community`。
4. 失败时按 [故障分流](../../../docs/restart/02-recovery.md) 定位。缺少配置或数据库卷时停止相应写操作，先讨论恢复还是明确新建；不要用 init、seed、删卷或替换密码掩盖错误。

只启动 `tako-local-test`。不启动旧 3000、ECS/3100、Metro 或 Android 编译。用户提出手机连接/构建时再读环境文档对应部分；不能将 HTTP 可用说成手机验收通过。

不要打印 `.env`、`docker compose config`、容器环境变量、数据库正文或凭据。不做 Docker 全局清理。启动失败不扩大到云端部署、邮件配置或账号重建。
