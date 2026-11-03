# Tako 开发交接入口

## 当前接续点（2026-11-03）

本机3300已保留数据升级0018，API0.18。N2书/章/版本最低处置与复核、正式后审、Web `/ops/novels`、公开列表/目录/正式章读取，以及App长文频道/目录/阅读已实现。**作者App固定预览/发布恢复与正式管理尚未接线，N2未整体收口**。以[主开发进度](primary-progress.md)和[N2连续复盘](../reviews/n2-publication-implementation-review.md)末段为准，下列旧检查点是历史。

peer8d79作者反馈已普通合入e8c96cd，契约未退回；本窗口后来观察到dfe0ff6跨作品反馈收件箱，含共享API/CommentsPanel变更，留下一独立审查窗口，不称已合入或验证。主开发继续N2，不重复开发同事反馈收件箱。新独立组件门禁见 `scripts/check_novel_reading_components.cjs`，运营浏览器夹具见 `scripts/check_novel_ops.cjs`。本端不构建APK或操作设备/ECS。


更新于 2026-11-03。当前优先独立 Android App；先读本页与双方进度，再读相关规格。历史阶段记录保留在 docs/reviews，旧包、旧测试数量与旧“未接入”措辞不覆盖下面的当前状态。

## 当前职责（用户明确）

**双方执行方式已调整：** 一次规划多个完整业务包，连续完成当前包；小提交不等于小交付，不在内部工作区之间等待用户反复说“继续”。同事下次同步请先读[并行端手册06](06-parallel-development-playbook.md)，并在自己的进度随下一必要提交记录接收情况；主开发同等规则见[手册05](05-development-playbook.md)。每次实际推送的同步、安全和必要验证仍保留。

主开发只负责业务、规格、实现、自动化和集成，**不负责APK构建/安装/USB/ADB或真机测试**。每次推送在[设备任务队列](device-requests.md)交接给同事，待其确认/报告。完整规则见[主开发手册](05-development-playbook.md)，旧阶段分工不覆盖本条。

## 本轮业务规划

2026-11-03最新整合：M3目录、M4复核、M5版本决策已普通合入并通过本端工程/真实服务回归，[独立复核](../reviews/cross-review-primary-240ae2e.md)。长文N2[阶段规格](../novels/n2-publication-reading-spec.md)及ADR003已更新：用户确认多章独立排队、按提交预约固定号、驳回/撤回保留号。N2运行接口尚未实现，下一步N2-A；不要沿旧“审批通过时才分配序号”假设开发。设备及同事新整条页面/HTTP验收继续独立。

长文[N1私密创作](../novels/README.md)已接App和本机3300：开书→章稿→加密离线续写→同步→冲突另存独立新章节。[N1-B证据](../reviews/private-chapter-drafts-review.md)。OpenAPI0.14.0、迁移0015独立章稿表；旧中篇表及密文格式保留。M2定向修订发行与M3～M5已整合，设备另待。下一业务按N2阶段规格实施预约/预览/审核内核，再公共阅读与最低纠错、千章目录；不提前开放完结或追更。

## 当前已做到哪里

**继续实施：** N2正式书章管理、资料审核（普通作者生效后审／观察期先审）和独立App客户端已经实现并验证，资料与隐藏恢复均不改私稿或新章事件；App页面与公开长文仍未接线，见连续N2实施记录及最新primary-progress。peer427eff8已合入并独立验，peer8d79e56是下一窗口待审包。本机最新自动化为128模型、完整后端真实MySQL/契约、16/17迁移演练及实际中篇修订链路；旧数量保留为历史证据。

**最新检查点（2026-11-03）：** 主开发N2章节发布内核a16560a、同事作者异常恢复d1a47c3已普通整合为5a131f1。完整后端真实MySQL/契约/race/vet、迁移回退重升、123模型/类型/lint/7门禁、作者组件和真实作者故障链路通过。N2尚缺正式管理、最低治理、公开目录阅读及App接线，见[连续实施记录](../reviews/n2-publication-implementation-review.md)，不要把旧原型或旧包当N2可用。peer427eff8是下一集成窗口待审包。

新增00016不会由API二进制自行迁移；本机升级沿[tako-restart](../../.agents/skills/tako-restart/SKILL.md)的迁移后启动流程，保留账号、凭据和卷。当前主开发3300仍是上一运行版本，N2验证在独立测试库完成，不声称3300已提供新接口。以下是之前交付的历史证据索引，最新数量/分工以本段和双方progress为准。

S2搜索已接入App源码（ce1670a），18读者/服务组、86模型、五套页面及独立真实HTTP初验通过；本机3300已升级到搜索API，用户确认同事在其独立电脑验收。按用户新分工，本端不再承担打包/设备任务；每次推送交接见 [设备任务队列](device-requests.md)，当前搜索设备结果待同事记录。不要用旧1793f7f包验新搜索。详见 [App搜索复盘](../reviews/mobile-search-app-review.md)。


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
