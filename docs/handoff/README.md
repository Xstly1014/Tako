# Tako 开发交接入口

## 2026-11-05 · 当前启动与业务基线

本机3300已保留配置/数据卷升级到API0.27、迁移25，seeded=false。N3续读/完结整改继续可用；N4实际App源码已接目录加入→我的书架→目录/正文→来源返回、追更开关、移出保私人位置与账号隔离加密操作恢复。消息投递仍未实现，UI明确目前只保存选择，不冒称追更提醒已开放。未改Web镜像或启动ECS。

重启仍用 `python scripts/local_restart.py start` / `check`，校验maintenance成功心跳；不要清卷/密钥或回退有业务数据的迁移。升级前58表加密备份/独立恢复已通过，20261105T065725Z-57add7a7.tako.enc；本机非离机。首次启动通用命令失败后，独立迁移/再次保卷启动验证成功，不编造首次根因。

本批实际HTTP/MySQL与App源页面适配器链路通过，不是Android或真实用户业绩；无新APK/安装/设备结论，主开发保留P0 C1与后续设备队列，同事继续Agent评测。按用户新约定，小改动定向检查、完整业务批次再集成/推送，细则见共享开发手册05。下文旧版本为历史，当前证据看主开发进度和N4复盘。

## 2026-11-05 · 当前启动基线

当前源码与本机3300为API0.24.0、迁移23。`python scripts/local_restart.py start`保卷启动API/Web/网关和maintenance，`check`同时验证维护进程最近成功心跳。新增30天续读回执维护，不清当前位置或未同步本机记录；不要为重启删除卷/密钥或回退有业务数据的迁移。App续读已接线，完结/指定整改未开放；后文旧版本为历史记录，当前证据见N3复盘和primary-progress。

更新：2026-11-04。本机3300独立test为API0.22.0/迁移0021，保留数据升级。N2长文固定发布、正式管理/资料审核、最低治理、公开目录阅读及账号观察期入口已接App/运营；按用户新增授权同批补齐中篇先审。多章A1/B2乱序与中篇固定提交/撤回/节点/驳回保正式版已接实际HTTP/MySQL整体验证。不是原生或真实用户成效声明。

先读[主开发进度](primary-progress.md)、[并行端进度](parallel-progress.md)、[本批复盘](../reviews/observation-pre-review-stage-review.md)及[中篇先审规格](../publication/pre-review-spec.md)，再读[N2规格](../novels/n2-publication-reading-spec.md)和[连续复盘](../reviews/n2-publication-implementation-review.md)。同事e99ab22已在3ea66c9合入；不改其进度或将旧APK结果套给本批。

N2工程主链路原观察期缺口关闭；**P0 C1原生尾项、P2新页原生**仍由同事下一设备批次验证，见[设备任务](device-requests.md)。主开发现接手APK/安装/真机，设备可用时执行；ECS仍暂停。下一独立包N3私密续读与不可逆完结/指定整改一起交付；N4书架追更、N5按章讨论未实现。P1自动48h逾期监测须在团队外创作者开放前完成，不能声称已有自动SLA。

独立真实联调 `node scripts/check_novel_publication_live.cjs` 只对专用test运行，DOM/导航/journal适配与少量case补充分支明确标注；接口唯一源、错误和迁移同源码交付。重启用[tako-restart](../../.agents/skills/tako-restart/SKILL.md)，协作用[tako-collab](../../.agents/skills/tako-collab/SKILL.md)。历史“未接入”绑定原SHA，不覆盖当前状态。

## 当前职责（2026-11-04用户重新划分）

主开发接手非Agent的业务/后端/契约、App/Web、CI与验收脚本、APK构建/安装/真机和旧未完成开发任务；同事专职作者服务Agent及业务评测，不再重复原开发/设备任务。详见[接手清单07](07-primary-takeover.md)、[主开发手册05](05-development-playbook.md)及[并行端手册06](06-parallel-development-playbook.md)。旧设备分工已经失效，旧证据仍绑定原SHA，不消除未完成项。

继续按完整业务包规划实施，必要共享检查点可推送，但不因一个小接口反复结束工作。推前fresh同步/审查/普通集成规则不变，双方各写自己的进度；本条随下一推送通知同事，不等于其已读取。当前源码N3续读API0.23/迁移22已验证，本机3300仍0.22/21；App续读接线与完结整改未交付，读[主开发进度](primary-progress.md)与[N3规格](../novels/n3-reading-completion-spec.md)。

## 历史证据索引

下列记录保留原阶段事实，不覆盖以上当前状态。

此前新增 [S1搜索API](../reviews/public-search-api-review.md)，用户确认标题/笔名/简介；服务端/契约/失败验证已实现，1b89018三条远程CI已通过，此为S1历史阶段；S2现已接入源码，本机3300已升级，同事独立环境由其协调升级。业务盘点见 [中篇闭环后的下一步](../reviews/business-inventory-after-c1.md)。

中篇私稿→加密本机暂存/离线续写→服务器确认修订→固定预览→正式发布→读者阅读/收藏/两级评论→作者修订/管理，已接入同一工程。C1 列表/编辑与 C2 发布不是待开发空白。

| 项目 | 当前证据与边界 |
|---|---|
| App 源码 | 已合入双方 C1/M1/C2与S2搜索ce1670a；旧2cfd6fb包不含搜索，下一包由并行端冻结构建 |
| 自动化 | 86 模型、18读者/服务组（含搜索客户端/协调）及五套页面通过，新搜索客户端另有真实HTTP/MySQL验证；原生存储/导航仍分设备证据 |
| Web 依赖 | 原中危审计门禁本机及 4c63ad0 远程 Frontend CI 通过；12 原测试+2真实依赖兼容、生产构建与9浏览器回归通过，仍有7 low链报告 |
| 远程与包 | 旧包与旧CI分别绑定旧源码；S2最新结果见[搜索复盘](../reviews/mobile-search-app-review.md)。历史结果见 [整合复验](../reviews/cross-review-primary-a2905e8.md)，以其最终 SHA/指纹为准；构建成功不等于设备验收 |
| 原生体验 | 同事42517be已报告旧包部分ASCII离线恢复/固定预览/未知回执/隐藏恢复通过；中文长粘贴、切号401、冲突及S2搜索仍待设备证据；P0在相关真实移动作者交付前补齐 |
| 真实结果 | 无新增真实用户留存、创作或治理成效声明；合成规模和测试成功不代替运营样本 |

详细过程：[C1 编辑](../reviews/mobile-draft-editor-review.md)、[发布交接](../reviews/mobile-draft-publication-review.md)、[另存竞争](../reviews/mobile-draft-copy-concurrency-review.md)、[本端互审与整合](../reviews/cross-review-primary-a2905e8.md)、[Web 依赖审计](../reviews/frontend-dependency-audit-review.md)。

## 两端如何继续

持续协作用 `$tako-collab`。实际进度分别是 [主开发](primary-progress.md) 与 [并行端](parallel-progress.md)，读远程实际分支的版本；文件发布不等于对方已读/确认。每次推送前 fetch、核对新增工作/接口/重叠，普通合并和推送，禁止覆盖并行工作。

- 主开发：业务/C1/auth/S搜索、共享依赖与构建配置的单一写入、集成与汇总；不执行手机打包/验收。710d04a已由同事独立关闭，见其42517be设备阶段记录。
- 并行端：CI/M1/C2 及其测试/进度；主开发已集成42517be。原“待接 C1 路由 CI”已由其完成，不要重复建设。
- 暂不扩 B3.2、付费、推荐、短帖或生产部署；主开发进入长文N2规格与业务实现，同事维护M1/C2/M2、CI和设备。中篇及N1设备尾项由同事收口，工程/设备/真实结果分别记账。

## 按需阅读

1. [项目与业务状态](01-product-and-status.md)：背景、已确认权利与交付边界。
2. [工程与本机启动](02-engineering-and-setup.md)：新电脑创建自己的合成环境。
3. [并行边界](03-parallel-work.md)：当前具体认领优先于历史建议表。
4. [接手提示](04-codex-start.md)：可复制给另一台 Codex。
5. [主开发手册](05-development-playbook.md)：长期分工、每轮开发和设备交接。
6. [并行端手册](06-parallel-development-playbook.md)：同等执行节奏、同步接收与原分工边界。
6. [C1/C2 接口约定](c1-c2-interface.md)：只传已确认服务器 ID/修订，不传内存正文、不修改工作稿。

根 AGENTS.md、business-first 必读；移动端另读 mobile/AGENTS.md，UI 改动读 ui-deai。技能不能取代用户授权或扩大业务范围。

## 服务恢复与不随 Git 交付的内容

纯本机服务恢复用 `$tako-restart`，见 [重启手册](../restart/README.md)；跨电脑接手用 `$tako-handoff`。本机仅 3300 合成测试环境；ECS 已停，本轮不连接、不启动。没有 USB 时不反复要求用户做手机测试。

.env、数据库、SSH 私钥、OSS/邮件密钥、APK、SDK 和密码不提交。新电脑自行创建隔离合成库，不复制真实用户数据；保留原机数据卷、.runtime 与 backups。个人测试包使用模板 debug 签名，不是商店正式包。

剩余约束必须按 [本轮复验](../reviews/cross-review-primary-a2905e8.md)、[依赖审计](../reviews/frontend-dependency-audit-review.md) 的优先级和退出条件处理；不能仅写成“已知限制”后永久搁置。
