# C1/C2 分支集成适配复盘

2026-11-02。范围由用户转交的主开发提示词确定：先集成与验证，暂停新业务。主开发被核对提交 `de49a17`，本端开始时 `1627347`，共同集成点 `b73fbe4`。这是本端集成自查及 C1 调用语义复核，不充作另一端对本端的独立审查。

## 规格与实现核对

- C1.1 原文件保留；`origin/main` 已在 `b73fbe4` 合入，无需重复合并。CI 分类在 `df4a5fb` 纳入 drafts-storage/drafts-sync 模型与 drafts-service 真实服务；helpers/drafts.ts 只作为辅助模块。
- 确定的本端缺陷：`1627347` 的 `mobile/src/app/publish.tsx` 允许 draft_id 不带 source_revision，随后 Workspace 用服务器当前修订兜底。触发不完整的编辑页交接会改变用户原来选定的修订。现改为完整对严格验证；无参数才进入选择器。新增模型拒绝含糊输入，实际路由夹具证明缺修订时零读稿/零准备/零发布。
- 原记录恢复本来已优先于新入口，本轮增加显式提示并验证传入另一稿件仍只恢复原结果，不读取新稿、不新增预览或发布。旧修订保留、未确认修订拒绝与返回零写入一并纳入真实组件夹具。
- C1 `sync.ts` 的 recovered 分支可能仍 dirty=true，这是保留较新编辑的合理行为，不能被未来调用方误读为“当前文字全部已同步”。[接口约定](../handoff/c1-c2-interface.md) 明确调用条件与主开发待接入项；未修改同步器或抢做编辑页。

## 实际验证

- Node 24.19.0，Windows：typecheck、lint、OpenAPI 生成语法一致性通过；53 项模型（包含 Node 内置 SQLite/WebCrypto）、3 项门禁全部通过，零 skip/todo。
- 同一真实回环 API/MySQL 环境顺序执行 10 项服务组通过，零 skip/todo。服务组 runner 保留 --test-concurrency=1；本轮未遇认证限频，未清计数或放宽保护。
- Linux Docker 断网四套真实产品组件夹具（评论、版本、作者管理、发布）全部通过。发布夹具为路由/组件与模拟 HTTP/存储，不冒充真实服务或原生存储。
- 本轮适配提交 `f041ef5` 的 [Mobile](https://github.com/Xstly1014/Tako/actions/runs/41410502057) 四个作业全部 success，含 Windows/Linux 实际 Node SQLite 模型、组件和真实 MySQL/API；[Backend](https://github.com/Xstly1014/Tako/actions/runs/41410501956) success。推送前 fetch、核对双方进度并 pull main（仍 de49a17），无冲突。后续证据文档提交不改变已验源码。
- [Frontend](https://github.com/Xstly1014/Tako/actions/runs/41410502037) 在既有 npm audit --audit-level=moderate 步骤 failure；不是全仓库绿灯。保留基线证据与修复门槛，未改依赖锁。

## 边界与退出条件

- P1：主开发接入 C1 编辑页时遵守接口约定，集成后复验发布入口、返回、冲突恢复后的新 draft_id 和同账号恢复。调用点尚未实现，不能宣布手机写稿发布闭环。
- P0：真实移动作者交付前验证系统安全存储、杀进程、切号、输入与系统返回；本轮按约定不构建包或做设备/ECS 工作。
- P1：既有 frontend moderate 审计失败保留历史可复核证据及明确修复门槛，不自行修改共享锁文件。移动 CI 绿灯不代表全仓库检查通过。
- 无文本合并冲突；语义适配集中于本端发布页。双方发布分支仍需主开发明确集成，未直接推 main、未强推、未修改主开发进度。
