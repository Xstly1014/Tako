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
# 新先审真实接口探针，需要本机既有测试运营凭据（只操作本次合成账号）。
node agents/author-support/scripts/live-probe.ts --pre-review
# 无模型：11个参考解检查，不算模型成绩。
node agents/author-support/scripts/suite.ts
# 付费：11个开发任务，真实模型＋受控transport，非真实HTTP/工单。
node --env-file=.runtime/author-agent/.env agents/author-support/scripts/suite.ts --model --json-mode
# 可选 --case ambiguous，仅运行指定任务；不因重跑覆盖原run。
node agents/author-support/scripts/replay.ts .runtime/author-agent/suites/<run_id>/<case_id>.json
node agents/author-support/scripts/review.ts .runtime/author-agent/suites/<run_id> .runtime/author-agent/my-review.json
```

真实探针要求已有 `127.0.0.1:3300/api` 测试服务和 MySQL，校验测试环境响应头，不自行启停服务、升级或清数据库。注册两个新合成账号，构造工作稿/预览/正式版/隐藏/跨账号场景。只有准备与清理脚本有写权限；模型只收到四个 GET 工具。退出时隐藏自己已跟踪的合成作品并撤销会话，保留草稿与审计。异常中断或清理失败须检查本次自有资源，不能清共享数据或认证计数。

`--model` 是一个开发试验，不是完整评测集。输出目录 `.runtime/author-agent/runs/<run_id>/`：`report.json` 留模型标识、用量、工具摘要和程序检查；`review.json` 只留本次合成问题与答案供人工复核。不会保存模型推理过程、原 HTTP 正文或认证凭据。普通 trace 不留标题、查询文本、正文，哈希仍属于本地受控诊断信息。正式用户数据不得直接套用合成 review 留存方式。

模型 API 为 DeepSeek 官方接口，借用其兼容的 OpenAI SDK；不调用 OpenAI 模型。禁用 SDK 自动重试，30 秒超时。模型别名会更新，记录 advertised name、响应 model 和 fingerprint，不宣称固定了不可变权重。

本地 SQLite 账本对本 runner 限制项目 ¥200、单 run ¥2；输入按峰时缓存未命中、输出按峰时估算。每次调用前预留，正常收到 usage 后结算。超时、无 usage、崩溃留下的未结算项会阻止后续付费请求，必须对照供应商账单核查，不能删除账本或改 run_id 绕过。请求字节上限加 framing 余量是保守工程估算，并非供应商 tokenizer 证明的绝对金额上限；此账本也不涵盖密钥在其他程序中的消费。

评分器只检查结构化主张与证据匹配，**不会判定自然语言全部正确、任务已解决或具备生产可靠性**；需要案例目标检查和人工复核。依据、范围与下一阶段见 [设计记录](../../docs/agent-evals/initial-design.md) 和 [阶段复盘](../../docs/reviews/author-agent-initial-review.md)。

批次报告位于 `.runtime/author-agent/suites/`，保留案例摘要、代码/策略/锁文件哈希、真实模型标识与用量、每次工具投影、最终答案和失败前已完成的步骤。不保存模型推理或原HTTP正文；仅允许本目录预定义的合成场景，不将真实用户数据直接写入这类人工复核包。模型不得看到 `reference`/expected/评分器，参考解仅供夹具验证和人工判定。

`replay`不调用模型，按当前评分器重算原证据，显示原评分器版本，不覆盖旧成绩。案例变化或答案/证据绑定不一致时拒绝；哈希是本地一致性检查，不是防篡改签名。`review`输入需包含run_id、reviewer和items，每项为case_id、review_binding、四个布尔criteria（factual/answers_question/advice_safe/uncertainty）及notes；不会默认判通过，不覆盖已有human-review.json。程序通过但人工不通过，仍不能算业务通过。记录复核者身份，不冒充独立双人标注。

首批原始失败、改动与成本详见 [多任务复盘](../../docs/reviews/author-agent-development-suite-review.md)。当前仍有失败，测试工具与真实接口通过不代表Agent可上线。共享CI归主开发维护，本包先提供可独立执行的本机门禁。
