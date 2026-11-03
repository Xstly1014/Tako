# 移动端 CI 与独立环境复现 · 2026-11-02

## 最新：M3作者目录完整前后端链路

本次源码/本机验证随包含本段的提交交付，完整场景见[阶段复盘](../reviews/author-catalog-stage-review.md)。类型/lint、107模型、契约生成一致性、6门禁、四组件+C1组合、19项顺序真实服务通过；独立MySQL全Go race/vet通过。55条后端真实查询、45条App协调器+真实HTTP/MySQL三页及管理返回、45条DOM工作台交互分别记录，不混称设备证据。初轮55次预览触发保护已如实保留，以历史合成夹具替代，不改生产保护。

origin/main=f3196c7的主开发记录已确认M3共享片段。运行源码33e595f，推送前再次fetch发现main=966ee47（仅文档/图片），普通pull形成整合b4b077c，无冲突；合入后契约一致性通过。已推168235b，精确SHA的[Mobile四作业](https://github.com/Xstly1014/Tako/actions/runs/41570503029)、[Backend](https://github.com/Xstly1014/Tako/actions/runs/41570503011)、[Frontend](https://github.com/Xstly1014/Tako/actions/runs/41570503145)已读取并全部success，工程收口；本次补录仅文档，证据仍绑定168235b；主开发应整体集成M3源码、OpenAPI与生成类型，不单摘页面。无迁移/依赖/锁/C1/auth/N2改动；USB暂停，ECS不推进。

## 历史：M2修订发行与版本管理完整工程链路

按9d65d33规格实施M2.1～M2.3，工作入口、固定预览、同作品正式发行、定向返回详情、展示/隐藏/历史与公共结果一起验证。[M2报告](../reviews/author-revision-stage-review.md)列明每个场景与证据层级。本机类型/lint、99模型、契约、6门禁、四组件+C1组合通过；两个顺序执行的真实API聚合用例均1/1通过，覆盖同账号A/B作品、丢响应/竞争、隐藏再发行、恢复/切旧版/历史可读及私稿保留。本次远程整合待新SHA，USB暂停，未构建/验机。模型/服务新增用例位于原已分类文件，没有漏跑新文件。

最终源码／夹具f4e66c0的[Mobile四作业](https://github.com/Xstly1014/Tako/actions/runs/41564489227)、[Backend](https://github.com/Xstly1014/Tako/actions/runs/41564489143)、[Frontend](https://github.com/Xstly1014/Tako/actions/runs/41564489229)均success，组件/C1/真实API步骤已逐项核对。首轮3663f91组件在作者入口立即count处失败，后续C1未执行；修正为首请求Promise闸门及语义就绪等待后新一轮通过，完整首轮证据保留在报告，未重跑原码掩盖。M2工程阶段收口，后续证据文档不改变运行源码；尚待主开发集成与用户恢复设备验收。

## 最新：M1核对读者当前展示

基线c728df2的三条CI已确认success。本端新增管理详情→公共Reader入口，只传作品ID；隐藏/整体受限不渲染，未知操作/读取失败禁用，读取恢复后可用。不修改Reader/API或作者私稿。新增路由/可用性组件回归先红后绿，点击和重试不增加管理动作；类型/lint、94模型、契约、6门禁及四组件+C1组合本机全部通过。[阶段复盘](../reviews/author-public-display-review.md)区分路由观察适配与实际设备/HTTP。本轮远程结果待新SHA绑定，USB仍暂停。

## 最新：M1管理已确认后的现状读取失败

基线e675fcc。本端分离管理动作成功与随后GET失败，保留成功确认、单独提示读取失败；重新加载只GET，不增加动作或用历史回执代替现状。实际作者组件新增confirmed-action-read-retry先失败后通过；类型/lint、94模型、契约、6门禁及四组件+C1组合（含新增小说资料）本机通过。详见[复盘](../reviews/author-action-state-read-review.md)。Docker引擎已恢复，保留既有数据/配置；本机API未升级、USB仍暂停，真实服务与设备证据不混用。本次远程CI待发布源码绑定。

## 最新（2026-11-03）：M1/C2明确返回目标与搜索整合

本端97ef177修复发布结果/无效入口→作品管理、管理列表→账号的重复栈问题，已有目标使用Router dismissTo收起页面，无目标替换当前页；普通发布返回及未知操作保护保留。新增实际账号/M1/C2页面栈回归先失败后通过，重复管理页、直接入口和再进发布只读确认均覆盖，POST仍1。[导航复盘](../reviews/author-navigation-return-review.md)保留问题、验证及原生边界。

按用户最新要求提前fetch并读取同事main6ad485e的S2搜索、设备交接及职责，普通合并成b69d034，无冲突；未改主开发搜索/C1/auth或其进度。整合后类型/lint、契约、86模型、6门禁、四组件及独立C1路由通过（包含新S2搜索/阅读返回），零skip/todo。本机未升级3300或跑新搜索HTTP，不借旧CI作为本次服务证据；推送后读取该SHA实际CI结果。

职责：主开发维护搜索业务/共享WorkRow及其自动化，C1/auth仍由其负责；本端继续M1/C2、CI集成和后续本机包/设备。用户明确USB暂停，device-requests已接收为待执行，未生成/安装新包，原生P2及余下P0不关闭。本机故障代理已停，无设备操作或测试服务重建。

源码3e7c046已推送，其[Mobile四作业](https://github.com/Xstly1014/Tako/actions/runs/41492900748)、[Backend](https://github.com/Xstly1014/Tako/actions/runs/41492901017)、[Frontend](https://github.com/Xstly1014/Tako/actions/runs/41492900762)均completed/success；Mobile真实API/账号收藏步骤亦已逐项核对。收口再次fetch后普通合入main9d9b2ac的N0连载规格/职责文档至eb12fad，运行文件与3e7c046差异为空，不移用其CI去证明新运行代码。已读新AGENTS和05-development-playbook：主开发推进N1业务/契约/实现，本端既有CI/M1/C2归属继续，打包/真机仍等用户通知；纯N0文档无新包需求。

## 最新：整合包 USB 真机阶段结果（尚未全部验收）

本端已合入 main0468470，Mobile运行包冻结1793f7f（运行源码与2cfd6fb一致），本机新建工具链并构建/验签/安装成功。vivo V2055A / Android14，APK SHA256 `72ab78e6f707aae12125bc1a3fb3ff0c13d131a0c108cc707f052cf0555d139d`；不是同事电脑包的安装声明。类型/lint随本机构建通过，86模型及710d04a另存竞争工程复核已通过；本次文档推送未重跑无关全量CI，不以旧CI当本次设备证据。

手机已验证本机独有稿件的后台/强制停止离线恢复、离线禁发布与重连同步；C1→C2系统返回保留输入；固定R3发布与工作稿R4隔离；成功响应丢失后重开仅GET确认V1、发布POST始终1；作者隐藏/恢复/隐藏及真实匿名404/200/404。完整产物、范围、工具误差及证据见[USB阶段报告](../reviews/usb-creator-device-review.md)。

新确定P2为本端M1/C2返回导航：从发布进入作品管理后“返回我的”先退到重复管理页，第二次才回账号页；本端认领下一阶段修复与回归，当前未修。Unicode长粘贴、切号/真实401持久锁定/同账号恢复、设备冲突仍未验，P0未关闭；单次硬件END的系统文本选择异常另列待核实P2。主开发继续S2搜索，3300保留；本轮只推本端阶段记录，不改其进度或共享源码。

历史状态已变化：710d04a的另存P2已由本端独立复核关闭；frontend moderate审计已由主开发0e0e0b3修复并发布全绿证据，仍有7 low的退出计划。下文旧阶段中的“尚未入main/入包”“审计仍失败”“另存待修”仅约束当时SHA，不代表最新状态。

## 上阶段：发布已确认后的作品现状读取失败

基线 a814cf9，本轮 fetch main仍0e1e60e，无新发布增量，不推导主开发空闲。修复本端 P2：已取得服务器 V1 确认后，作品现状 GET 断网原先仍显示发布“结果尚未确认”。现将现状读取失败单独呈现，原确认保留，只 GET 重试；没有新鲜状态时不提供公开阅读，不猜测隐藏或审核结论。没有改变 flow/journal、C1/auth、接口/锁/构建。

新增实际发布页故障回归在修复前失败，修复后通过；断言重试前后 publication 请求数和正式 POST 数不变，仅状态读取增加，成功后错误消失。[阶段复盘](../reviews/publication-state-read-review.md) 记录准确触发和证据。本机类型/lint、85 项模型、11 项顺序真实服务、6 项门禁、发布组件及 C1→实际 C2 路由通过，零 skip/todo；其他三套组件本机未重复，远程结果待本轮提交绑定，不沿用旧绿灯。

修复提交 **`2b2b952`** 已推送 codex/mobile-publication，推送前 fetch/核对/pull main 仍0e1e60e，无冲突。[本轮 Mobile](https://github.com/Xstly1014/Tako/actions/runs/41452848999) 四作业 success，Windows/Linux 静态/模型、完整五套组件及真实 MySQL/API 均实际运行；[Backend](https://github.com/Xstly1014/Tako/actions/runs/41452849363) success。[Frontend](https://github.com/Xstly1014/Tako/actions/runs/41452849138) 仍失败在 npm audit --audit-level=moderate，责任/退出条件未变。后续仅证据文档不改变该源码，不称全仓库绿灯。

本轮 UI 源码变化尚未合入 main/进入已有 APK，最终集成冻结/包由主开发维护；设备 P0、frontend audit P1 和上一轮 C1 另存 P2 未因本轮改动关闭。

## 上阶段：C1-B/C 路由接入远程门禁与独立审查

本端从 5f153c3 快进到 origin/main@9653d74，无冲突。主开发已合入本端恢复修复，并发布 C1-B/C 列表/编辑、一次票据、实际 C2 路由和返回保护。本轮按其明确请求，在本端 workflow 的组件 job 中增加独立必跑 `node scripts/check_mobile_drafts.cjs`，复用既有依赖安装，不复制或修改其 CLI/路由夹具，不绕过失败。现有模型/服务分类已覆盖新增用例，无需改名。

新增 C1 CLI 子进程失败与哨兵脱敏检查，失败/超时非零、已知阶段/行号安全投影、未知阶段 unavailable，成功也不转发任意子进程输出。本机实际通过：6 项门禁行为、85 项模型、11 项顺序真实 MySQL/API 服务、类型/lint、契约、actionlint、原四套组件和新 C1 路由；零 skip/todo。远程接入结果须绑定本轮实际步骤，待推送后记录。

[独立审查](../reviews/cross-review-parallel-9653d74.md) 核对新 Session 接口及票据/返回，未确认新的 P0/P1；在隔离 worktree 确定复现 P2：另存期间继续输入，旧保存任务可让已切换副本的另存失败，最新输入尚未暂存；原稿/副本/内存输入均保留且显式重试能存。请主开发协调副本切换与输入保存、补确定顺序回归，未在本端接管编辑器。

没有改 C1/auth、依赖、构建或主开发汇总。新夹具是产品路由与可控 HTTP/存储/导航适配，不冒充 Android 设备验收或新整合包；既有前端审计与设备门槛保持。

预推送看到 main 新增 0e1e60e（仅构建/交接文档），已普通合并，无冲突；业务/测试/脚本与本轮已验的 9653d74 无新增差异。本端实现/审查提交 f5bfb34 保留。已读主开发最终包声明及下一步 frontend 审计认领，未伪称本端核验了另一台电脑 APK。

首轮推送 303d657 的 [Mobile](https://github.com/Xstly1014/Tako/actions/runs/41446434106) 新 C1 step 实际失败：Linux EACCES mkdir `.runtime/mobile/qa/empty-host-modules`，发生于原四套 root 容器建父目录之后；C1 浏览器断言未启动。不是忽略失败或改业务来换通过。已由 runner 在首次容器前预建路径，Linux 独立 tmpfs 中 root/UID1000 的确定实验复现原失败并验证该顺序修复，actionlint通过；修复后远程结果待新提交核对。[CI 接入复盘](../reviews/mobile-c1-ci-integration-review.md) 保留首轮证据。

修复提交 **`099c36d`** 已推送独立分支，推送前 fetch/核对/pull main 仍 0e1e60e，无冲突。[本轮 Mobile](https://github.com/Xstly1014/Tako/actions/runs/41447328547) 四作业 success，已读取步骤结果并确认新增 `Draft editing and publication handoff routes (network disabled)` 为 success；原四套组件与该 C1 路由均远程真实执行，关闭新路由 CI 尾项。[Backend](https://github.com/Xstly1014/Tako/actions/runs/41447328549) success，[Frontend](https://github.com/Xstly1014/Tako/actions/runs/41447328596) 仍失败在 moderate audit。后续仅证据文档不改变被验 workflow/源码，本轮尚未合入 main。P2 编辑竞争、设备和审计门槛不因 CI 绿灯关闭。

## 上阶段：C2 失败恢复不能清除另一未确认发布

本端基线 402a8aa，fetch 观察 main 仍 42bc325，无新发布增量，不推导主开发空闲。本轮在本端 C2 范围确认并修复 P1：旧成功页面读取另一页面的新未知 journal 失败时，原 restore 提前更换请求标识却保留旧成功，导致 reset 能删除新未知记录。先加回归，修复前 68 项中该项失败；修复后通过。

恢复现在完整校验后一起替换请求/快照/结果，失败时页面隐藏旧成功并禁止发布/清除；过期清理核对原请求标识，记录已换人时保持保护。新增实际页面夹具验证 503 后旧 V1 和确认按钮消失、journal 不变，手动重试只读显示正确 V2，零新增发布 POST。[阶段复盘](../reviews/publication-recovery-isolation-review.md) 说明准确触发、影响和证据，不扩大为正文丢失或跨账号问题。

本机本轮实际通过：69 项模型、10 项顺序真实服务、5 项门禁、类型/lint、契约一致性及发布组件，零 skip/todo。没有改 C1/auth、HTTP 契约、锁文件、构建或主开发进度。其他组件本机未重复，远程四套整合门禁另行验证。ECS、APK、真机及既有前端审计退出条件不变。

修复提交 **`03f2d0b`** 已推送 codex/mobile-publication，推送前 fetch、核对并 pull main 仍 42bc325，无冲突。[本轮 Mobile](https://github.com/Xstly1014/Tako/actions/runs/41433032243) success，包含 Windows/Linux 静态/模型、四套组件和真实 MySQL/API；[Backend](https://github.com/Xstly1014/Tako/actions/runs/41433032280) success。[Frontend](https://github.com/Xstly1014/Tako/actions/runs/41433032252) 仍失败在既有 moderate audit。查询期间 GitHub 公共 API 触发限额，停止该接口查询后通过对应公开运行页面确认最终 Success，没有拿限额错误当作测试失败或成功。后续证据文档提交不改变被验源码；本轮修复尚未合入 main/进入 APK。

## 上阶段：C1-A 授权与双实例修复独立复核

本端从 badb293 快进到 `origin/main@42bc325`，主开发已整合全部上一轮本端成果，并发布授权 33c15b2、并发修复 1fbc874。无冲突。继续各自边界，主开发 C1-B/C1-C，本端 CI/M1/C2。

[新审查报告](../reviews/cross-review-parallel-42bc325.md) 绑定 42bc325：独立复现证明旧双实例 P2 已解决；新增确定顺序实验验证 confirm 落盘期间收到 401、删除失败时，晚到确认不能覆盖锁定，断网重开仍 locked。未确认新的 P0/P1；未审未来页面或宣称设备安全。

本端实际产品组件夹具已接真实 createDraftSessionVault，验证草稿 confirmation 不影响既有服务器作品管理/发布；离线草稿许可仅用于本机稿，不显示旧 M1/C2 私密视图、不发送业务请求；联网后只读恢复原发布 journal，无新增 POST。HTTP 尝试先于网络 abort 计数，未将失败发送误报为零发送。阶段白名单同步维护，不改 C1/auth、锁文件、构建或主开发汇总。

本机本轮实际通过：类型、lint、契约一致性、67 项模型、10 项顺序真实服务、5 项门禁及四套 Linux 断网组件，零 skip/todo。安全项/故障实验是可控适配器；组件 HTTP 模拟，真实服务另外通过，不冒充 Expo 原生设备验收。

本端实现/审查提交 **`73bdd19`** 已推送到 codex/mobile-publication，推送前 fetch、核对并 pull main 仍为 42bc325，无冲突。[本轮 Mobile](https://github.com/Xstly1014/Tako/actions/runs/41431219962) 四作业 success（Windows/Linux 静态/模型、组件、真实 MySQL/API），[Backend](https://github.com/Xstly1014/Tako/actions/runs/41431220010) success。[Frontend](https://github.com/Xstly1014/Tako/actions/runs/41431220172) 仍在 npm audit --audit-level=moderate 步骤 failure，责任与退出条件未变。后续仅证据文档提交不改变被验源码；本轮成果尚未合入 main，未入 APK。

## 上阶段：同步主线与门禁诊断、C1 互审

本端从 c905d7a 快进至同事最新 `origin/main@59694d6`，双方现在共享 CI/M1/C2 的整合基线；主开发已按独立审查接受本端 C1/C2 参数和恢复约定。没有源码合并冲突。主开发继续 C1 授权与编辑接入，本端继续 CI/M1/C2，不新建第二套草稿实现。

本轮本端完成安全失败诊断：service 预检定位连接/环境/JSON/种子，模型/服务失败定位已分类文件行列，组件失败报告白名单阶段和进程原因；不输出原始响应、错误、断言或凭据，不通过自动重试或跳过掩盖失败。已用故障注入和哨兵验证。详见 [诊断阶段复盘](../reviews/mobile-ci-diagnostics-review.md)。本机实际通过：5 项门禁行为测试、53 项模型、10 项顺序真实服务、契约一致性、四套 Linux 断网组件，零 skip/todo。App 源码未变，本机未重复类型/lint、包或设备验证。

实现/审查提交 **`a0d4cea`** 已推送独立分支。推送前 fetch、核对双方进度并 pull main，仍 59694d6，无新增冲突。[本轮 Mobile](https://github.com/Xstly1014/Tako/actions/runs/41428997743) 四作业 success，包含 Windows/Linux 类型、lint、契约、5 项门禁与模型，以及 Linux 组件和真实 API；[Backend](https://github.com/Xstly1014/Tako/actions/runs/41428997687) success。[Frontend](https://github.com/Xstly1014/Tako/actions/runs/41428997693) 仍在 npm audit --audit-level=moderate 步骤 failure，保留既有 P1 责任与退出条件。本轮成果尚未合入 main；后续仅补证据的文档提交不改变被验源码。

按协作模式独立审查 C1 `de49a17` 和授权规格，报告见 [并行端交叉审查](../reviews/cross-review-parallel-de49a17.md)。隔离 worktree 原有 13 项仓储/同步模型通过，另外确定复现 P2：两个同步器可在一个已完成保存后多建恢复副本；原/新文字保留，未确认丢稿/越权，也未宣称未来编辑页已触发。请主开发在 C1 范围选择共享协调器或重验最新状态，并补确定顺序回归。授权实现尚未发布，不预判已完成；Session 消费契约维持。

回应对方 `cross-review-primary-c905d7a.md`：接受首次瞬时失败的证据，新增诊断便于下一次定位，但未复现原根因，不写作已修复。不改主开发进度、C1/auth、依赖锁、构建配置或共享汇总，不推进新业务/ECS/真机。下文保存历史阶段与前端审计证据。

## 上阶段：C1/C2 集成适配

本轮按主开发转交要求暂停新业务。当前分支 `codex/mobile-publication`，开始 HEAD `1627347`；已 fetch 核对远程 main `de49a17`，它已通过集成提交 `b73fbe4` 合入本端，双方成果均保留，无文本冲突。主开发继续 C1 会话/离线授权/锁定/同账号恢复和草稿页；本端仅维护 CI、作者管理、发布适配。对方未推送工作仍未知，不因远程不动认定其空闲。

CI 分类已在 `df4a5fb` 更新：模型 drafts-storage.test.ts、drafts-sync.test.ts，真实服务 drafts-service.test.ts；helpers/drafts.ts 仅辅助。工作流 Windows-2025/Ubuntu-24.04 均固定 Node 24.19.0，内置 node:sqlite 不需要额外 flag 或第三方数据库包，不跳过新测试。该提交 [Mobile 四作业](https://github.com/Xstly1014/Tako/actions/runs/41407759602) 与 [Backend](https://github.com/Xstly1014/Tako/actions/runs/41407759570) 成功，涵盖两个平台实际模型执行。

本轮修复发布交接不完整时自动采用最新修订的问题，并为原发布恢复优先于新入口增加明确提示。参数必须是完整服务器 ID/修订对；完全无参数才手动选稿。旧修订不自动换新，C2 不触及 C1 本机正文。编辑页需要遵守的返回、旧修订、未确认发布恢复规则见 [C1/C2 接口约定](c1-c2-interface.md)，集成自查见 [阶段复盘](../reviews/c1-c2-integration-review.md)。

本轮本机实际通过：类型、lint、契约一致性、53 项模型、10 项真实服务组（顺序执行）、3 项门禁与四套 Linux 断网组件；零 skip/todo。没有认证限频，本轮没有清计数或放宽保护。四套组件不等于真机或完整外部服务验收。

适配提交 **`f041ef5`** 已推送到 `codex/mobile-publication`；推送前再次 fetch、核对双方进度并 pull main，仍为 `de49a17`，无需新合并，无冲突。[本轮 Mobile](https://github.com/Xstly1014/Tako/actions/runs/41410502057) 的 Windows/Linux 静态与模型、四套组件、真实 MySQL/API 四个作业全部 success；[本轮 Backend](https://github.com/Xstly1014/Tako/actions/runs/41410501956) success。这些结果绑定 f041ef5，不套用旧提交。后续只补此证据的文档提交不改变被验源码；未合入 main。

[本轮 Frontend](https://github.com/Xstly1014/Tako/actions/runs/41410502037) 仍在 `npm audit --audit-level=moderate` 步骤 failure；不是移动集成通过就可忽略。共享依赖未改，历史 main 同步失败证据、只读审计数量和主开发修复/验证退出条件见下文 P1；本轮没有重新宣称审计数量或擅自升级锁文件。

主开发需配合：按接口约定从当前已确认记录传 serverId/baseRevision；不能单凭 recovered 状态允许发布，须同时确认 dirty=false、pending=null 及没有新编辑/进行中保存。实际编辑页导航与返回待其实现后整合验证。未改 `mobile/src/drafts/**`、认证会话、依赖锁、构建配置或主开发进度；没有推进 ECS、真机和新业务。前端审计尾项的基线链接、错误步骤和退出条件保留在下文。

## 历史阶段证据（各自绑定当时基线）

后续 C2 更新：用户在规划后要求继续，并确认 SecureStore 仅保留账号绑定的最小发布标识，重开后手动核对。本端 `codex/mobile-publication` 已接入服务器已保存稿件 → 固定预览 → 正式发布 → 作品管理/阅读；C1 草稿实现仍由同事维护。规格见 [C2](../mobile-publication-spec.md)，证据和集成门槛见 [发布阶段复盘](../reviews/mobile-publication-review.md)。本机 38 项模型、9 项服务组、3 项门禁和四套组件通过；不宣称手机写稿闭环或新 APK 已交付。

C2 提交 `dc9e672` 已推送，推送前成功拉取 main（仍 `3a17e22`）。[远程 Mobile](https://github.com/Xstly1014/Tako/actions/runs/41401925691) 四个作业和 [Backend](https://github.com/Xstly1014/Tako/actions/runs/41401925638) 均 success；工程阶段收口。下一门槛为 C1 页面/同步交接与整合包验证，仍不改动 C1 实现，不将系统安全存储夹具视为真机可靠性证明。

项目规划盘点更新：见 [业务线与下一步评审](../reviews/2026-11-02-business-roadmap-and-next-step.md)。远程 main 仍 `3a17e22`，本端 M1/CI 尚未合入；同事继续 C1，本端建议下一条为原生固定预览/正式发布，待明确与 C1 的交接及文件范围后实施。该报告提出“先验证中篇 App 小规模私测”的建议，未擅自改变三频道正式首发范围或开放生产。

后续业务分工更新：用户明确本端开发作者作品管理，同事继续 C1。新分支 `codex/mobile-author-works`，实现与证据见 [M1 规格](../mobile-author-works-spec.md) 和 [阶段复盘](../reviews/mobile-author-works-review.md)。本端仅替换个人中心顶部“作品”入口并新增独立管理页面/客户端/测试；草稿箱、C1 存储同步、会话、依赖、后端仍由同事维护。CI 分类已扩为 29 项模型、8 项服务组及三套组件夹具；下文 24/7 及两套夹具是上一阶段证据。

M1 实现提交 `9d54df2` 已推送上述独立分支；推送前再次拉取 main，最新仍为 `3a17e22`，未发生冲突。[远程 Mobile CI](https://github.com/Xstly1014/Tako/actions/runs/41396408967) 四个作业与 [Backend 检查](https://github.com/Xstly1014/Tako/actions/runs/41396408942) 全部 success。本阶段不包含新 APK 或真机，整合 C1 后下一轮安装包前须冻结源码构建及核对；共享前端审计问题仍按下文门槛跟进。

本会话已认领交接 03 建议的 CI 方向，分支 `codex/mobile-ci-portability`。初始基线 `712777e`，现已拉取并快进到同事最新 `3a17e22`；用户已授权阶段性提交/推送，要求每次推送前先拉取同步。未创建第二个代理，不连接 ECS。

## 同事进度与并行约定

远程 `bc7f4f3` 记录清理镜像后的真实重启，`a0d1b3c` 交付原生历史阅读，`3a17e22` 完成项目总复盘和 C1 私密草稿规格/原生契约预检。主开发下一步是加密仓储、同步与创作页；尚未实现这些能力，也未完成新增功能真机验收。本端继续工程检查，已将新增版本模型/真实服务及阅读页组件组合接入 CI，不修改 App 页面、会话、依赖、草稿规格或后端。

共享交接与 current-progress 以同事远程版本为准，前轮本端改动已撤回，避免两端同时汇总产生冲突。本端证据集中在本文件和独立阶段复盘。同事可从本分支合并下述独占文件，继续负责 `mobile/src/**`、业务测试、OpenAPI、依赖和构建配置；新增测试需与本端同步分类，缺分类门禁会明确失败。

## 实现范围

- 新增 `.github/workflows/mobile-checks.yml`，Windows/Linux 类型、lint、契约与模型检查；Linux 断网组件夹具；真实 MySQL 迁移/造数/API/账号收藏检查。
- 新增 `scripts/check_mobile_contract.cjs`、`scripts/check_mobile_tests.cjs`、`scripts/check_mobile_components.cjs` 与 `scripts/mobile-checks/` 独立工具锁、失败验证、API 端口 override 和使用说明。
- 为消除真实复现出的 React 重复加载，组件入口使用空目录遮住宿主依赖，两个原脚本统一解析 Docker /app/node_modules；既有评论/版本组件脚本和业务步骤均未修改。
- 未修改 `mobile/src`、现有测试、App 依赖、OpenAPI、Go 业务或 schema。生成器使用兼容的独立 TypeScript 5，不放松 peer 校验来强装，也不改 App TypeScript 6。
- 阶段报告：`docs/reviews/mobile-ci-portability-review.md`。本端只新增独占文件，共享文档与同事实现完全沿用远程版本；其他文档中的“CI 未认领”是旧检查点，以本文件为准。

## 环境与证据

起点为 Windows，本机无测试配置/数据卷、npm 依赖与镜像。Docker Desktop 启动后确认 Linux 引擎可用且卷列表为空，随后使用仓库首次初始化脚本创建本机独立配置。未复制原机密钥或数据。Python 3.13.9 embedded 从 python.org 下载至忽略目录，未修改全局 Python。

- Node 24.19.0 / npm 11.17.0。第一次 npm ci 因全局缓存 `D:/nodejs/node_cache` 不可写而失败；改用 `.runtime/npm-cache` 后 mobile 与独立工具的锁定安装通过，未修改全局配置。
- 同步 `3a17e22` 后 App 类型检查、Expo lint、24 项会话/评论/版本纯模型测试通过，零 skip/todo。
- 实际 OpenAPI 重新生成与已提交类型语法比较通过；3 项门禁自动化测试通过，覆盖格式不误报、类型漂移/坏源拒绝、无源码写回、服务缺失/错误环境/种子不足拒绝，以及 skip/未分类测试拒绝和断言值不泄露。这些门禁夹具不是业务服务验收。
- actionlint 1.7.12 检查新工作流通过；`f4ee3da` 推送后，远程 Windows/Linux 静态与模型、断网组件、真实 MySQL/API 四个作业全部成功，见 [Mobile checks #41388352711](https://github.com/Xstly1014/Tako/actions/runs/41388352711)。
- 冷启动先后遇到 Docker Hub token 连接失败、distroless 拉取 EOF/TLS 超时、Go 模块代理 EOF 和容器 npm ECONNRESET。单独拉取重试后镜像齐备；容器显式继承 Docker 引擎已有 HTTP/HTTPS 代理后恢复依赖下载，未改全局配置、关闭证书校验或关闭 Go 校验和验证。原 `backend/Dockerfile` 使用预定义代理 build args 构建成功，没有替换运行镜像。
- 真实 MySQL 8.4 的迁移 1～13、10 账号/60 作品种子完成；真实 API 镜像经 CI override 在回环 3300 启动，同步后 7 项 reader/comment/version 检查通过，零 skip/todo；账号/收藏验收脚本通过，包括原生/浏览器凭据隔离、多账号归属、幂等、隐藏元数据保护和退出重试。未发真实邮件。
- 组件首次复验出现 `useMemo` 空引用，确认是宿主 mobile/node_modules 与 Docker /app/node_modules 两份 React 导致。最终独立入口遮蔽宿主依赖后，评论及历史阅读断网组件检查均通过，包括输入保留、登录、重试、删除/回复、切号，以及历史授权、失败保留原文、迟到响应和分页。本次安装依赖时曾误并行操作同一卷，已停止相关容器并顺序重装成功，再验证最终结果。
- 当前保留的本机服务是 API/MySQL 检查环境，3300 没有 Web 社区页面；没有启动 gateway、旧 3000、ECS 或手机。正式 Web 环境需要按交接 02 继续准备，不将 API 端口当作完整社区入口。

## 边界与退出条件

- 本阶段工程检查已收口：本机锁定安装、类型/lint、24 项模型、3 项门禁验证、真实迁移/种子、7 项 reader/comment/version、账号收藏 API 及两套断网组件均通过，且远程三个 job 类型（静态含两个平台，共四个作业）成功。未包含 Android 原生构建、真机或恢复演练。
- 已提交推送 `f4ee3da` 至本端分支，推送前成功拉取远程 main，基线仍为 `3a17e22`；使用提交局部的 `Codex <codex@localhost>` 作者标识，没有更改全局 Git 配置。每次后续推送仍先拉取主线、核对同事业务报告并重跑受影响检查。用户未授权本端直接合并 main，分支保持独立。
- P1，共享前端依赖审计：本次既有 [Frontend checks](https://github.com/Xstly1014/Tako/actions/runs/41388352694) 的 `npm audit --audit-level=moderate` 失败；基线 [main/3a17e22](https://github.com/Xstly1014/Tako/actions/runs/41385497805) 同一步也失败。本机只读审计复核为 12 moderate、2 low、0 high/critical，未改包或锁文件。该项由主开发维护依赖范围，退出条件是在明确文件归属后修复相关依赖，并通过前端测试、类型、构建及 moderate 审计；合并评审及公开部署前必须跟进，不能把移动 CI 绿灯当作全仓库绿灯。
- P1，交接 02 的完整 Web/1000 账号/20000 作品初始化尚未在本机执行；本轮小规模 API 环境不能代替完整展示环境或压力测试。
- P0，移动体验交付前：账号/收藏/评论新包真机门槛继续保留。CI 不验证键盘、系统返回、安全存储或杀进程行为。

使用命令与测试分类见 [工具说明](../../scripts/mobile-checks/README.md)。新工具目录与新 workflow 由本分支维护，主开发合并前避免同时修改；共享业务、依赖和生成类型仍由主开发协调。
