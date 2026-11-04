# Tako 作者服务 Agent / 评测起步

解决作者的“原发布是否成功、当前为什么无法访问”咨询。仅消费已有本人接口，不保存或修改本机草稿，不替作者发布。当前是离线工程验证入口，尚未接入 App 或真实用户咨询。

从仓库根目录运行，Node 24.19.x（使用内置 SQLite）：

```powershell
npm ci --prefix agents/author-support --cache .runtime/tools/npm-cache
npm run test --prefix agents/author-support
npm run typecheck --prefix agents/author-support
node agents/author-support/scripts/live-probe.ts
# 付费，先将密钥写入忽略文件；不要放命令行参数或提交。
node --env-file=.runtime/author-agent/.env agents/author-support/scripts/live-probe.ts --model
```

真实探针要求已有 `127.0.0.1:3300/api` 测试服务和 MySQL，校验测试环境响应头，不自行启停服务、升级或清数据库。注册两个新合成账号，构造工作稿/预览/正式版/隐藏/跨账号场景。只有准备与清理脚本有写权限；模型只收到四个 GET 工具。退出时隐藏自己已跟踪的合成作品并撤销会话，保留草稿与审计。异常中断或清理失败须检查本次自有资源，不能清共享数据或认证计数。

`--model` 是一个开发试验，不是完整评测集。输出目录 `.runtime/author-agent/runs/<run_id>/`：`report.json` 留模型标识、用量、工具摘要和程序检查；`review.json` 只留本次合成问题与答案供人工复核。不会保存模型推理过程、原 HTTP 正文或认证凭据。普通 trace 不留标题、查询文本、正文，哈希仍属于本地受控诊断信息。正式用户数据不得直接套用合成 review 留存方式。

模型 API 为 DeepSeek 官方接口，借用其兼容的 OpenAI SDK；不调用 OpenAI 模型。禁用 SDK 自动重试，30 秒超时。模型别名会更新，记录 advertised name、响应 model 和 fingerprint，不宣称固定了不可变权重。

本地 SQLite 账本对本 runner 限制项目 ¥200、单 run ¥2；输入按峰时缓存未命中、输出按峰时估算。每次调用前预留，正常收到 usage 后结算。超时、无 usage、崩溃留下的未结算项会阻止后续付费请求，必须对照供应商账单核查，不能删除账本或改 run_id 绕过。请求字节上限加 framing 余量是保守工程估算，并非供应商 tokenizer 证明的绝对金额上限；此账本也不涵盖密钥在其他程序中的消费。

评分器只检查结构化主张与证据匹配，**不会判定自然语言全部正确、任务已解决或具备生产可靠性**；需要案例目标检查和人工复核。依据、范围与下一阶段见 [设计记录](../../docs/agent-evals/initial-design.md) 和 [阶段复盘](../../docs/reviews/author-agent-initial-review.md)。
