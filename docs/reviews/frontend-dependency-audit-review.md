# Frontend 依赖审计收口

2026-11-02，主开发；仅修复已存在的 Web 依赖门禁，不改变页面、HTTP 契约、Mobile 依赖或业务范围。

## 问题与策略

此前 frontend CI 持续卡在 `npm audit --audit-level=moderate`。本轮使用原锁实跑为 12 moderate、2 low，根源为 Nitro 的文件扫描/归档依赖，而不是 14 个独立可利用的业务漏洞。审计建议 force 降到 Nuxt 4.1.3，未采用；Nuxt 4.6.3、Nitro 2.13.5、Vue 和 Node 24 保持现有基线。

核对官方公告后，锁定 glob 14.0.2，给 readdir-glob 的 minimatch 定向 override 到 11.0.1；glob 自身解析到已修复的 minimatch 11.0.4。仅在 frontend 包范围生效。原 rolldown override 保留。锁文件由 npm 重新解析，不手拼、不修改 severity、不忽略生产依赖、不降低门禁。曾尝试按两个父依赖定向覆盖 glob，但原嵌套旧版本仍在锁中，审计仍有 6 moderate；最终统一 frontend 中的 glob，重新安装验证，未把中间结果算完成。

这些涉及间接依赖大版本，不能只用审计绿灯证明兼容。新增 `tests/dependency-compat.cjs` 纳入原 `npm test`：通过实际 Nitro 依赖解析，验证 archiver-utils 的 glob.sync 包含/排除、中文路径，archiver 的真实 ZIP entry 与格式，以及 node-file-trace 的动态资源路径发现。

## 已完成证据

- 独立空依赖卷执行 `npm ci` 成功；保留原本运行服务的依赖卷与数据库。
- 原 moderate 门禁通过：0 moderate/high/critical，7 low。12 项原 Vitest 同步测试通过；2 项上述真实依赖兼容测试通过，零 skip/todo。
- Nuxt typecheck、node-server 生产构建成功。没有为这次依赖变动声称做过真实邮件、生产部署或设备测试。
- 生产构建浏览器回归另行记录；远程 CI 结果须绑定本次实际推送 SHA，不能沿用旧失败/绿灯。

## 剩余风险与退出条件

P2：剩余 7 条 low 为 deepmerge 原型污染及其上游传播链，公告当前无 patched version；本次不称为零漏洞。涉及构建依赖配置合并，未证明产品 HTTP 接收用户对象后调用该库。维护方仍为主开发：每次依赖升级/公开部署前重跑审计并检查 Nitro/@rollup/plugin-node-resolve 对该依赖的替换或上游修复；出现修复版或可达不可信输入路径时立即升级/替换并复跑构建与消费者验证，公开部署前必须复核。这不是无限期忽略规则，未添加 audit ignore。

临时 overrides 在上游依赖范围覆盖修复版本后逐个移除，以干净 npm ci、原审计阈值、这两项兼容测试和生产构建全部通过为退出条件。此记录不覆盖 Mobile 的独立审计基线。

公告：[glob](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4)、[minimatch](https://github.com/advisories/GHSA-g3hv-75wg-m249)、[deepmerge](https://github.com/advisories/GHSA-gcqx-w48m-w2h4)。
