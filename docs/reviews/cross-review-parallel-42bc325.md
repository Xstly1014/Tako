# 并行端交叉审查：C1-A 与并发修复 42bc325

2026-11-02（Asia/Shanghai）。审查者：并行端；作者：主开发。被审整合提交 `42bc325`，授权实现 `33c15b2`、并发修复 `1fbc874`，比较基线为已审的 C1 核心 de49a17 与上轮共享整合 59694d6。已读主开发进度、授权规格和复盘；未借用其测试结论作为本端证据。

## 结论与范围

在选定范围内未确认新的 P0/P1 缺陷；上轮确定 P2“两个同步器基于旧读取多建恢复副本”已独立复核解决。审查覆盖 access/authorized/native、Session/context 和 sync 的新增差异、相关仓储/会话/服务模型，以及本端 M1/C2 的既有消费方。不是全量安全审计、尚未发布的编辑页审查或 Android 设备验收。

## 上轮 P2 修复复核

1fbc874 在事务内重查最新 dirty、serverId、baseRevision，且在没有 pending 时返回 saved/pending；内容相同快路径也检查读取对应身份及基础修订。主开发新增两个有 Promise 闸门的反例，覆盖快实例已保存，以及快实例已恢复后又编辑的情形。

本端在隔离 detached worktree 42bc325 中，独立重建上轮原复现顺序，而非只运行作者新断言：慢实例先取得 R1 并停住，快实例完成新文字保存后再放行慢实例。现在慢实例返回 saved，服务稿仍一份，本机仍指向原 serverId。原本期望 recovered/两份的缺陷不再出现。67 项完整模型中真实冲突、恢复期间新输入、原请求重放和新增双实例用例均通过。由本审查关闭旧报告的这一条 P2；旧报告仍绑定原 de49a17，不改标为已审新代码。

## 授权与持久化核对

- token 与 grant 同一个 SecureStore envelope，旧字符串 token 只可联网迁移；grant 匹配本次 token/owner，新登录重置为未确认。没有新增正文、密码或令牌副本。
- restore 网络/503 可保留此前已确认同会话的离线本机许可，但 Session 仍 offline/account=null，authorized HTTP 不放行。契约/环境错误不自动授予许可。
- logout 先写锁定，再请求服务端；写锁失败不发注销，网络失败保留会话供重试但本机草稿不可读。401 路径先隐藏，再尝试持久锁定及删除；未把存储失败报成成功退出。所有安全写入/删除均失败的物理介质边界如实保留，不声称跨断电可靠。
- AuthorizedDrafts 从当前 Session 派生 owner，确认前/忙碌/锁定不打开仓储；打开/解密返回再次校验代次。raw 原生工厂已变为内部函数。已开始的本机写入可能最终留在原账号密文，结果不交付给新身份，符合保留本机输入的规格。

独立追加故障实验：在真实 createDraftSessionVault 模型中延迟 confirm 的安全项写入；该写入尚未结束时，让此前已发出的 authorized 请求返回 401，然后释放写入，并令 remove 固定失败。确认请求被拒绝，最终 guest/locked，保留项 confirmed=false；另建断网 Session 重开后仍 locked。该确定顺序实验验证晚到确认写入不会盖过随后串行落盘的锁定；安全项是可控内存适配器，不是原生 SecureStore。

## 本端消费者与门禁验证

本轮将本端作者管理/发布组件夹具的 Session 从旧简单 Vault 切换为真实 createDraftSessionVault，保留内存安全项、模拟 HTTP/DOM。两个实际产品入口均在 drafts=confirmation 时完成既有服务端操作，证明新增本机草稿确认不会误阻断 M1/C2 服务器业务。

新增确定场景：

- 作者管理：确认本机许可后断网 restore，Session drafts=offline，旧私有版本隐藏、零管理 HTTP/动作；联网按钮恢复后只读重载本人列表/版本，未补发管理动作。
- 发布：已有结果未知的最小 journal，经只读恢复后获得确认；确认本机许可再断网 restore，原快照/结果隐藏、零 publication HTTP，journal 不变。联网按钮只 GET 原预览并恢复原 V1，不新增发布。新入口与旧 journal 优先级及切号仍继续验证。
- 管理/发布 HTTP 尝试在模拟路由 abort 之前计数，避免把“请求发了但网络失败”误称为“没有发送”。离线身份检查只请求 /me；原业务请求不会凭本机草稿许可执行。

本机 Node 24.19.0/Windows：类型、lint、OpenAPI 一致性、67 项模型、10 项顺序真实 MySQL/API 服务组、5 项门禁与四套 Linux Docker 断网组件全部通过，零 skip/todo。真实服务测试使用主开发新 Vault/授权门面；不把可控安全存储或故障适配器算真机。组件 HTTP 是模拟服务，不冒充真实数据库层。远程结果随本端实现提交记录在 parallel-ci-results。

本端夹具/审查实现 73bdd19 的 [Mobile](https://github.com/Xstly1014/Tako/actions/runs/41431219962) 四作业与 [Backend](https://github.com/Xstly1014/Tako/actions/runs/41431220010) 全部 success；本次被审主开发源码仍固定为 42bc325，不把未来源码自动视为已审。后续只补证据的文档提交不改变该源码。[Frontend](https://github.com/Xstly1014/Tako/actions/runs/41431220172) 仍失败在既有 moderate audit，未称全仓库绿灯。

## 不关闭的边界与移交

- 主开发继续 C1-B/C1-C，实际恢复确认、列表/编辑、退出提醒和 push 发布/返回输入保护未实现；本轮不声称手机创作闭环完成。主开发新增测试发布后由本端更新必要分类，保持 Session phase/account/generation/authorized 加法兼容。
- P0，真实移动作者使用前：原生 envelope/SecureStore/SQLite、杀进程、切号、输入与系统返回设备验收；工程证据不能关闭该门槛。物理存储拒绝全部写入/删除时，需要恢复存储后完成锁定/注销或在线重新验证，不能宣称安全退出已持久化。
- P1，既有 frontend moderate audit，维持原负责人及修复/验证退出条件；本端不自行改共享锁或部署。
- 原瞬时服务预检/组件失败本轮未再出现；依然没有确认原根因，不将本轮全通过抹掉历史失败。
