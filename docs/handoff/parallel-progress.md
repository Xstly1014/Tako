# 并行端工作进度

更新时间：2026-11-02（Asia/Shanghai）。维护方：本会话并行开发端；另一端维护 `primary-progress.md`。本文件随本阶段提交发布，以包含它的提交为准；对方是否已读或确认仍未知。

## 当前阶段认领（同步 9653d74，C1-B/C 接入）

- 本端从 5f153c3 快进到 origin/main@9653d74，无冲突。主开发已合入本端发布恢复 P1 修复并接通 C1-B 编辑/列表与 C1-C 发布票据/返回。已读其进度、编辑与发布阶段记录、规格和独立 CLI，不拿旧 C1-A 审查覆盖新代码。
- 本轮认领：本端 `.github/workflows/mobile-checks.yml`、门禁行为检查/说明、独立审查及本端记录。将主开发提供的 `node scripts/check_mobile_drafts.cjs` 作为既有组件 job 的独立必跑步骤，不改其 CLI/路由夹具、C1/auth、锁文件或构建；独立复核新 Session 接口、发布门槛/票据消费和返回保留输入。
- 新模型/服务仍在既有分类文件中，现有分类无需改名。工作流已加入必跑的独立 C1 路由步骤；新增 CLI 失败/脱敏检查，本机 6 项门禁、85 项模型、11 项顺序真实服务、类型/lint/契约、actionlint、原四组件及 C1 路由均通过。新增路由远程证据待本轮真实运行；未发布工作仍未知。
- 独立审查见 `docs/reviews/cross-review-parallel-9653d74.md`：未确认新的 P0/P1，复现 P2“另存期间继续输入让旧保存任务打断副本切换”；原稿/副本/最新内存输入保留，显式重试可保存，不扩大为已丢稿。主开发在其范围回应/修复，本端不直接改其源码。
- 预推送再 fetch 看到 main=0e1e60e，仅构建/交接文档，无 mobile/src/tests/scripts/workflow 新差异；已普通合并到 eb29eee，原实现/审查提交 f5bfb34 保留，无冲突。已读最新主开发进度：其声明 9653d74 最终 APK，下一步负责 frontend 审计与集成；本端未独立验证其另一台电脑产物。

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
