# 并行端交叉审查：C1-B/C 9653d74

2026-11-02（Asia/Shanghai）。审查者：并行端；作者：主开发。被审提交 9653d74，比较前次已审 42bc325；本端已从 5f153c3 快进至该整合树。关联规格为 mobile-drafts-spec、mobile-draft-access-spec、mobile-draft-publication-handoff-spec 和本端 c1-c2-interface。未将主开发的通过报告当作独立证据。

## 结论与范围

未确认新的 P0/P1 阻塞问题；确认下述 P2 编辑竞争缺陷，交主开发在其范围修复。CI 接入可独立推进，不将该局部失败夸大成已丢稿或越权。审查覆盖 workspace、Editor/List/AccessGate、草稿路由、native facade、Session 加法接口、账号退出触点与 C1→实际 C2 夹具；不是全量外观或设备安全审计。

发布票据在实际点击时复验在线身份、本机已确认记录与服务器修订，随后再次核对本机；票据按对象身份绑定编辑器、seq、服务器修订与代次且一次消费。R1/R2 不偷换，本机正文不传 C2。resume 不 POST、不提升 baseRevision，load 用 record 对象前后比较保护期间已完成的新保存。消费方沿用既有 Session/generation，reconnect 不绕过锁定，pendingDraftCount 的异步结果也核对归属/代次。

已读实际安装 Expo Router 58 的 `react-navigation/core/usePreventRemove.js`：返回禁用函数以及 repeat 的调用确实存在；这只能支持 API 使用方式，不能据此宣称系统返回体验通过。C1 编辑器通过 AccessGate 隐藏锁定输入，但保留实例和未暂存 guard，原账号恢复前不能把输入交给另一账号。

## [P2][确定缺陷] 另存期间继续输入可让旧保存任务打断已切换的副本

位置：`mobile/src/drafts/workspace.ts:85` input 无条件启动 save；`:94` save 复用 this.writing，异步失败回读使用当时的 this.localId；`:124` saveAsCopy 在 await create 后于 :131 切换 localId，再于 :133 调用 save。

触发顺序（在隔离 detached worktree 9653d74、真实 Node SQLite/AES-GCM helper 中确定复现）：

1. 编辑器持有原稿 seq1；另一窗口先保存原稿到 seq2。当前输入因 CAS 冲突留在内存，用户选择“另存本机副本”。
2. 副本 create 已提交，但延迟其返回；此时编辑器尚指向原稿。
3. 用户继续输入，input 启动一个仍针对原稿的 save；用 Promise 闸门停在 local.edit，尚未返回冲突。
4. 放开 create，saveAsCopy 将 localId/record 切到新副本，随后 save 复用步骤 3 的 this.writing。
5. 放开旧 local.edit；它因原稿 seq 冲突失败。saveAsCopy 随之 reject，onCopied 不执行，路由仍为旧 ID，但编辑器内部已经指向新副本，最新输入尚未落盘。

实际断言：原稿保留另一窗口文字；副本保留另存开始时的文字；当前内存保留继续输入，hasUnstored=true；另存 Promise 为 DraftError。显式再次 editor.save 后，最新输入可以存入新副本。没有证据表明本实验静默丢字、覆写原稿或跨账号泄漏；当前未暂存返回保护仍有效。

建议：让“创建副本→切换目标→排空当前最新输入”与 input 的保存共用协调，或在创建副本期间仅合并内存输入、随后在新目标保存；每个旧写任务的失败回读也应使用其捕获的目标 ID，不能跟随可变 localId。不要只吞掉另存的错误或提前报成功。

退出条件：补确定顺序回归，另存过程中持续输入后 Promise 正确返回副本 ID、路由进入该副本、最新输入已落盘且 hasUnstored=false；原稿与原请求保留、零额外 HTTP。由主开发回应/修复后，本端按新 SHA 复验，未在本轮接管其代码。

## 本端独立验证与 CI 接入

- 85 项模型、11 项顺序真实服务、类型/lint、OpenAPI 一致性通过，零 skip/todo。服务包含真实 MySQL/API/Node SQLite 与 C1 票据→固定预览→正式发布→匿名读取→只读返回；可控安全项仍不等于原生 SecureStore。
- 原四套断网组件与主开发独立 `node scripts/check_mobile_drafts.cjs` 均在本机通过；实际 C1 路由覆盖原型双入口、恢复/失败/另存/退出，以及真正 PublishRoute/Workspace 的 R1/R2、发布返回和旧 journal 优先。夹具的 HTTP、导航、存储仍为适配器，不当成真机。
- 本端工作流新增独立必跑步骤调用该 C1 CLI，复用已锁定依赖卷与禁网执行。没有复制路由夹具或改主开发脚本，没有 continue-on-error、条件跳过或测试重试。
- 新增该 CLI 的子进程故障/脱敏门禁测试，固定阶段/行号可见、未知阶段降为 unavailable、失败/超时非零、成功只输出固定通过；原始正文/凭据哨兵不泄漏。6 项门禁行为测试通过。actionlint 通过。

## 证据边界与移交

新增 C1 步骤是否已远程执行，以本轮实际 CI SHA/step 为准，不能用此前四套组件作业绿灯关闭该尾项；结果见 parallel-ci-results。预推送又合入主开发仅文档的 0e1e60e，已读其 9653d74 最终 APK 声明，但本端未独立核验另一台电脑产物，不将 b2cea9d 旧包说成新 C1-C。被审业务源码无新增差异。原生输入/返回/杀进程、账号/密钥恢复设备 P0 与既有 frontend moderate audit P1 仍由原责任方按原退出条件关闭，主开发已明确下一步处理审计。
