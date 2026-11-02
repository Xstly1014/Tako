# 并行端工作进度

更新时间：2026-11-03（Asia/Shanghai）。维护方：本会话并行开发端；另一端维护 `primary-progress.md`。本文件随本阶段提交发布，以包含它的提交为准；对方是否已读或确认仍未知。

## 当前认领 · M1/C2导航修复与S2整合（USB暂停）

- 用户明确USB已断、其通知后再验，当前不执行设备/安装/打包。此前设备结果继续绑定1793f7f包；中文长粘贴、切号401、设备冲突和导航更新包复验均待恢复条件，不冒充已关闭。
- 本端修复97ef177处理三个明确业务返回目标：管理列表→账号、发布结果/无效发布入口→管理，复用Router dismissTo避免重复栈；普通上下文返回及未知操作保护保留。新增实际M1/C2/账号页面栈回归，旧实现失败，修复后通过，POST计数仍1；类型/lint、86模型、四组件+C1路由通过。详见[导航复盘](../reviews/author-navigation-return-review.md)，尚未入新包/真机复验。
- 按用户后续要求提前fetch到main6ad485e（S2运行源码ce1670a），已读primary-progress、device-requests及S2工程证据；此前本轮开始免检查例外已结束。本端远端仍42517be，对方已合入并读取该设备报告；没有文件重叠，保护本端检查点后普通合并并复验。
- 职责对齐：主开发继续搜索客户端/页面/共享WorkRow、搜索接口及相关业务/自动化，不接管本端M1/C2；本端维护M1/C2与CI集成，负责后续本机包/设备交付。C1/auth/搜索缺陷报告交原负责方，不越界改源码；对方设备任务登记待执行，用户暂停优先。不会因为另一台3300已升级就声称本机已支持搜索。
- 现已普通合并到b69d034，无冲突；整合后类型/lint、契约、86模型、6项门禁及四组件+C1路由均通过，包含新S2页面回归。无API修改，本机未升级3300/重跑搜索HTTP；后续真实API整合以本次CI为准。仅停止本机故障代理，不操作已断开的设备；业务修复不代替更新包验收。
- 推送前仍须fetch、核对双方新进度/文件/接口、普通pull及受影响验证；不推main/强推，不改对方汇总或共享锁/构建。

## 上阶段认领（USB 真机阶段结果）

- **继续阶段（仅本机进行中）：** 用户明确本次先不检查远端，推送前再检查；沿42517be直接处理本端P2和剩余设备验收。认领 AuthorWorksScreen.tsx / PublicationWorkspace.tsx 的明确返回目标、对应本端组件夹具/诊断和本端复盘；使用既有Router栈回退能力，不改C1/auth、共享锁/构建或主开发进度。此例外仅覆盖本轮开始，不免除推送前fetch/核对/pull。
- **用户要求先推送阶段进度（2026-11-02）：** 本机构建1793f7f已完成并安装 vivo V2055A / Android14；APK SHA256 `72ab78e6f707aae12125bc1a3fb3ff0c13d131a0c108cc707f052cf0555d139d`，测试 v2 签名，双 ABI、内置 JS，未把同事电脑包当本机证据。581 Gradle任务执行，构建类型/lint通过；未改源码/依赖/构建配置。
- **已实际通过设备范围：** 合成 A 登录/明确恢复；本机独有稿件的离线暂存、后台及 force-stop 离线恢复，离线禁发布、重连显式同步；C1→C2入口与系统返回保留正文；R3固定预览后服务器工作稿R4不被改写；发布成功响应丢失后重开只GET确认V1（POST始终1）；手机作者隐藏/恢复/隐藏，真实匿名404/200/404且正式版本仍1。
- **本端新确定 P2：** 经发布进入管理后，“返回我的”首次退到重复作品管理页，再点才回账号页。源头为 C2 replace(my-works) 与 M1 canGoBack/back 组合；尚未修复。本端下一阶段维护 M1/C2 导航与回归/更新包复验，不跨到同事搜索/C1/auth/native/锁/构建范围。设备报告保留硬件END导致Android文本选择异常的单次现象，触控路径未复现，归属待核实，不当作已修。
- **尚未通过：** 中文/表情/长粘贴、切号/退出/真实401持久锁定及同账号恢复、设备冲突双方保留；P0设备门槛未关闭。准备了合成Unicode稿和B账号不等于已经执行通过。详见[阶段设备证据](../reviews/usb-creator-device-review.md)。用户要求先同步，暂停进一步设备操作后提交本端记录；主开发继续S2搜索，保留现有3300供后续验收。
- 本次推送前再次fetch核对 main0468470、本端远端be355a6，无新发布增量或源码重叠；未发布搜索进度仍未知。只改本端报告/进度，不改主开发汇总；普通pull main后推送独立分支，推送结果以本次包含记录的提交为准。

### 本轮起始认领与环境准备（历史）

- 用户明确 USB 已连接并要求下一步。本端从 a2905e8 快进到 origin/main@1793f7f，已读主开发最新进度/互审：已整合本端代码，710d04a 修复另存竞争，frontend moderate 审计已通过，2cfd6fb 为其最终 Mobile 包源码。无冲突，不延用旧“对方未修复/审计失败”状态。
- 已识别单个已授权 USB Android 14 / vivo V2055A，目标 me.takostory.app.test 未安装；本机 3300 API=test 可用。官方 SDK 元数据校验后在忽略目录安装 platform-tools 37.0.1，USB reverse仅本机3300。未采集其他 App UI/清除设备数据。
- 本机无现成 APK/Android 构建缓存，已在隔离 detached worktree 1793f7f 冻结源码，使用既有构建脚本准备本机包；不在打包期间改 Mobile，不修改主开发构建配置。最新86模型本机通过。
- 本轮范围：真机/本机隔离测试账号与 C1→C2→作者管理/返回的设备验证；必要工具及证据放本端独立路径/报告。保留密钥/数据，不操作 ECS、真实邮件或他人私稿；设备证据与模型/组件/构建分开记录。当前仅本机进行中。
- 推送前又观察/合入 main0468470：主开发独占 S1/S2 搜索，保持3300/sandbox供设备验收；新增 Mobile仅生成contract声明，运行源码与本次1793f7f冻结不变。已读其具体设备建议，本端确认继续USB验收，不接管搜索，也不替换3300服务。根契约一致性复验通过。

## 上阶段认领（已确认发布与现状读取失败）

- 本轮 fetch main仍0e1e60e，本端a814cf9；未见对方新发布进度，不视为无人进行工作。沿本端 C2 范围处理已确认发布被后续 GET 失败误报成未知的问题，不接管 C1 P2 或前端审计。
- 改动范围：本端 `PublicationWorkspace.tsx`、发布组件夹具/白名单及本端记录。区分发布/记录恢复失败与作品现状 GET 失败，保留原确认并只重试 GET；不改 flow/journal、C1/auth、API/锁/构建。
- 实际页面新回归在修复前 confirmed-state-read-retry 阶段失败，修复后通过。现状 GET 失败保留原发布确认，单独提示读取失败，重试不增加 publication 请求或 POST，成功后移除读取错误并显示真实状态。
- 本机类型/lint、85 模型、11 顺序真实服务、6 门禁、发布组件与 C1→实际 C2 路由均通过，零 skip/todo；其他组件本机未重复，由本轮远程完整覆盖。复盘见 `docs/reviews/publication-state-read-review.md`。主开发旧9653d74包不包含本轮UI改动，整合后由其冻结构建。
- 修复 2b2b952 已推送独立分支，推送前 fetch/核对/pull main 仍0e1e60e，无冲突。[Mobile](https://github.com/Xstly1014/Tako/actions/runs/41452848999) 四作业与 [Backend](https://github.com/Xstly1014/Tako/actions/runs/41452849363) success，含五套组件；[Frontend audit](https://github.com/Xstly1014/Tako/actions/runs/41452849138) 仍 failure。后续证据文档不改变该源码；本轮未合入 main/入包。收口再 fetch main无新增变化，对方未发布工作未知。

## 上阶段认领（同步 9653d74，C1-B/C 接入）

- 本端从 5f153c3 快进到 origin/main@9653d74，无冲突。主开发已合入本端发布恢复 P1 修复并接通 C1-B 编辑/列表与 C1-C 发布票据/返回。已读其进度、编辑与发布阶段记录、规格和独立 CLI，不拿旧 C1-A 审查覆盖新代码。
- 本轮认领：本端 `.github/workflows/mobile-checks.yml`、门禁行为检查/说明、独立审查及本端记录。将主开发提供的 `node scripts/check_mobile_drafts.cjs` 作为既有组件 job 的独立必跑步骤，不改其 CLI/路由夹具、C1/auth、锁文件或构建；独立复核新 Session 接口、发布门槛/票据消费和返回保留输入。
- 新模型/服务仍在既有分类文件中，现有分类无需改名。工作流已加入必跑的独立 C1 路由步骤；新增 CLI 失败/脱敏检查，本机 6 项门禁、85 项模型、11 项顺序真实服务、类型/lint/契约、actionlint、原四组件及 C1 路由均通过。新增路由远程证据待本轮真实运行；未发布工作仍未知。
- 独立审查见 `docs/reviews/cross-review-parallel-9653d74.md`：未确认新的 P0/P1，复现 P2“另存期间继续输入让旧保存任务打断副本切换”；原稿/副本/最新内存输入保留，显式重试可保存，不扩大为已丢稿。主开发在其范围回应/修复，本端不直接改其源码。
- 预推送再 fetch 看到 main=0e1e60e，仅构建/交接文档，无 mobile/src/tests/scripts/workflow 新差异；已普通合并到 eb29eee，原实现/审查提交 f5bfb34 保留，无冲突。已读最新主开发进度：其声明 9653d74 最终 APK，下一步负责 frontend 审计与集成；本端未独立验证其另一台电脑产物。
- 首次推送 303d657 的新 C1 CI step 失败，安全日志定位 EACCES：前四套 root 容器先建 .runtime 父目录，Linux runner 无权 mkdir C1 遮蔽子目录。已在首次容器前增加 runner 预建路径；Linux tmpfs/root 与 UID 1000 实验复现并验证修复，未用宽权限/跳过/原码重跑掩盖。详见 `docs/reviews/mobile-c1-ci-integration-review.md`。
- 修复 099c36d 的 [Mobile 四作业及新增 C1 step](https://github.com/Xstly1014/Tako/actions/runs/41447328547) 均 success，[Backend](https://github.com/Xstly1014/Tako/actions/runs/41447328549) success；[Frontend audit](https://github.com/Xstly1014/Tako/actions/runs/41447328596) 仍 failure。新 C1 路由 CI 尾项关闭；最后 fetch main仍0e1e60e、peer为本端099c36d，无新增工作可见，不推导同事空闲。
- 本轮待集成、尚未进 main；后续证据文档不改变被验 workflow/源码。P2 另存/输入竞争待主开发按独立报告修复、补回归后再复验；frontend 审计由其下一步维护，设备 P0 另行验收。本端不修改其进度或抢占范围。

## 上阶段认领（发布记录恢复失败）

- 本轮 fetch 核对远程 main 仍 42bc325，本端为 402a8aa；没有新发布提交，不推导同事空闲。继续本端独占的 C2 故障恢复，不接管 C1-B/C1-C。
- 发现并先写回归验证：旧成功页面恢复另一页面的新未知发布时，失败恢复可混合旧成功结果与新请求标识，使 reset 删除尚未确认的新 journal。认领 `mobile/src/publication/flow.ts`、`PublicationWorkspace.tsx`、既有发布模型/组件测试及本端阶段报告；不改 C1/auth、契约、锁或构建。
- 已确认本端 P1：新增回归修复前失败，旧 reset 确实删除了新未知记录。已修复恢复状态一起提交、失败时页面隐藏旧成功并禁止 reset，以及过期清理比较原请求；不改已确认业务权利。详情见 `docs/reviews/publication-recovery-isolation-review.md`。
- 本机已通过 69 项模型、10 项顺序真实服务、5 项门禁、类型/lint、契约和发布组件，零 skip/todo。修复 03f2d0b 已推送，推送前再次 fetch/核对/pull main 仍 42bc325，无冲突。
- [Mobile](https://github.com/Xstly1014/Tako/actions/runs/41433032243) 与 [Backend](https://github.com/Xstly1014/Tako/actions/runs/41433032280) success，四套组件由本轮远程覆盖；[Frontend audit](https://github.com/Xstly1014/Tako/actions/runs/41433032252) 仍 failure。公共 API 限额后改读公开运行页面确认最终结果，不套用旧绿灯。后续证据文档提交不改变该源码；尚未进 main/包。待主开发集成本轮 C2 保护并继续 C1-B/C1-C，本端不改变其调用接口。

## 上阶段认领（同步 42bc325）

- 本端已从 badb293 快进到 `origin/main@42bc325`，主开发已整合上一轮诊断/审查，并发布 C1-A 会话绑定授权（33c15b2）和双实例旧读修复（1fbc874）。已读当前 primary-progress 与 mobile-draft-access-review；无冲突。主开发继续 C1-B/C1-C，不接管本端 M1/C2。
- 本轮本端认领：独立复核已发布授权/并发修复及既有消费兼容；报告绑定新 SHA。维护本端作者管理/发布组件夹具，使其使用真实 createDraftSessionVault 模型，验证 confirmation 不阻断既有服务器业务、offline 草稿许可不能放行发布、原发布记录在线后才能恢复。精确改动限于 `scripts/mobile-author-works-ui/context.jsx`、两套自有 run.cjs 和本端测试/报告；不改 C1/auth、依赖锁、构建或主开发汇总。
- 新测试仍在已分类文件，无需为数量变化重写分类。独立复核报告 `docs/reviews/cross-review-parallel-42bc325.md` 已确认原 P2 修复；隔离工作树另验证晚到确认写入/401/删凭据失败的落盘顺序。本轮没有新的 P0/P1 发现；不冒充未来 C1 页面或设备审查。
- 本端夹具已改用新会话 envelope 模型。作者管理/发布验证 confirmation 期间服务器业务兼容、离线草稿许可隐藏私密视图且零业务 HTTP、联网只读恢复及切号。实际通过类型/lint、契约、67 项模型、10 项顺序真实服务、5 项门禁与四套组件，零 skip/todo。
- 本轮 `73bdd19` 已推送，推送前 fetch/核对/pull main 仍 42bc325，无冲突。[Mobile 四作业](https://github.com/Xstly1014/Tako/actions/runs/41431219962) 与 [Backend](https://github.com/Xstly1014/Tako/actions/runs/41431220010) success；[Frontend audit](https://github.com/Xstly1014/Tako/actions/runs/41431220172) failure。后续证据文档提交不改变该源码；未合入 main，未入包。待主开发继续 C1-B/C1-C 后更新必要分类和实际调用栈整合，未发布工作仍未知。

## 上阶段认领（同步 59694d6）

- 用户要求同步同事最新进度并按协作模式推进本端任务。本端从 c905d7a 快进到 `origin/main@59694d6`，工作区原先干净，无冲突；主开发已经整合本端 CI/M1/C2，双方已共享同一代码基线。已读该 ref 的主开发进度、交叉审查和 C1 授权规格；主开发接受 c1-c2-interface 的调用条件。
- 本轮认领：只读审查 C1 核心 `de49a17` 及 `docs/mobile-draft-access-spec.md`，独立报告写到 `docs/reviews/cross-review-parallel-de49a17.md`；维护本端 `scripts/check_mobile_tests.cjs`、`scripts/check_mobile_components.cjs`、对应门禁验证与说明，回应对方审查中瞬时失败难定位的问题。诊断只输出安全状态/阶段，不透出原始断言、正文、凭据或响应。
- 主开发继续独占 C1 access/native、auth/session/context、草稿列表/编辑页、共享依赖/构建及项目汇总。本端不接管这些文件；维持 M1/C2 消费契约，不增加新业务。对方尚未发布的授权实现仍未知。
- 本轮实现/审查 `a0d4cea` 已推送独立分支，尚未进入 main；推送前 fetch/核对/pull main 仍 59694d6，无冲突。C1 报告确认 P2：不同同步器实例可基于旧读取创建多余恢复副本，原文/新文仍保留；由主开发在其范围回应，未直接改 C1。13 项 de49a17 仓储/同步原测试通过，双实例闸门实验确定复现；无 P0/P1 发现。
- 门禁新增安全阶段、状态和已分类测试行列诊断；5 项失败行为/脱敏测试、53 项模型、10 项顺序真实服务、契约一致性与四套组件通过，零 skip/todo。没有复现对方瞬时失败根因，不把诊断改进当作修复随机失败。阶段记录见 `docs/reviews/mobile-ci-diagnostics-review.md`。
- a0d4cea 的 [Mobile 四作业](https://github.com/Xstly1014/Tako/actions/runs/41428997743) 和 [Backend](https://github.com/Xstly1014/Tako/actions/runs/41428997687) success；[Frontend audit](https://github.com/Xstly1014/Tako/actions/runs/41428997693) 仍 failure，未改共享锁。后续只补证据的文档提交不改变被验源码。
- 下一步：待主开发发布 C1-A 测试/接口后更新本端分类、复核 Session 消费与发布入口；C1 并发发现待其回应/修复 SHA 再复验。没有新提交不等于对方无进行中工作，本端不自行接管。

## 上阶段基线

- 本端业务提交：C2 `dc9e672`，验证记录 `78f4c57`；此前 M1、CI 已在本端分支发布，未合入 main。
- 本次 fetch 观察到远程 main `de49a17`，已合入本端 `codex/mobile-publication`（集成检查点 `b73fbe4`）。已读该提交的 `primary-progress.md` 与 C1.1 复盘。
- 对方已发布 C1.1 加密仓储/同步及 SQLite 依赖，尚未接 App 草稿页/离线授权保护；下一步认领 auth 绑定与 C1 页面。本端不知道其未推送工作的实时状态。

## 上阶段认领与共享边界

- 用户已分配本端 M1 作者作品管理，并要求按规划继续 C2 发布；用户另明确授权本次编写双端协作技能。
- 上阶段技能与 CI 已发布至 `1627347`。本轮按主开发转交提示只做分支集成适配与验证：本端 `mobile/src/api/publications.ts`、`mobile/src/app/publish.tsx`、`mobile/src/publication/PublicationWorkspace.tsx`、发布测试/组件夹具及本端独立交接/复盘。没有修改 C1 业务源码、auth、依赖锁、App 配置或共享入口账本。
- 业务范围继续为本端作者管理、发布与 CI；实现和证据索引见 `parallel-ci-results.md`。C1 存储/同步/编辑由同事维护；其 auth/账号页改动需保留本端 M1 顶部作品入口。本端不另建草稿编辑器。
- C1/C2 完整入口、返回、旧修订与原发布恢复规则见 [接口约定](c1-c2-interface.md)。本端已拒绝缺少修订的入口并明确恢复优先级；调用点尚待同事接入，未声称已经确认或完成。

## 上阶段状态与门槛

- M1/C2 本端原提交的 Mobile/Backend CI 已通过；新 main 集成提交 `df4a5fb` 的 [Mobile](https://github.com/Xstly1014/Tako/actions/runs/41407759602) 四个作业与 [Backend](https://github.com/Xstly1014/Tako/actions/runs/41407759570) 也全部 success，不借用旧绿灯。
- 本轮适配 `f041ef5` 已推送独立分支，推送前 fetch/核对/pull main 仍 de49a17，无冲突。[Mobile](https://github.com/Xstly1014/Tako/actions/runs/41410502057) 四作业与 [Backend](https://github.com/Xstly1014/Tako/actions/runs/41410501956) 全部 success；[Frontend 审计](https://github.com/Xstly1014/Tako/actions/runs/41410502037) 仍失败，未自行改锁。后续证据文档提交不改变被验源码。
- 本轮本机类型/lint、契约一致性、53 项模型、10 项顺序真实服务、3 项门禁与四套组件通过，零 skip/todo。SQLite 的两平台支持亦由本轮远程实跑确认，不用跳过解决运行条件；没有重跑 APK 或设备检查。
- 待对方互审本端 M1/C2 与 C1→C2 交接；对方未确认前记录为待审，不把本端自查算独立审查。技能行为测试也不算对方代码审查。
- 技能阶段已收口，快照助手五项行为测试通过，见 `docs/reviews/tako-collab-skill-review.md`；本轮集成自查见 `docs/reviews/c1-c2-integration-review.md`。P1：主开发按约定接入 C1→C2 调用点，尤其检查 recovered 仍 dirty 的情况；后续互审及整合业务分支后冻结源码构建。
- P0，真实移动作者前：C1 存储/锁定、C2 标识恢复、输入/返回/生命周期真机验收；现有工程证据不能关闭设备门槛。
