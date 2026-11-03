# 主开发工作进度

## 当前阶段 · N1私密创作工程收口，下一步N2

2026-11-03。本批运行/测试整合源码`4c3fa3e615aa8083a6d8b465697597ed1c0bdfb8`：主开发55911c1私密章稿、普通合入同事f4e66c0至4565dda、补章节保留回归与复盘；随后普通合入60eb6cc的M2证据文档，无新运行差异。已读取其M2规格/实际代码/阶段报告/夹具修正，未改其progress和认领；未宣称对方已收到本端新任务。

完整链路：开书→私密章稿→加密本机续写→同步→冲突独立新章节→继续写。用户N-D10明确新章恢复，原章保留、不发布/不占正式序号。最终独立chapter_drafts/mutations/revisions，不把章节放旧中篇表；App复用原同步器与编辑器章节模式，禁中篇发布票据，退出未同步计数含章稿。OpenAPI0.14.0、6新路由和0015已接，原密文/旧幂等兼容。未发布的共享旧表方案在无章稿的本机撤回，证据见[复盘](../reviews/private-chapter-drafts-review.md)、[ADR002](../novels/adr-002-chapter-drafts.md)。

实际通过：最终独立表全Go race/vet、契约/真实MySQL；补历史清理目标真实MySQL；合入M2后104模型、类型/lint、四组件+C1组合；契约生成与6门禁；18真实服务组、独立App小说客户端/原同步器+3300 HTTP联调；新隔离数据库dump恢复与有数据Down拒绝。3300重建/迁移保留原1109账号/20080中篇稿/20045作品基线，联调自有账号已清理；18服务检查按原方式产生自有测试记录，不把合成记录算真实用户。

设备按上述SHA交接device-requests，用户USB暂停；本端不打包/安装/ADB/真机/ECS。原生证据、外部用户结果和容量声明均无新增。远程CI需按本次push精确SHA检查，N1-A e675fcc三条绿灯只作为历史。推送前代理fetch已观察main=e675fcc、peer=60eb6cc并读取合入；如再有新增则按实际差异继续核对。

下一工作方向：N2章固定预览/发布、追加序号事务、目录/逐章阅读及最低限度隐藏/限制/撤销；先写ADR与契约并补千章目录证据，再实现。尚未改N2源码，不开放假发布/完结/追更。不接管同事M1/C2/M2与CI，不因整合无文本冲突推断未来共享接口已同意。

## N1-B 开始时快照（历史，不覆盖上述收口）

2026-11-03，main e675fcc / peer8e1e716，代理fetch无新增。已核验N1-A精确提交的Frontend／Backend／Mobile均success（链接待阶段复盘收口）。用户授权继续；本轮读business-first／tako-collab、移动约束和原草稿机制。

认领ADR002、私密章节表和Draft Store显式章作用域、旧中篇读取／发布源隔离、新章节路由／契约／生成类型及对应测试；App章节工具、私密书籍入口、PrototypeUi底部创作面板的长文入口（仅路由与文案）、C1共享列表／编辑器的章节模式和auth/context未同步计数沿主开发C1／novels范围；使用独立加密域与原同步器，不改旧密文格式。不改同事M1/C2／CI／依赖锁，不做包／USB／ECS。用户已确认恢复副本为独立新章节草稿；后端恢复原子创建新章，App按书读取恢复后的新稿，不发布／不占正式序号。当前尚未提交／推送。


## 上阶段 · N1-A 私密开书与资料

2026-11-03，用户授权开发。先普通合入同事3e7c046导航修复，阶段再次fetch见8e1e716已普通合入；读取其最新progress，USB暂停，继续不做包／设备。主开发认领backend/internal/novel/**、httpapi/novels*、00014、OpenAPI及生成声明，mobile/src/novels/**、api/novels、app/novels、自己C1列表的入口与存储测试、独立小说夹具和现有C1业务门禁；不改同事M1/C2/CI工作流／诊断分类／依赖锁。

N1按纵向子段推进：本批私密开书、资料列表／编辑／CAS、固定原请求的加密待确认记录；章稿与离线正文是N1-B，尚未实现。ADR见docs/novels/adr-001-private-books.md。新书不进Work／发现，无公开／完结／写章假入口。本机实现与验证已收口，源码随本阶段提交发布；具体证据见docs/reviews/private-novels-review.md。完整后端race/vet／契约／真实MySQL、94模型（8新增）、组件、真实App客户端联调、隔离迁移演练均已执行通过；最终工具行为与静态检查按收尾记录核对。3300加法升级，账号／草稿／作品数量升级前后1109／20080／20045一致，联调数据已清理。没有打包／USB／真机或真实用户结果。下一步N1-B章稿，不把N1-A当完整N1。


N1-A源码已提交 `b9cb2f8`；最终94模型、生成契约、类型／lint、6项门禁行为、C1组合夹具均通过；真实客户端联调和数据清理已完成。设备任务已按该SHA写入device-requests；USB暂停，待同事领取，未收到新设备结果。推送前fetch观察main9d9b2ac、peer8e1e716，无新增发布。远程CI需按此次推送SHA检查，不沿用旧绿灯。

## 上阶段 · N0 长文／连载小说规格

2026-11-03。用户明确“长的业务规格”是连载小说业务，已完成关键权利讨论，本轮只整理 docs/novels/**、自身阶段复盘、AGENTS 和主开发／重启手册及交接入口；不改运行代码、OpenAPI、迁移、依赖或并行端进度。

通过7897代理fetch观察 main=6ad485e、peer=42517be，与上次一致；读取其实际进度，尚无新增发布，不能推导其未提交任务空闲。已确认主开发只做业务／规格／实现／自动化／集成，不做APK、安装、USB/ADB或真机；长期规则见05-development-playbook。

N0包含用户九项决策、工程假设、N1～N5纵向交付和40条失败／权限验收场景。完结不可恢复且锁旧章，指定平台整改一次提交人工审核；完成整改纠错链路前不开放完结。按章评论、不记录修订版本；私密续读与书架追更／隐藏期汇总另有分期。移出书架追更副作用仍属N4待评审，不冒充已确认。

本轮没有新运行源／新包／设备任务，S2运行源码仍ce1670a，原设备队列继续。规格与实现分账：长文API、数据迁移、App入口均未实现，无长文测试通过声明。本轮验证为Markdown链接、规则一致性和diff检查，详见novel-spec-review。下一步N1先写兼容模型ADR／契约，明确共享触点，再实现私密开书→章草稿；继续避开同事CI/M1/C2，ECS不连接。


## 上阶段 · S2 App搜索接入

本端开始时fetch观察main0468470、peer42517be，已快进合入。对方明确合入本端0468470/已读S1/S2认领并复核生成契约；710d04a副本竞争经其真实Node SQLite/AES独立复验关闭。不能扩写成对方已独立审查全部S1搜索实现。

已读其USB阶段报告：冻结1793f7f（Mobile运行树与2cfd6fb一致），本机重建/安装vivo Android14；ASCII离线暂存/杀进程、固定快照、未知发布只GET恢复和隐藏恢复部分通过。中文长粘贴/切号401/设备冲突尚待；“返回我的多退一次”P2由其M1/C2继续修复，本端不接管。

主开发正在接S2：api/search、search/flow与页面、app/search、Community入口和共享WorkRow；既有reader.test扩展客户端/协调用例，既有reader/versions夹具扩展实际搜索路由，全部沿既有CI入口执行，不改对方工作流/分类/诊断源。保持其C2/M1/auth/设备范围不动。Expo58/Router/RN0.88相关官方文档与ui-deai已读，原型九点关注按钮不改成搜索筛选。

18读者/服务组（6项新增客户端/协调、1项新增真实搜索HTTP，不冒称全部为真实服务）、搜索页面夹具、独立3320真实HTTP+MySQL客户端/协调初验已通过；完整自动化已通过；用户已将打包/安装/真机交并行端，本端不构建此批包。3320使用writing_search_test并已停止。用户确认同事使用他电脑的独立3300；本端已独立升级自己的3300，无迁移/重置，search200/test和就绪检查通过；不把能连USB视作全部体验通过。

S2本轮已推送3d6b8fe（运行源码ce1670a），Mobile/Backend/Frontend三条远程工作流全部success；来源与链接见mobile-search-app-review.md。设备任务device-requests已随push发布，待对方通过progress认领/回报；本次后续仅文档，不增加新的打包要求。主开发本机3300新搜索已可用，同事电脑环境保持独立。

## 上阶段 · S1 公开中篇搜索

2026-11-02，本轮源码/本机检查已完成，随包含本记录的提交发布，1b89018已推送，三条远程工作流全部success，详见搜索复盘。fetch观察main=1793f7f、peer=a2905e8，无新增发布；用户告知同事已USB连接手机，但该ref的progress尚未记录设备认领/结果，不能推导已验收或已收到本端建议。

业务盘点见 business-inventory-after-c1.md：中篇创作闭环已纵向拓展，最近一轮为工程收口；短帖/长文/关注/通知/搜索此前均未交付。用户本轮接受先搜标题、笔名、简介，不搜正文。规格 mobile-search-spec.md；S1先API/契约/错误与真实MySQL，S2再按原型接App，不把API可调用记为App完成。

本端认领 backend/internal/publication/search*、httpapi发现注册/对应测试、OpenAPI、生成mobile/src/api/contract.d.ts、S规格和自身复盘；不改对方CI/M1/C2或创作页面，不操作设备/ECS，不替换3300服务。真实集成在独立writing_search_test库，保留现有tako_sandbox供设备验收。

建议并行端按用户已给的USB条件先验证整合包（运行源码2cfd6fb，main1793f7f文档收口）及710d04a另存竞争修复；记录其本机包SHA、设备/系统、真实接口入口及结果，不能沿用主开发机器指纹当其安装证据。重点中文/表情/长粘贴、后台/杀进程、真实切网、同账号恢复/换账号隐藏、冲突双方保留、发布前后返回/未知结果。此为待其确认的协调建议，不是已接收任务；如发现P0/P1，先在原归属修复，S1无关工作继续。

S1已交付：搜索Store/路由/OpenAPI/生成声明，相关真实MySQL、全后端race/vet、最终坏URL解析目标用例、契约/6门禁与Mobile类型/lint通过。20,033作品只读基线：首屏中位131～153ms，单字符100页单页最高232ms；EXPLAIN仍扫描/filesort，不声称并发容量。完整证据public-search-api-review.md。S2 App页面/客户端尚未接，不改3300，以免打断同事设备验收；下一段主开发认领独立search路由/客户端及community原型搜索入口，继续避开其C2/M1/CI范围，接线前再次核对远程。

## 上阶段状态 · C1 竞争修复与依赖门禁收口

2026-11-02，main。代理 7897 fetch 先观察 a814cf9，预集成又观察并行端 a2905e8；已读取实际 progress、审查、CI 和 C2 新增差异。远程 main 当时仍 0e1e60e。本端先提交 710d04a（C1 副本协调）与 0e0e0b3（Web 审计），再普通合并 peer 至 2cfd6fb，无冲突，双方历史保留。

- 接受同事的确定 P2：另存期间输入与旧稿 CAS 竞争。新增回归旧实现 1 失败，修复后 86 模型全通过；实际页面延迟另存并继续输入后切入副本，最新输入落盘，原稿不变、零额外 HTTP。仅维护本端 C1/夹具，不接管 C2。修复需对方按新 SHA 复验，未收到确认。
- 集成对方新增 C1 必跑 CI、runner 目录归属修复和已确认发布/状态 GET 错误隔离。独立审查见 cross-review-primary-a2905e8.md；86 模型、11 真实服务、五套页面、6 门禁与契约通过。服务首次 503 预检未运行测试，环境检查恢复后通过，未宣称找到其根因。
- frontend 保持 Nuxt/Nitro/Vue 与 moderate 门禁，npm 生成 glob/minimatch 定向修复锁；干净安装、12 原测试+2真实消费者兼容、类型、生产构建及 9 浏览器回归通过。中危及以上 0，deepmerge 链仍 7 low，优先级/退出见 frontend-dependency-audit-review.md。
- 本轮 Mobile 冻结 2cfd6fb 重建整合 APK；首次构建 710d04a 已成功，但之后对方新增 C2 源码，故不会把它作为最终包。最终整合包构建/签名/标识检查通过，指纹见 cross-review-primary-a2905e8.md；4c63ad0 的 Mobile/Frontend/Backend 全部 success，不借旧 CI。
- 未触碰 ECS、USB、业务 API、真实邮件或数据库重置；C1-C 已接，不继续按旧快照重复开发。P0 真机体验仍在；本轮工程整合验证完成；下一步待对方按新 SHA 独立复验，并评审中篇私测闭环的剩余业务，暂不扩展复杂治理/推荐。

## 历史阶段快照

以下为当时记录，旧 APK/测试数量与“未接 C1-C”等不覆盖上面的当前状态。


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

本轮收口补录：最终 APK 绑定 2cfd6fb，字节数 60,026,558、SHA-256 c5740f459877fb6f6a5d2181a0da18cefbc852b4bf465c75edd9f133a0aef541。4c63ad0 三条远程工作流均成功。推送前重新检查 main 与 peer 的实际引用，不把本文件推送等同于对方已收到/确认。

用户最新分工明确主开发只承担业务/自动化/集成，打包与设备验证由同事负责；每次推送随docs/handoff/device-requests.md发布具体任务，待其progress确认才记已接收。本机聊天工具未显示其另一台电脑会话，继续通过仓库协作技能交接，不称已直接发送跨电脑消息。
