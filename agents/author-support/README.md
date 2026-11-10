# Tako 作者服务 Agent / 评测起步

解决作者的“原发布是否成功、当前为什么无法访问”咨询。仅消费已有本人接口，不保存或修改本机草稿，不替作者发布。当前是离线工程验证入口，尚未接入 App 或真实用户咨询。

从仓库根目录运行，Node 24.19.x（使用内置 SQLite）：

```powershell
npm ci --prefix agents/author-support --cache .runtime/tools/npm-cache
npm run test --prefix agents/author-support
npm run typecheck --prefix agents/author-support
# 使用现有本地测试作者会话查询；将占位标识换为该账号的真实标识。
node --no-warnings --env-file=.runtime/local-test/.env agents/author-support/scripts/check-author.ts --work <作品UUID>
node --no-warnings --env-file=.runtime/local-test/.env agents/author-support/scripts/check-author.ts --preview <原预览UUID>
# 显式读取答复给出的下一步。先审场景读取同一提交的当前状态。
node --no-warnings --env-file=.runtime/local-test/.env agents/author-support/scripts/check-author.ts --preview <原预览UUID> --follow-up
# 忘记原预览时，可从本人先审提交列表找 previewId。可按 --work 筛选或用 --cursor 继续。
node --no-warnings --env-file=.runtime/local-test/.env agents/author-support/scripts/check-author.ts --submissions
node --no-warnings --env-file=.runtime/local-test/.env agents/author-support/scripts/check-author.ts --case <处置编号>
node agents/author-support/scripts/live-probe.ts
# 付费，先将密钥写入忽略文件；不要放命令行参数或提交。
node --env-file=.runtime/author-agent/.env agents/author-support/scripts/live-probe.ts --model
# 新先审真实接口探针，需要本机既有测试运营凭据（只操作本次合成账号）。
node agents/author-support/scripts/live-probe.ts --pre-review
# 无模型：11个参考解检查，不算模型成绩。
node agents/author-support/scripts/suite.ts
# 开发对照：固定查询；加 --model 才配对运行当前 Agent。
node agents/author-support/scripts/compare.ts
node --env-file=.runtime/author-agent/.env agents/author-support/scripts/compare.ts --model
# 留出对照，每例三次。先仅验证固定查询，确认后再运行真实模型。
node agents/author-support/scripts/compare.ts --holdout
node --env-file=.runtime/author-agent/.env agents/author-support/scripts/compare.ts --holdout --model
# 付费：11个开发任务，真实模型＋受控transport，非真实HTTP/工单。
node --env-file=.runtime/author-agent/.env agents/author-support/scripts/suite.ts --model --json-mode
# 可选 --case ambiguous，仅运行指定任务；不因重跑覆盖原run。
node agents/author-support/scripts/replay.ts .runtime/author-agent/suites/<run_id>/<case_id>.json
node agents/author-support/scripts/review.ts .runtime/author-agent/suites/<run_id> .runtime/author-agent/my-review.json
# 零模型费用：原始模型输出经过当前交付校验，写入独立新目录。
node agents/author-support/scripts/delivery-replay.ts .runtime/author-agent/suites/<run_id>
```

真实探针要求已有 `127.0.0.1:3300/api` 测试服务和 MySQL，校验测试环境响应头，不自行启停服务、升级或清数据库。注册两个新合成账号，构造工作稿/预览/正式版/隐藏/跨账号场景。只有准备与清理脚本有写权限；模型只收到四个 GET 工具。退出时隐藏自己已跟踪的合成作品并撤销会话，保留草稿与审计。异常中断或清理失败须检查本次自有资源，不能清共享数据或认证计数。

`--model` 是一个开发试验，不是完整评测集。输出目录 `.runtime/author-agent/runs/<run_id>/`：`report.json` 留模型标识、用量、工具摘要和程序检查；`review.json` 只留本次合成问题与答案供人工复核。不会保存模型推理过程、原 HTTP 正文或认证凭据。普通 trace 不留标题、查询文本、正文，哈希仍属于本地受控诊断信息。正式用户数据不得直接套用合成 review 留存方式。

模型 API 为 DeepSeek 官方接口，借用其兼容的 OpenAI SDK；不调用 OpenAI 模型。禁用 SDK 自动重试，30 秒超时。模型别名会更新，记录 advertised name、响应 model 和 fingerprint，不宣称固定了不可变权重。

本地 SQLite 账本对本 runner 限制项目 ¥200、单 run ¥2；输入按峰时缓存未命中、输出按峰时估算。每次调用前预留，正常收到 usage 后结算。超时、无 usage、崩溃留下的未结算项会阻止后续付费请求，必须对照供应商账单核查，不能删除账本或改 run_id 绕过。请求字节上限加 framing 余量是保守工程估算，并非供应商 tokenizer 证明的绝对金额上限；此账本也不涵盖密钥在其他程序中的消费。

评分器只检查结构化主张与证据匹配，**不会判定自然语言全部正确、任务已解决或具备生产可靠性**；需要案例目标检查和人工复核。依据、范围与下一阶段见 [设计记录](../../docs/agent-evals/initial-design.md) 和 [阶段复盘](../../docs/reviews/author-agent-initial-review.md)。

批次报告位于 `.runtime/author-agent/suites/`，保留案例摘要、代码/策略/锁文件哈希、真实模型标识与用量、每次工具投影、最终答案和失败前已完成的步骤。不保存模型推理或原HTTP正文；仅允许本目录预定义的合成场景，不将真实用户数据直接写入这类人工复核包。模型不得看到 `reference`/expected/评分器，参考解仅供夹具验证和人工判定。

开发对照写入 `.runtime/author-agent/comparisons/`。两个方案分别读取相同的合成初始状态，每轮用同一证据门禁、交付函数及最多 8 次只读工具调用。收到要求补标识的下一步才输入脚本中的用户补充；第二轮带上原始用户问题和补充信息。报告分别保留原提案检查、交付检查、实际答复和人工复核状态。固定流程的原提案文字只是交付模板的输入，文字评分以用户实际收到的答复为准。

`replay`不调用模型，按当前评分器重算原证据，显示原评分器版本，不覆盖旧成绩。案例变化或答案/证据绑定不一致时拒绝；哈希是本地一致性检查，不是防篡改签名。`review`输入需包含run_id、reviewer和items，每项为case_id、review_binding、四个布尔criteria（factual/answers_question/advice_safe/uncertainty）及notes；不会默认判通过，不覆盖已有human-review.json。程序通过但人工不通过，仍不能算业务通过。记录复核者身份，不冒充独立双人标注。

首批原始失败、改动与成本详见 [多任务复盘](../../docs/reviews/author-agent-development-suite-review.md)。当前仍有失败，测试工具与真实接口通过不代表Agent可上线。共享CI归主开发维护，本包先提供可独立执行的本机门禁。

回答校验入口为 `src/diagnostic.ts` 的 `diagnose`，调用方只展示顶层 `delivery.verdict`；`trial` 是评测诊断数据，不是对用户的答复。无论正常结束或推理未完成，均有明确的 delivery。先核对原资源/状态证据和可用下一步，再用受控事实文字生成解释，**不转发模型自由解释**。格式错误、冲突证据、无目标的导航等返回 `fallback`，不自动修复或重试模型，不发起业务写入。尚未接App/HTTP产品入口，不能直接拿CLI接口宣称上线；接可切号客户端前须补输出时的会话代次复核。

`suite`分别保存原模型grade、delivery和delivery_grade，不把回退计作任务成功；任一目标失败退出非0。`delivery-replay`只接收原合成开发批次，验证原案例与证据绑定，不接收无来源的聊天答案；写入 `.runtime/author-agent/delivery-runs/`，不覆盖原批次。对该目录运行原 `review`，复核的是最终交付文本；对原suite目录运行review，复核的仍是原模型输出，二者不能混称。

程序检查和模板不是对所有错误的证明。当前语境解析只支持既有中文标识写法；缺少或冲突标识保守回退，不能声称支持任意自然语言实体解析。测试里的SDK client注入是可信测试代码依赖，不是模型工具参数，也没有生产CLI改供应商地址的选项。成本不明仍保持账本阻断，真实供应商对账恢复未验。结果及退出门槛见[回答校验复盘](../../docs/reviews/author-agent-delivery-review.md)。

交付的 `recovered` 只允许对已引用、无矛盾且资源匹配的证据修正结论或下一步，记录原拒绝原因与 corrected_fields，再经原事实校验。原提案与交付分开保存。伪造引用、跨资源、矛盾快照及 401/403 不会拼接补救。`verification` 分别为 facts_checked、needs_clarification、unable_to_check。v3 在作者已选定作品后去掉同名候选的歧义提示。

`delivery.next_step`是消费方执行的只读下一步，不是任意URL、模型新工具或自动轮询。`follow-up.ts` 的 `followUp(step, session.authorized)` 只调用已有原预览、作品状态或本人提交记录GET；提交详情经既有解码器校验后只投影状态元信息，不输出正文、标题、处置理由或候选版号。每次重新按当前会话授权，404不揭示归属，401要求重新确认身份。contact_support只返回操作提示，不发送消息。交付函数不执行下一步，当前尚未接App按钮或新HTTP路由。

交付 v4 在输入作品状态与原预览正式发行回执均可读取时识别跨作品标识冲突，返回 `provide_identifiers`，要求作者重新核对同一次操作的两个标识。此步骤不发请求。真实探针覆盖可读冲突、不可读标识、另一账号与修正后的只读详情。

先审的next_step指向具体submission_id；其当前状态与原预览的历史受理回执分开。真实测试覆盖pending→withdrawn后原回执不变、其他账号拒绝。具体证据、数据来源及下一阶段见[部分事实与下一步复盘](../../docs/reviews/author-agent-recovery-review.md)。

费用恢复（命令从仓库根执行，无需密钥）：

```powershell
node agents/author-support/scripts/budget.ts pending
node agents/author-support/scripts/budget.ts inspect <charge_id>
# 核对request_sha256、供应商response_id、token用量和原费率后，显式指定回执摘要。
node agents/author-support/scripts/budget.ts reconcile <charge_id> <receipt_sha256> local_operator
```

每个新推理请求先持久化预留、请求摘要与费率，再调用供应商；收到的ID/模型/用量先持久化，再结算。inspect不提供请求或响应正文。reconcile只消费本地已关联的供应商usage回执，事务保留prior_state/原调用/金额和操作代号；重复执行返回原结果，不清记录，也不能用另一请求的回执抵账。actor是本机操作代号，不是认证身份。旧未完成调用若缺回执依旧阻断；余额变化、猜测零费用、改run_id或恢复旧账本均不能解锁。结算是保守usage费用估算，不是控制台账单/发票核销。

真实演练会消费少量模型额度，不进默认CI：

```powershell
node --env-file=.runtime/author-agent/.env agents/author-support/scripts/provider-loss-drill.ts
```

该命令使用官方API完成一次真实响应后在传输层刻意丢弃，只留用量元信息；验证重启阻断、匹配回执恢复和一次续跑。SDK禁重试，不调用业务工具。报告及账本一致性备份仅在忽略目录accounting-runs；不要用备份倒退费用。若失败且没有可用回执，保留阻断并按供应商逐请求证据人工核查，不删库重跑。

新suite从source bundle归档精确源码（包括未提交改动）、共享解码器、锁和Node版本，旧run不会凭当前代码补造原快照：

```powershell
node agents/author-support/scripts/reproduce.ts .runtime/author-agent/suites/<run_id>
```

仅用于本机生成且可信的源码包；哈希检查不是签名，不执行不明下载包。命令还原到临时目录，要求相同Node版本与锁/直接依赖版本，复用当前node_modules，移除密钥和代理凭据并禁用fetch/HTTP/socket入口，运行单测与类型检查。它不是OS沙箱、全新依赖安装或跨机复验，也不能锁定滚动模型权重。只归档白名单源文件，拒绝路径穿越/符号链接；不含.env、简历、账本或业务正文。阶段结果见[费用与复现记录](../../docs/reviews/author-agent-accounting-review.md)。
