# ECS 私有测试部署 · 2026-10-30

## 当前事实

用户提供并授权访问的新 Ubuntu 24.04 x86_64 ECS，2 vCPU、约 1.7 GiB 可用总内存、40 GiB 系统盘。Docker Engine 和 Compose 从官方 Ubuntu 仓库安装。使用独立空库，不迁移本机账号与草稿。

应用镜像版本 7e8229f，从本机构建镜像导出；ECS 直连 Docker Hub 超时，改用 SSH 加密传输。镜像包 SHA256 及各镜像 ID 均核对一致，服务器不安装 Go/Node 构建工具。MySQL goose 迁移到 version 6。

服务目录 /opt/tako，配置源 infra/compose.ecs-test.yaml。数据库不发布端口；网站只监听 127.0.0.1:3100，公网监听仍只有 SSH。Swagger 关闭。当前是经 SSH 保护的测试环境，HTTP/Cookie 非 Secure 仅用于 localhost 隧道，不能原样公开。

## 访问

本机使用已有授权密钥开启端口转发：

```sh
ssh -N -L 127.0.0.1:3100:127.0.0.1:3100 -i 私钥路径 -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 root@ECS公网IP
```

浏览器访问 http://localhost:3100/workspace 。本机开发环境仍为 3000，数据不互通。隧道关闭或电脑休眠后需重连。iPhone 不能直接使用电脑 localhost；已通过临时热点 HTTPS 转发完成真机验收，现已清理该入口。

本机部署副本密钥和云环境秘密位于被忽略的 .runtime/ecs；原始下载密钥没有修改。云端 .env 权限 600、目录 700。云环境密码、AUTH_PEPPER、MAIL_ENCRYPTION_KEY、BACKUP_ENCRYPTION_KEY 独立生成；仅复用已授权的 Resend 测试发信账号。部署配置及实际秘密不得混为模板提交。

## 重复部署约束

1. 对新空机可执行 scripts/ecs_bootstrap.sh；它只支持 Ubuntu 24.04 amd64，不执行重装、全系统升级或防火墙开放。
2. 在本机/CI 构建镜像，以提交号作为应用镜像 tag。使用 docker save 导出 API、前端、MySQL 和 nginx，再压缩并记录各镜像 ID。
3. 将 Compose、nginx 配置、迁移 SQL 和 CGO_ENABLED=0 构建的 goose v3.26.0 传到 /opt/tako；首次生成独立 .env，后续不能重置这些秘密。
4. 校验传输摘要后 docker load；核对镜像 ID。
5. 在 /opt/tako 执行 docker compose up -d --wait mysql，再运行 docker compose --profile tools run --rm --interactive=false migrate。避免 run 消费部署脚本的标准输入。
6. 启动 api、web、mail-worker、maintenance、gateway，再启动 ops profile 的 monitor。检查就绪、日志和进程，不以容器 Created 为完成。
7. 替换前先备份；当前单实例发布有短暂中断，不承诺无中断回滚。数据库迁移也不能假定随应用镜像回滚。

容器限制：MySQL 640 MiB、前端 192 MiB、Go 进程各 96 MiB、网关 64 MiB。MySQL 缓冲池 256 MiB、连接数 50。日志单文件 10 MiB、三份轮转。首次启动整机约 700 MiB available；这是低流量下的实测，不是压测结论。

## 已验收

- 真实隧道首页、workspace、健康检查 200；私密接口匿名访问 401；docs/openapi 404。
- 用户确认 ECS 版本真实收码登录、保存草稿、关闭重开完整。
- API/Web 应用重启后，草稿、修订、幂等确认指纹不变。
- 云端加密备份经 SSH 下载到本机，在独立 MySQL 恢复成功：9 张业务/迁移表匹配，样本包含 1 份真实测试草稿、4 个修订，恢复约 24 秒。此证据覆盖跨机器恢复，不是仅在源主机新建容器。
- 云端监控首次检查无异常。故障注入与通知本人收件证据来自此前本地环境，尚未在 ECS 重复注入。

## 云端备份下载及恢复

```sh
python scripts/ecs_backup.py --host ECS公网IP --identity 本机私钥路径 --environment-file 本机对应ECS秘密配置文件
```

只下载密文，必须使用该 ECS 对应的 BACKUP_ENCRYPTION_KEY，本机开发密钥不能混用。下载后在本机独立容器恢复，不在 2 GiB ECS 上同时启动恢复 MySQL。末尾添加 --oss 会把同一云端备份上传 OSS、下载、校验并再次独立恢复；OSS_* 最小权限配置齐全时可执行，实际已通过。

## 尚未完成

域名实名/备案/解析与公网 HTTPS；服务器/磁盘故障外部探针。当前不对公众宣发，不把受保护的测试部署称为公开运营上线。


## 每日 OSS 备份与权限纠偏

用户选定每日一次、保留 30 天。tako-backup.timer 在北京时间 03:00 加 0～5 分钟随机延迟触发，Persistent=true；首次实际 service 已执行成功。systemd 状态以成功上传、重新下载、SHA256 相符、AES-GCM 认证通过为成功；不在 2 GiB ECS 上额外启动恢复 MySQL。完整数据库恢复在本机独立容器执行并通过。

OSS 使用专用 RAM 凭据，仅作用 tako-backups/，放在 /opt/tako/.backup.env（600），不进入镜像或仓库。Linux ossutil 2.4.1 安装时核对官方 ZIP SHA256。云端和下载缓存中的过期加密文件在新备份成功后按 30 天清理，仅匹配工具生成的文件名，跳过符号链接及无关文件，Linux 安全测试通过。

初次往返验证后，额外匿名 HEAD 发现对象可公开读；这揭示了“用户说 Bucket 私有”不能代替验证。尚无明文或密钥上传。已暂停自动化，用户补前缀级 ACL 权限后仅将已上传对象改为 private，复核匿名 403；随后上传代码强制 private 并验证 GetObjectAcl 和匿名 403，失败不算成功。原 Bucket 的其他文件及全桶 ACL 未修改。

用户确认配置前缀级 30 天生命周期；生命周期规则的执行是 OSS 异步行为，当前尚未经历 30 天自然到期，不声称删除已实测。未观察到对象 Expiration 响应头时，需要后续核对规则加载；不把用户配置确认等同于执行完成。

备份状态文件只有最后尝试、最后成功与固定失败代码，监控只读挂载；故障邮件带 ecs-test 环境标识。外部主机故障探测仍是公网接入前的缺口。

手机临时内测最终采用电脑热点上的原生 Caddy HTTPS 经 SSH 转到同一 ECS 库，见 [真机验收说明](mobile-acceptance.md)。Tailscale 未完成授权并已停用。备份逾期时间戳注入后，ecs-test 监控实际发送 backup_overdue 通知；恢复真实时间戳后发送恢复通知，均有服务商接受日志。

最终收口：iPhone 与双设备断线/冲突验收通过，用户确认实际收到备份逾期与恢复邮件；最终冲突数据再次 OSS 往返独立恢复通过（2 份草稿、9 个修订）。详见最终验收结论。
