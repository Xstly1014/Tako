# 并行端交叉审查：C1 核心 de49a17 与授权接入规格

日期：2026-11-02（Asia/Shanghai）。审查者：并行端；作者：主开发。被审源码 `de49a176a75abff0052c8086d6a541e6b5c23cc8`，授权规格为 `59694d6` 的 `docs/mobile-draft-access-spec.md`；本端已从 c905d7a 快进至 59694d6，C1 核心没有增量源码变化。

后续复核：主开发在 1fbc874 修复本报告的双实例 P2，并行端已在整合提交 42bc325 独立重建原复现，确认不再多建副本。该条关闭，证据见 [新 SHA 审查](cross-review-parallel-42bc325.md)。本文保留原被审版本的触发与证据，不把新代码自动改标为旧审查通过。

## 结论和实际范围

已核对 `mobile/src/drafts/{model,storage,sqlite,native,api,sync}.ts`、仓储/同步/真实服务测试与 C1/C2 接口。现有账号绑定加密、事务失败保留、原请求落盘、同实例互斥、切号迟到回执和恢复期间新编辑的核心策略与既定规格一致。未确认 P0/P1 缺陷；确认下述 P2 并发边界，需在编辑接入时解决或证明调用约束已排除。

这不是尚未发布的授权实现审查，也不是原生存储/锁屏/设备安全验收。本端不接管 C1/auth。没有把底层仓储接受 owner 参数误当成已完成授权：未来页面必须通过主开发的授权包装入口；密钥存在不能授予读取资格。

## [P2][确定缺陷] 不同同步器实例可能基于过时读取创建多余恢复副本

位置：`mobile/src/drafts/sync.ts:14` 的 busy 集合属于实例；`:43` 开始的读取与 `:58` 起的事务之间，`:61` 仅重查 pending，`:62` 将旧 server.revision 与最新 baseRevision 比较，没有重查最新 dirty 或该次读取对应的服务器身份/基础修订。

触发：同账号、同本机记录由两个 DraftSynchronizer 实例同步。先让慢实例读取旧服务器 R1 并挂起返回；快实例完成当前本机文字的 save，记录变为 clean/R2/pending=null；再让慢实例继续。慢实例进入事务时拿到已保存的最新记录，但仍拿旧 R1 判断冲突，于是发 recover，创建第二份完全不必要的稿件，并把本机 serverId 切到该副本。

影响：原稿和最新文字均保留，本次实验证据不支持“丢稿/越权”的说法；但用户会看到多余副本，工作稿身份发生无必要迁移，也不满足同一记录串行同步的规格。当前 App 调用点尚未实现，所以不称已复现线上用户事故；列表、编辑及恢复重建同步器时应排除此触发条件。

证据：在隔离 detached worktree de49a17 中，13 项已有仓储/同步模型测试通过，零 skip/todo；另外使用作者已有的真实 Node SQLite/AES-GCM `fixture()` 和合成 `TestApi`，构造两个实例及 Promise 闸门确定复现顺序；不是依赖计时的概率测试。过程如下，可直接用现有 helpers 复现：

1. 新建本机稿并用快实例 sync 到 R1；edit seq=1，产生 seq=2 的新文字。
2. 慢实例复用同一个 repo 和 identity，包装 api.read：先保存真实返回值，通知 ready，然后等待 gate，最后返回保存的 R1。
3. 启动慢实例 sync，等待 ready。
4. 用快实例 sync；断言 state=saved，服务稿数量=1。
5. 放开 gate；慢实例返回 recovered，服务稿数量=2，本机 dirty=false、正文仍为 seq=2 的合成文字。

最小复现关键片段（其余 setup 复用 `mobile/tests/helpers/drafts.ts`）：

```ts
const slow = new DraftSynchronizer(repo, {
  me: () => api.me(),
  read: async id => {
    const stale = await api.read(id);
    arrived(); await gate;
    return stale;
  },
  write: pending => api.write(pending),
}, identity, randomUUID);
const late = slow.sync(owner, localId);
await ready;
assert.equal((await fast.sync(owner, localId)).state, "saved");
release();
assert.equal((await late).state, "recovered"); // 目前多余恢复
assert.equal(api.drafts.size, 2);
```

建议/退出条件：由主开发选择同一记录跨入口共享同步协调器，或在创建 pending 前重新判断最新 clean 状态并确认读取仍适用于最新 serverId/baseRevision；不能只再加一个页面按钮禁用。补确定顺序的双实例回归，预期只保留一个服务稿且本机仍指向原稿；同时原请求重放、真正远端冲突和新输入保留测试继续通过。本端未直接修改同步器或在常规门禁中加入“期待缺陷存在”的断言。

## 授权规格的接入审查

主开发的 59694d6 规格保留了用户确认的边界：主动退出/明确失效后持久化锁定、同账号在线重登后主动恢复、未退出旧会话才允许匹配的离线续写、安全状态写失败不报告完成。没有发现需要改变业务权利的歧义；具体写入顺序尚未实现，不能预先认定安全。

接入后需检查三处具体条件：

- logout 服务端已成功但安全状态落盘失败时，界面立即拒绝私稿访问；重启断网不能凭旧缓存恢复。失败路径须以落盘快照及会话失效模型证明，不能只有文案。
- 不同账号/代次的恢复和密钥读取迟到，不得解锁当前视图；离线授权记录必须与本次已持久化会话绑定，而非只比较 owner。
- C1→C2 同时检查当前输入、正在保存/同步、record.dirty/pending 和服务器确认字段。已有 recovered+dirty 的模型证据应进入实际编辑页允许/拒绝测试；返回不得覆盖新输入。

以上是对未来接线的验收条件，不伪造为当前核心缺陷。保持 Session 现有公开方法、snapshot/account/generation 消费兼容；如必须变更，先发布最小接口差异，本端再调整 M1/C2。

## 对主开发审查请求的回应

已读取 `cross-review-primary-c905d7a.md`，接受其关于首次瞬时失败的证据边界。本端本轮维护门禁的安全诊断：服务预检区分连接、HTTP/环境、JSON 与种子形状；组件保留固定白名单阶段与进程退出/超时信息；失败测试只报告已分类文件及行列。不转发原始异常、标题/正文、凭据、响应或断言值，不加自动重试、不跳过失败。

尚未复现主开发当时的瞬时根因，不能把“诊断更清楚”记成“随机失败已修复”。若再次出现，应记录本轮新增安全诊断、准确 SHA 与检查层级，再针对该原因处理。验证结果与发布提交见本端 `parallel-ci-results.md`；本报告不会被后来代码自动改标为已审查。
