# Tako 本机重启手册

## 2026-11-05 · 当前启动与业务基线

当前源码与本机3300为API0.26.0、迁移24，保卷升级、没有重新造数。N3私密续读、作者“正式管理→书籍资料→完结与指定整改”和运营“小说治理→处置记录→指定章节整改”已接实际服务；原命令先加密/本标签页落盘，未知只查原结果。运营正式章目录不含私稿，作者源稿元数据仅本人可见。重启仍用 `python scripts/local_restart.py start` / `check`，同时检查maintenance成功心跳；不要删除卷/密钥或回退有业务数据的迁移。

N3工程自动化闭环不代表Android或真实用户结果。当前ADB可用设备0，主开发继续持有P0 C1和P2新页设备队列；同事专职Agent，不需重复原任务。N4书架追更与N5章讨论/长文发现尚未实现。后文旧版本/设备归属为历史，最新证据看[主开发进度](../handoff/primary-progress.md)和[N3连续复盘](../reviews/n3-reading-completion-implementation-review.md)。

## 2026-11-05 · 当前启动基线

当前源码与本机3300为API0.24.0、迁移23。`python scripts/local_restart.py start`保卷启动API/Web/网关和maintenance，`check`同时验证维护进程最近成功心跳。新增30天续读回执维护，不清当前位置或未同步本机记录；不要为重启删除卷/密钥或回退有业务数据的迁移。App续读已接线，完结/指定整改未开放；后文旧版本为历史记录，当前证据见N3复盘和primary-progress。

2026-11-02。用于停止 Docker，或删除容器/镜像但保留数据卷之后，恢复当前开发环境。新电脑第一次启动看 [交接 02](../handoff/02-engineering-and-setup.md)，不是直接套用旧机重启。

两个独立技能随仓库保存：

- `$tako-restart`：恢复本机服务，检查成功后报告入口。
- `$tako-handoff`：整理交接，或在新会话读取交接并接手工作。

若客户端的技能选择器支持 @，可按名字搜索选择；标准显式写法是上面的 `$技能名`。新增技能可能需要重新打开项目或新会话才能出现在列表；未刷新时可直接附上 `.agents/skills/tako-restart/SKILL.md` 或 `tako-handoff/SKILL.md` 的文件链接，不依赖旧聊天。

## 当前职责

当前API契约0.22.0、迁移至0021：私密书与章稿独立表，升级保留原中篇数据。使用上述`start --rebuild`重建API再迁移；不要手动删除章表、回退已有书/章的数据库或清本机密钥。N1章节写作、N2正式发布/管理/治理与公开阅读API已实现；N2作者App固定发布、正式管理及复核已接线；账号观察期与中篇先审已接线并通过真实服务整条联调，原生交同事验收。N1与M2已合入；重启成功仍不代表新包/真机通过。

按2026-11-04最新分工，主开发也负责APK构建/安装/真机，设备可用时执行；同事专职Agent评测。重启服务不代表已完成新包或设备验证，也不自动修改系统信任/手机设置。新API先审回执含pre_review，需匹配App源码；0019～22有业务数据回退保护，不能为重启down或清卷。详见[接手清单](../handoff/07-primary-takeover.md)。

## 最短重启路径

打开 Docker Desktop，确认 Linux containers。在仓库根目录执行：

```powershell
python scripts/local_restart.py start
python scripts/local_restart.py check
```

镜像被删除会自动重建 API/Web；MySQL/nginx/Go 工具镜像由 Docker 按需拉取。需要网络、时间和可用磁盘。日常启动不造数、不安装手机、不编译 Android。代码变更后需要重建旧镜像时执行 `python scripts/local_restart.py start --rebuild`。

入口是 **http://127.0.0.1:3300/community**，不是 localhost:3000。网关按 Host 区分环境，不能随意改成 localhost 或局域网 IP。

成功标准是：保留原数据库身份、迁移成功、就绪检查通过、Web 社区页与真实社区 API 可访问且标记为 test。它不代表账号/评论手机体验、邮件送达或公开上线验收。

详细文档：

1. [当前环境和必须保留的内容](01-local-state.md)
2. [失败处理和数据恢复边界](02-recovery.md)
3. [开发交接入口](../handoff/README.md)

## 清理前

用户已选择“删除容器和镜像、保留数据卷”。**释放运行内存主要靠停止容器/退出 Docker Desktop；删镜像主要释放磁盘。** 此文档不执行清理，也不授权全局删除其他项目资源。

保留本仓库、`.runtime/`、`backups/` 与所有数据库/缓存数据卷。不要使用 `docker compose down -v`、`docker volume prune`、`docker system prune --volumes` 或 Docker Desktop 的清除所有数据/恢复出厂设置。

需要新快照时：

```powershell
python scripts/local_test_restore.py
```

这会加密备份当前独立测试库，并在独立临时 MySQL 中导入、校验全表指纹，不覆盖源库；备份存 `backups/local-test/`，密钥在 `.runtime/local-test/recovery.key`。它是本机备份与隔离恢复演练，不是离机备份。库有写入时指纹变化会拒绝宣称成功，应暂停测试写入后重试。备份/密钥不提交 Git。
