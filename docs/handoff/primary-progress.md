# 主开发工作进度

> 本轮进行中：已观察并行端 a814cf9，接受其 9653d74 另存竞争 P2；本机修复及确定顺序模型/页面回归通过。接续集成其 C1 CI 接入并处理本端 frontend 审计，不开展新业务。旧 APK 不覆盖本次修复，详见 mobile-draft-copy-concurrency-review.md。

> 最新收口：C1-C 已完成工程接线，Mobile 冻结 9653d74，整合 APK 构建/签名/路由与校验标识检查通过；85 模型、11 服务、新 C1→C2 页面和四套旧夹具通过。当前源码远程 Mobile/Backend success，Frontend audit failure。详见 mobile-draft-publication-review.md；此前“C1-C 待接”和旧包指纹是历史阶段。


> 最新收口：C1-B 已交付源码及整合 APK，Mobile 冻结 b2cea9d。78 模型、11 服务、新路由/四套原夹具与门禁通过；该源码远程 Mobile/Backend success，Frontend audit failure。包 SHA-256、设备与 C1-C 尾项见 mobile-draft-editor-review.md。以下保留阶段过程，旧冻结 SHA 和“构建中”不作为最终产物。


更新时间：2026-11-02（Asia/Shanghai）。主开发维护，分支 main。实现以包含本记录的提交为准；不将已推送推导为对方已读或认可。

## 已观察与本轮集成

- 上轮已将 CI/M1/C2 整合并推至 main 59694d6。原 de49a17 单轮免检查例外已结束，每次推送均检查 main 与对方实际功能分支。
- 本轮 7897 代理 fetch 观察 main=59694d6，对方 mobile-publication 从 c905d7a 前进至 a0d4cea；已读该 ref 的 parallel-progress、独立 C1 审查和 CI 诊断实现。
- 本端 C1-A 检查点 33c15b2 与对方 a0d4cea 已普通合并，双方历史保留；对方新增仅诊断/测试/报告，与本端源码无文本重叠。原报告不由本端修改。

## 当前交付与认领

主开发继续独占 C1 access/authorized/native、auth/session/context、草稿列表/编辑及其测试；本轮额外在自身 drafts/sync.ts 修复对方发现的确定 P2。未改对方 CI/M1/C2 源码；其门禁变化通过合并取得，个人中心 M1 作品入口未动，未改后端契约、依赖或锁文件。

C1-A 已完成会话层与原生安全存储接线：令牌与本机许可同项绑定，旧字符串令牌可联网恢复；新登录先确认，已确认同会话可离线读取授权门面。退出先落盘锁定再请求注销；网络失败保留会话供重试但草稿锁定；401 与持久化失败不假报完成。详见 mobile-draft-access-review.md。

Session 加法接口为 snapshot.drafts 与 confirmDraftAccess；既有 phase/account/generation/authorized 保留，普通 Vault 无 drafts 扩展仍兼容。真正页面只应使用 nativeAuthorizedDrafts，不传 owner 直接打开原生仓储。原始 native 仓储工厂已改为模块内部。

## 对互审的回应

已接受 cross-review-parallel-de49a17.md 的 P2：不同同步器能基于旧读取生成多余恢复副本。现已在事务内重查 dirty/serverId/baseRevision，旧读取失效时不创建 pending，返回 saved 或 pending；两个 Promise 闸门反例通过，原请求、真正冲突和恢复后新输入均继续通过。对方需基于新提交重新复核，不能把旧报告当作已审新代码。

对方已读取上一轮接口约定与主开发审查，并按其进度独立维护 CI 诊断；这有实际记录支持。新授权源码仍待对方读取和审查，尚不宣称获得认可。

## 实际证据与剩余门槛

- 当前整合树：67 项模型、10 项真实服务、类型/lint、契约一致性、5 项门禁失败/脱敏测试以及四套既有组件均通过，零 skip/todo。
- 真实 HTTP/MySQL + 本机 SQLite/WebCrypto 验证已使用新 Vault/授权门面；安全项用可控适配器。无新增 APK、设备、ECS 或外部邮件验收。远程 CI 以实际运行状态为准。
- 物理存储拒绝所有写入/删除时，只能当前进程拒绝访问并报错，不能声称锁定事件已跨断电保存；需存储恢复后完成锁定/注销或在线复验。
- P1 下一步 C1-B：恢复确认页、服务器与本机草稿列表/编辑、保存反馈、退出未同步提醒；随后 C1-C 严格按 c1-c2-interface 接发布与返回。二者未实现，不能说 App 创作闭环完成。
- P0 真实作者使用前：整合包验证原生安全项/SQLite、输入/返回/生命周期与切号失效；USB 条件未恢复，不重复要求用户连接，也不以工程测试代替。

## 给并行端的下一步请求

请继续维护 CI/M1/C2，并独立复核本轮授权与双实例修复：持久绑定、退出/401 落盘失败、旧异步结果、无 owner 门面及既有消费者兼容。报告绑定新源码 SHA；不要接管 C1/auth，不另写编辑器。主开发继续 C1-B/C；账号页只触及 logout/草稿入口且保留 M1，依赖/构建/汇总仍由主开发集成。该请求随本提交发布，收到与认领尚待对方实际确认。


## C1-B 开始（本机进行中）

基线 main 42bc325；本轮 fetch 对方 mobile-publication 仍 badb293，已读其对应进度。主开发继续原认领：drafts 编辑/列表模型与 screens、app/drafts 路由、auth 离线重验、小范围 account 草稿入口/退出提醒、PrototypeUi 加号中篇入口和对应独立测试夹具。不改对方 M1/C2/CI；新增用例先置于本端已有分类文件。自动同步只在前台且有待同步稿时尝试，使用现有 /me 校验会话，不新增基础服务或后台任务。


## C1-B 实现检查点（随本轮提交发布）

本机已完成草稿箱/编辑/恢复、串行暂存/自动尝试同步、本机竞争另存、原型双入口和退出提醒。新接口为 Session.reconnectDrafts 与 pendingDraftCount；第三个可选构造参数仅注入受保护数量读取，既有消费者不需要引用 SQLite。原 account 的 M1 作品入口保留，未改 publication/**。

76 项模型、新 C1 实际路由夹具已通过；新增真实编辑器用例整组 11 项；收口须核对最终类型/lint、真实服务、四套既有夹具及包。详情 docs/reviews/mobile-draft-editor-review.md。没有未分类 .test.ts，新 C1 组件入口为 scripts/check_mobile_drafts.cjs，尚未改并行端 CI；请对方认领接入此门禁并独立审查新 Session 接口/编辑页，再提供结果。

本轮再 fetch 观察对方 mobile-publication=402a8aa，已读其 42bc325 授权/并发复核与 73bdd19 夹具改动：对方独立关闭了旧重复恢复副本 P2，未发现新的 P0/P1；这是旧源码的审查，不当作已审本轮编辑器。其代码仅自有夹具/报告，与本端无源码重叠，将按常规合并后回归。C1-C 仍由主开发下一步接线，不接管对方 C2。


### C1-B 收口验证与协作请求

对方 402a8aa 已合并，当前冻结构建源码为 cc9bd4a（含 f11e9e2 实现、772ffca 整合及半屏面板修正）；Mobile 文件在构建期间不改。76 模型、11 真实服务、新草稿实际路由、四套既有夹具、类型/lint、契约与 5 项门禁通过；Android 包结果与指纹待本轮完成后记录。未连接 USB/ECS。原四按钮 Alert 不适合 Android，已停止前次构建并改为半屏三选一，不以停止构建算成功。

给并行端的具体请求：把独立 scripts/check_mobile_drafts.cjs 纳入其 CI 组件门禁，沿用失败脱敏，不修改本端草稿实现；复核本轮 reconnectDrafts/pendingDraftCount 的加法接口与新页面身份/返回条件。本端已有模型/服务新用例均在既有分类文件中，不需要创建新 .test.ts 分类；路由夹具的远程执行尚待对方实际接入确认。下一步主开发 C1-C，不抢占其 publication 状态机。


### C2 新修复纳入本阶段

预推送快照发现 peer=5f153c3，已读其 flow/Workspace 修复与 publication-recovery-isolation-review，接受确定 P1，合并到 fcf5499。新增两项发布回归后整合模型为 78；独立发布组件和新 C1 实际路由通过。主动停止 cc9bd4a 构建，当前 Mobile 冻结为 fcf5499 再构建，旧两次停止均不记成功。新发布代码未改 C1/C2 调用参数约定。


自动重试收尾修正：元数据 record 对象变化不应重置 1.2 秒输入防抖，改用稳定 needsSync；新增 C1 路由请求计数断言。fcf5499 构建主动停止，最终源码/包以编辑复盘最后记录为准。停止均非 Gradle 随机失败，不套用成功。


最终 APK 通过，60,018,886 字节，SHA-256 `24e4882f9f190f50d9fad513f415e765353200f378a1edb62395f87e65b19873`；标准构建 6m04s、签名和路由/两 ABI SQLite 检查通过，Mobile 运行源码/配置差异为空（README 文档更新除外）。未安装、未操作手机或 ECS。b2cea9d 远程 Mobile/Backend 成功，Frontend 失败步骤仍 audit moderate。新 C1 路由脚本的 CI 接入和本轮独立审查请求等待对方实际同步，不推导为已收到。下一步主开发按既有 c1-c2-interface 接发布与返回；这次仅私稿编辑工程阶段收口，不称真实作者闭环已验收。


## C1-C 开始（本轮本机进行中）

基线 main 47510be；本次代理 fetch 后对方 mobile-publication 仍 5f153c3，已读对应进度。按既有分工，只改本端 drafts/workspace.ts、DraftEditorScreen、C1 测试/路由夹具与交接。沿 c1-c2-interface 增加只读、实际点击时复验的发布票据；不自动同步/发布，不传正文/owner，不改变 C2 journal 或状态机。返回只核对身份及服务器元数据，不覆盖输入或提升本机 baseRevision。新测试继续放既有分类文件，新 C1 夹具 CI 接入仍待并行端回应。


### C1-C 本端实现与移交（随提交发布）

新增 DraftEditor.preparePublication/publicationPath/resume；只改本端 workspace、EditorScreen、C1 测试和 scripts/mobile-drafts-ui 夹具/CLI，不改对方 C2/CI。票据绑定当前输入/seq/代次且消费一次；HTTP 只读复验，返回不覆写，返回本机读取晚于新保存时不回滚。当前 85 模型、11 真实服务、新 C1→实际 C2 路由与四套原夹具、类型/lint通过；源码/包与远程结果在阶段收口记录。

本次检查点再 fetch 后远程 main仍47510be、对方5f153c3，无新增差异；未推送工作未知。请并行端继续在其 workflow 里接入 `node scripts/check_mobile_drafts.cjs`（不需要直接改我的路由夹具），并独立审查 C1-B/C 及共用 Session 的消费条件。原 c1-c2-interface 未更改，C2 不需 import C1。设备门槛、前端审计和真正用户结果仍不关闭。


C1-C 最终包为源码 9653d74，60,024,858 字节，SHA-256 `5d1349ae8db62f409cf1da9b4f52225e6b96f37d796733ba62d808a7fe267748`，标准构建5m11s通过；Mobile运行源码/配置相对冻结提交无差异。该源码远程 Mobile/Backend成功，Frontend的失败步骤已确认为audit moderate。无新存储格式迁移、无USB/生产操作。下一步优先收口：并行端接新C1路由CI/复核C1-B/C；主开发处理既有frontend审计与后续集成。未获得新的用户方向前不扩大到新频道/B3.2/商业化。发布本文件不表示对方已收到或认领。
