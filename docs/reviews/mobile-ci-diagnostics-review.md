# 移动门禁失败诊断阶段复盘

2026-11-02。起点 `59694d6`，本端分支 `codex/mobile-publication`。主开发已整合本端全部业务并接受 C1/C2 接口；用户要求同步后各自继续，主开发继续 C1 授权/页面，本端按其交叉审查请求维护工程门禁并审查已发布核心。没有开启新业务。

## 问题与实现

主开发在 c905d7a 独立复验时首次遇到 service 预检退出和 publication 组件失败，原码重跑通过；原 wrapper 抑制全部原始输出保护私稿，但不足以定位阶段。本轮新增固定字段投影，不把未知失败自动判为可重试，也不转发敏感详情：

- 服务预检给出 connect/environment/community-json/seed、固定连接原因、HTTP 状态和 test/not_test；拒绝非 JSON、空/错误种子形状，失败前不启动业务测试。
- 测试进程失败给出退出/超时/缺执行器等固定原因，最多八个已分类文件的行列，丢弃原始目录、测试名称、堆栈及断言值。
- 组件 wrapper 保留 fixture 名和原有白名单阶段；未知阶段 unavailable，保留非零/超时等安全原因。原产品组件、既有夹具、认证/限频、依赖锁、工作流配置不变。
- 原无服务拒绝、test 环境保护、分类完整、零 skip/todo、串行真实服务、断网组件门禁均保留。没有自动重试、清计数或跳过。

## 实际验证

- 本机 Node 24.19.0/Windows：5 项门禁行为测试通过，零 skip/todo；包括真实子 CLI 的预检故障、断言/名称/路径哨兵脱敏、已知/未知组件阶段、缺 Docker 和超时的注入验证。注入测试不依赖或冒充真实 Docker/API。
- 生产入口正常回归：契约一致性、53 项模型、10 项顺序真实 MySQL/API 服务组、四套 Linux Docker 断网组件均通过；零 skip/todo。本轮没有修改 App 源码，未在本机重复类型/lint或 APK/设备检查；远程执行结果另绑定提交记录。
- C1 独立审查在隔离 de49a17 worktree 运行 13 项仓储/同步模型并复现两个同步器产生多余恢复副本的 P2 边界，见 `cross-review-parallel-de49a17.md`。没有写回或接管 C1。
- 实现提交 a0d4cea 的 [Mobile](https://github.com/Xstly1014/Tako/actions/runs/41428997743) 四作业全部 success，含 Windows/Linux 类型/lint/契约/门禁/模型及 Linux 真实 API/组件；[Backend](https://github.com/Xstly1014/Tako/actions/runs/41428997687) success。[Frontend](https://github.com/Xstly1014/Tako/actions/runs/41428997693) 仍失败在 moderate audit。后续证据文档提交不改变该源码；没有套用其他 SHA 的绿灯。

## 未完成项与退出条件

- P2：主开发首轮瞬时失败根因未复现，不能写作已修复。若再失败，收集新增安全诊断、被验 SHA 和检查层级，按证据处理；不能反复重跑替代根因分析。阶段白名单新增/改名需由本端随夹具维护，避免退回 unavailable。
- P2：C1 双实例同步边界由主开发修复或在调用架构中排除，并以确定顺序的回归证明只有一份服务稿；本端报告等待作者回应。
- P1：新增 C1 授权/页面测试发布后，本端更新分类和整合验证；未发布的工作不可见，不认定对方空闲。
- 既有 frontend moderate 审计 P1、真实移动作者前原生存储/返回/生命周期 P0 仍保持原退出条件；本轮不改共享锁、不推进 ECS 或设备验收。
