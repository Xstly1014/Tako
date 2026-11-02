# Tako 开发交接入口

更新于 2026-11-02。当前优先独立 Android App；先读本页与双方进度，再读相关规格。历史阶段记录保留在 docs/reviews，旧包、旧测试数量与旧“未接入”措辞不覆盖下面的当前状态。

## 当前已做到哪里

S2搜索已接入App源码（ce1670a），18读者/服务组、86模型、五套页面及独立真实HTTP初验通过；本机3300已升级到搜索API，用户确认同事在其独立电脑验收。按用户新分工，本端不再承担打包/设备任务；每次推送交接见 [设备任务队列](device-requests.md)，当前搜索设备结果待同事记录。不要用旧1793f7f包验新搜索。详见 [App搜索复盘](../reviews/mobile-search-app-review.md)。


此前新增 [S1搜索API](../reviews/public-search-api-review.md)，用户确认标题/笔名/简介；服务端/契约/失败验证已实现，1b89018三条远程CI已通过，此为S1历史阶段；S2现已接入源码，本机3300已升级，同事独立环境由其协调升级。业务盘点见 [中篇闭环后的下一步](../reviews/business-inventory-after-c1.md)。

中篇私稿→加密本机暂存/离线续写→服务器确认修订→固定预览→正式发布→读者阅读/收藏/两级评论→作者修订/管理，已接入同一工程。C1 列表/编辑与 C2 发布不是待开发空白。

| 项目 | 当前证据与边界 |
|---|---|
| App 源码 | 已合入双方 C1/M1/C2与S2搜索ce1670a；旧2cfd6fb包不含搜索，下一包由并行端冻结构建 |
| 自动化 | 86 模型、18读者/服务组（含搜索客户端/协调）及五套页面通过，新搜索客户端另有真实HTTP/MySQL验证；原生存储/导航仍分设备证据 |
| Web 依赖 | 原中危审计门禁本机及 4c63ad0 远程 Frontend CI 通过；12 原测试+2真实依赖兼容、生产构建与9浏览器回归通过，仍有7 low链报告 |
| 远程与包 | 旧包与旧CI分别绑定旧源码；S2最新结果见[搜索复盘](../reviews/mobile-search-app-review.md)。历史结果见 [整合复验](../reviews/cross-review-primary-a2905e8.md)，以其最终 SHA/指纹为准；构建成功不等于设备验收 |
| 原生体验 | 用户告知同事已有 USB 条件，尚无其本轮发布的验收结果；未确认新包的输入/粘贴、后台/杀进程、切网、安全存储和发布返回；P0 在真实移动作者使用前补齐 |
| 真实结果 | 无新增真实用户留存、创作或治理成效声明；合成规模和测试成功不代替运营样本 |

详细过程：[C1 编辑](../reviews/mobile-draft-editor-review.md)、[发布交接](../reviews/mobile-draft-publication-review.md)、[另存竞争](../reviews/mobile-draft-copy-concurrency-review.md)、[本端互审与整合](../reviews/cross-review-primary-a2905e8.md)、[Web 依赖审计](../reviews/frontend-dependency-audit-review.md)。

## 两端如何继续

持续协作用 `$tako-collab`。实际进度分别是 [主开发](primary-progress.md) 与 [并行端](parallel-progress.md)，读远程实际分支的版本；文件发布不等于对方已读/确认。每次推送前 fetch、核对新增工作/接口/重叠，普通合并和推送，禁止覆盖并行工作。

- 主开发：C1/auth、S搜索、共享锁/构建、最终集成与汇总；本轮修复 710d04a 待同事独立复验，不替其修改报告或宣称已认可。
- 并行端：CI/M1/C2 及其测试/进度；主开发已集成 a2905e8。原“待接 C1 路由 CI”已由其完成，不要重复建设。
- 暂不扩 B3.2、付费、推荐、短帖/长文或生产部署；先按工程/设备/真实结果分账收口中篇闭环。新增业务先核对规格与用户已确认权利。

## 按需阅读

1. [项目与业务状态](01-product-and-status.md)：背景、已确认权利与交付边界。
2. [工程与本机启动](02-engineering-and-setup.md)：新电脑创建自己的合成环境。
3. [并行边界](03-parallel-work.md)：当前具体认领优先于历史建议表。
4. [接手提示](04-codex-start.md)：可复制给另一台 Codex。
5. [C1/C2 接口约定](c1-c2-interface.md)：只传已确认服务器 ID/修订，不传内存正文、不修改工作稿。

根 AGENTS.md、business-first 必读；移动端另读 mobile/AGENTS.md，UI 改动读 ui-deai。技能不能取代用户授权或扩大业务范围。

## 服务恢复与不随 Git 交付的内容

纯本机服务恢复用 `$tako-restart`，见 [重启手册](../restart/README.md)；跨电脑接手用 `$tako-handoff`。本机仅 3300 合成测试环境；ECS 已停，本轮不连接、不启动。没有 USB 时不反复要求用户做手机测试。

.env、数据库、SSH 私钥、OSS/邮件密钥、APK、SDK 和密码不提交。新电脑自行创建隔离合成库，不复制真实用户数据；保留原机数据卷、.runtime 与 backups。个人测试包使用模板 debug 签名，不是商店正式包。

剩余约束必须按 [本轮复验](../reviews/cross-review-primary-a2905e8.md)、[依赖审计](../reviews/frontend-dependency-audit-review.md) 的优先级和退出条件处理；不能仅写成“已知限制”后永久搁置。
