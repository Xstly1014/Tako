# Tako 本机重启手册

当前N5-B实际App讨论/本人和作者隐藏书评论删除/真实运营治理整条已通过，运行0.29/27。删除未知原请求不换标识，确认后GET失败仅重读。下一N5-C长文搜索；Android/真实用户结果仍待，详见[N5复盘](../reviews/n5-discussion-discovery-stage-review.md)。

## 2026-11-06 · 当前运行已升级N5服务

本机3300已保配置/卷升级API0.29/迁移27，seeded=false，含章节讨论和运营页面。升级前加密快照20261106T021328Z-bba848bb.tako.enc，31,229,897字节；独立恢复62表/20,118草稿/20,185修订，99.55秒核对一致，本机非离机。不是生产部署，无新APK/设备结果。实际讨论联调以N5复盘及primary-progress为准，不沿用下文旧0.28运行状态。


## 2026-11-05 · N5章讨论服务检查点

源码API0.29/迁移27，N5-A章评论读/发/回复/删、本人原因、作者按书管理和运营屏蔽撤销已通过完整HTTP/MySQL/契约回归；5客户端模型/生成/类型lint/7门禁通过。实际App评论面板与Web运营尚未接入；下一步按[N5规格](../novels/n5-discussion-discovery-spec.md)与[阶段复盘](../reviews/n5-discussion-discovery-stage-review.md)推进，不能把API当App完成。

本机3300仍0.28/26、N4书架/消息可用，未在服务检查点重复部署。只有专用验证库已27；新代码启动前必须迁移27，旧中篇共享限频也依赖新表。下一运行升级先备份/恢复再保卷迁移，不回退有新评论/回执的数据。主开发继续非Agent及设备，同事仅Agent，无需重复本包；无新APK、ECS或真实用户结果。


## 2026-11-05 · N4-C当前运行与交接基线

本机3300现为API0.28/迁移26，保留配置/数据库卷，seeded=false。实际App已有我的书架、底部消息、汇总详情→目录/正文→消息返回；新章由真实maintenance批次投递。用户确认N-D20同书本批当前可读待提醒章汇总一条、生成后不追加。工程证据见[N4复盘](../reviews/n4-shelf-follow-stage-review.md)与[ADR005](../novels/adr-005-novel-notices.md)，无本批APK/Android/真实用户结果。

升级前加密备份20261105T092121Z-c9633745.tako.enc，31,203,715字节；独立恢复60表/20,118草稿/20,195修订，133.61秒一致，非离机。空消息库可回退26，有消息/覆盖即拒回退。不要删消息、卷或密钥解围，不启动ECS。

正常重启沿用start/check；缓存齐全且Go模块网络失败可用 `python -X utf8 scripts/local_restart.py start --offline`，固定已缓存Goose3.26.0源码且保留校验，缺缓存明确失败。主开发承担非Agent开发及设备；同事仅Agent/评测。本批不需要同事重复实现书架/消息。下一设备窗口先退出P0 C1，再验N4原生；下一独立业务为N5按章两级讨论，先对齐原已确认删除权利再定规格。


## 2026-11-05 · 当前启动与业务基线

本机3300已保留配置/数据卷升级到API0.27、迁移25，seeded=false。N3续读/完结整改继续可用；N4实际App源码已接目录加入→我的书架→目录/正文→来源返回、追更开关、移出保私人位置与账号隔离加密操作恢复。消息投递仍未实现，UI明确目前只保存选择，不冒称追更提醒已开放。未改Web镜像或启动ECS。

重启仍用 `python scripts/local_restart.py start` / `check`，校验maintenance成功心跳；不要清卷/密钥或回退有业务数据的迁移。升级前58表加密备份/独立恢复已通过，20261105T065725Z-57add7a7.tako.enc；本机非离机。首次启动通用命令失败后，独立迁移/再次保卷启动验证成功，不编造首次根因。

本批实际HTTP/MySQL与App源页面适配器链路通过，不是Android或真实用户业绩；无新APK/安装/设备结论，主开发保留P0 C1与后续设备队列，同事继续Agent评测。按用户新约定，小改动定向检查、完整业务批次再集成/推送，细则见共享开发手册05。下文旧版本为历史，当前证据看主开发进度和N4复盘。

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
