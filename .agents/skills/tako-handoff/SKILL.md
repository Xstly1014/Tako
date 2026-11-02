---
name: tako-handoff
description: Prepare or consume Tako's engineering handoff across computers or Codex conversations, reconciling current code, business decisions, evidence and parallel work boundaries. Use for project onboarding and handoff, not merely restarting local services.
---

# Tako 工作交接

以本技能所在目录向上三级定位仓库根目录，不硬编码原电脑路径。

先读根 `AGENTS.md`、`.agents/skills/business-first/SKILL.md` 和 [交接入口](../../../docs/handoff/README.md)，再按入口阅读产品状态、工程启动、并行边界和接手提示。涉及 UI/App 时补读对应技能和 `mobile/AGENTS.md`。

识别本次是“整理交给别人”还是“在新会话接手”；从用户请求判断，确有歧义才询问。

- **整理交出**：核对 Git 状态/最近提交、实际代码、当前规格及最新阶段复盘，更新 `docs/handoff/`。区分已实现、自动化验证、真机/外部服务验收和未完成约束；给出下一条业务链路及前置条件。把建议并行任务的文件范围、未认领状态与冲突点写清楚，不替用户启动第二个代理。
- **新会话接手**：先报告当前业务与证据、未决事项和准备修改的文件范围。检查本机配置是否存在；需要启动时复用 [重启文档](../../../docs/restart/README.md)。全新电脑采用交接 02 的首次初始化流程，不能把原机“重启”当作新机安装。不自动复制生产数据或原机密钥。

本机测试入口 3300；旧 3000 保留数据但不启动，ECS 用户已停，手机当前无 USB 条件。以最新代码和记录核实这些状态，不能用聊天记忆或旧快照冒充当前证据。

技能调用不授权推送、部署、向其他聊天发消息或创建新代理；按用户已有授权范围执行。交接不应凭空增加功能规格。发现业务权利、数据丢失或跨账号行为未定时与用户 argue，常规工程细节自主处理。
