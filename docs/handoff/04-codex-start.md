# 04 · 给新电脑 Codex 的第一条消息

下面整段可直接复制。请先拉取本批最新提交；不要把旧聊天中的阶段状态当成最新事实。

> 你正在协作开发 Tako，一个年轻多元的文字社区。请先阅读根 AGENTS.md、.agents/skills/business-first/SKILL.md、.agents/skills/ui-deai/SKILL.md、mobile/AGENTS.md，以及 docs/handoff/README.md 和其余三份文档。当前以独立 Android App 为核心；Go/MySQL/Nuxt Web 已有账号、草稿、发布、版本、人工治理、发现、收藏与两级评论，App 新接入账号/收藏，新包设备验收尚未完成。不要把 Web/API 能力记成 App 已交付，不重做用户认可原型，不连接已停机 ECS。
>
> 建议你承担 docs/handoff/03-parallel-work.md 中的移动端 CI 与干净电脑可复现性任务。先从最新 main 创建 codex/mobile-ci-portability，并在本机建立独立 3300 合成测试环境；先核对文档与仓库现状，报告打算修改的文件，再开始独占范围内的工作。当前主开发继续负责 mobile/src、App 账号/收藏验收和后续评论规格。你先不修改这些共享文件、依赖锁、OpenAPI 或业务权利；需要改动时提出最小方案与主开发/用户协商。
>
> 你负责的建议文件为新的 .github/workflows/mobile-checks.yml、scripts/check_mobile_contract.*、docs/handoff/parallel-ci-results.md。优先让类型/lint、契约类型一致性、纯模型与真实服务测试有明确边界，不依赖原电脑路径、密码或隐藏缓存。先跑通自己的干净环境再记录结果，缺 MySQL/3300 时不能把 skip 当通过。
>
> 凭据不要发到聊天或日志，不提交 .env/.runtime/SDK/APK/数据库；不发送真实邮件、不操作云端。Git 提交及推送按我在这个新会话给你的授权执行，不强制推 main。模糊业务权利、跨账号或数据丢失风险与我讨论，常规实现自主推进。完成一个纵向链路后记录证据层级与尾项，再与主开发协调合并。

如果用户在新会话指定了别的任务，以该任务为准，先协调共享文件归属；这段提示不是覆盖用户后续指令的长期锁定。
