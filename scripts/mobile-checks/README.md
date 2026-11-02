# 移动端独立检查

从仓库根目录执行，Node 固定 24.19.0。工具依赖单独锁定，不修改 App 依赖。生成器 openapi-typescript 7.10.1 的 peer 要求 TypeScript 5，因此工具使用 5.9.3；App 继续使用原有 TypeScript 6。

```powershell
npm ci --prefix mobile --no-audit --no-fund
npm ci --prefix scripts/mobile-checks --no-audit --no-fund
node scripts/check_mobile_contract.cjs
node --test scripts/mobile-checks/checks.test.cjs
npm run typecheck --prefix mobile
npm run lint --prefix mobile
node scripts/check_mobile_tests.cjs model
```

本机 npm 全局缓存不可写时，给 npm 命令增加 `--cache .runtime/npm-cache`；不需要管理员权限或改全局 npm 配置。

契约检查在系统临时目录重新生成声明，通过 TypeScript 语法树打印后比较，忽略换行、缩进和注释，不忽略类型差异。不写回源码；漂移、生成失败和依赖缺失均返回非零。工具测试验证漂移拒绝、坏规格拒绝、无写回，以及服务前置保护。前置保护的 fetch 夹具仅测试门禁失败，不计入真实服务结果。

`model` 运行 session/comments/versions/author-works/publications/drafts 的模型与本机 SQLite/加密故障检查。`service` 运行 reader/comments/versions/author-works/publications/drafts 的服务组检查，其中包括真实 HTTP 与读者失败响应测试；当前文件分类以 runner 为准，实际数量以输出为准。服务文件串行执行，遵守服务端两槽密码 CPU 限制，不通过调高业务限流来适配测试。新增 `.test.ts` 文件若未分类、或已分类文件缺失，命令会失败，避免遗漏新测试。两种命令都拒绝空测试、skip、todo 和失败。Node SQLite/WebCrypto 不等于 Expo 原生存储验收。

成功只输出计数；失败额外输出安全 `DIAG`：进程退出状态与固定原因（如 timeout、executable_missing），以及 TAP 中已分类测试文件的行列。不转发测试名称、原始路径、正文、错误消息、断言值或堆栈。服务预检区分 connect、environment、community-json、seed 阶段；只保留数字 HTTP 状态及 test/not_test 判定，不打印响应头值、响应正文或 URL 参数。预检失败仍不会启动业务测试，不会自动重试或降级 mock。诊断投影与哨兵脱敏通过真实 CLI 失败夹具验证；这些故障注入不是业务服务验收。

## 真实 MySQL/API

已有完整 3300 环境时直接运行：

```powershell
node scripts/check_mobile_tests.cjs service
node scripts/mobile_account_acceptance.cjs
```

这两条会正常创建合成账号及业务数据，只能用于独立测试环境。服务门禁固定 `127.0.0.1:3300`，覆盖继承的 API URL，先检查 test 标记、非空作品、标签和下一页；服务缺失或种子不足直接失败，不跳过、不切换 mock。

全新隔离机器先按交接 02 初始化、迁移、造数。CI 使用同一 `local_test.py` 和真实 MySQL，但只造 10 账号/60 作品供分页及互动验收，不构建无关 Web。为 API 临时增加端口的命令为：

```powershell
docker compose --project-directory "$PWD" --env-file .runtime/local-test/.env -f infra/compose.local-test.yaml -f scripts/mobile-checks/compose.ci.yaml up -d --wait --wait-timeout 180 api
```

这个 override 只用于新建隔离环境的 API 检查，不能和已经占用 3300 的正常 gateway 同时启动；不自动停止现有服务来抢端口，也不是生产部署配置。CI 跑完 down，不删卷或上传配置/日志/账号夹具。

若镜像能拉取但工具容器下载依赖报 EOF，先检查容器是否需要继承已有网络代理。引擎代理与容器代理分别配置，见 [Docker 官方说明](https://docs.docker.com/engine/cli/proxy/)。本机复验只在当前 PowerShell 进程读取已有代理并传入容器，没有打印地址或改全局配置：

```powershell
$taskProxy = docker info --format '{{.HTTPSProxy}}'
$env:HTTPS_PROXY = $taskProxy
$env:HTTP_PROXY = $taskProxy
# 在原有 compose run 参数中加 -e HTTP_PROXY -e HTTPS_PROXY，执行迁移/造数。
# Dockerfile 构建可增加 --build-arg HTTP_PROXY --build-arg HTTPS_PROXY。
```

只在已有代理确实可用时使用；不要硬编码原电脑地址或关闭 TLS/Go 校验和验证。预定义代理 build args 的行为见 [Docker 构建文档](https://docs.docker.com/build/building/variables/#proxy-arguments)。公共 GitHub runner 默认使用正常网络，不依赖这些本机参数。

## 组件与流水线

组件检查复用同事维护的评论与历史阅读脚本，并增加本端作者管理、发布页面夹具，不修改同事脚本。先按 [原脚本说明](../mobile-comments-ui/README.md) 安装两个依赖卷，再运行：

```powershell
node scripts/check_mobile_components.cjs
# 也可单独运行 comments、versions、author 或 publication：
node scripts/check_mobile_components.cjs versions
# 独立 C1 草稿编辑与实际发布/返回路由：
node scripts/check_mobile_drafts.cjs
```

新入口用空目录遮住宿主 mobile/node_modules，并让所有脚本统一从 Docker 的 /app/node_modules 解析依赖，解决宿主与容器重复 React 的 Hook 错误。四个夹具均在 `--network none` 下运行，失败返回非零且不输出可能含正文的断言。失败时 wrapper 从既有脚本输出中仅提取白名单阶段，例如 publication 的 remount-read-only；未知阶段为 unavailable，原始输出、页面错误和截图不转发。阶段白名单在 `diagnostics.cjs`，新增/改名阶段需同步维护。超时等没有阶段时仍报告安全的进程原因。生成的失败截图只在忽略目录。组件证据不等于真实权限或手机验收。

作者管理/发布夹具使用产品 createDraftSessionVault 模型（安全项仍为内存适配器），验证本机草稿 confirmation 与服务器业务兼容，以及离线草稿许可不能放行管理/发布 HTTP。断网 restore 隐藏旧视图；联网后只读恢复原记录，不补发操作。业务请求在 abort 之前计数；这些是实际组件/Session 的消费兼容测试，不是 SecureStore 原生可靠性证明。

组件 job 在原四套后独立执行主开发维护的 C1 CLI；两步都必须成功，无 continue-on-error 或条件跳过。C1 复用相同依赖卷并自行禁网/遮蔽宿主模块，覆盖原型入口、草稿恢复/编辑/退出与真实 C2 页面交接返回。该 CLI 原有白名单阶段/行号投影由子 CLI 故障注入验证；不修改其源码或输出原始子进程日志。`check_mobile_components.cjs` 单独执行仍是四套，完整 CI 组件验证需两条命令，不能混称。

Linux CI 在首次容器前由 runner 预建 `.runtime/mobile/qa/empty-host-modules`。否则原四套 root 容器可能先建父目录，后续 C1 CLI 以 runner 身份 mkdir 会 EACCES；不通过扩大整仓库权限解决。Windows 主机卷不一定暴露相同所有权问题。

`.github/workflows/mobile-checks.yml` 包含 Windows/Linux 静态与模型检查、Linux 断网组件检查、Linux 真实 MySQL/API 检查。现有 backend 工作流继续负责路由覆盖、请求/响应契约、race/MySQL 和 vet；本工作流不重复全量后端测试。不依赖原机 `.runtime`、密钥、SDK 或 npm 缓存，不跑邮件发送、ECS、手机安装或 Android native 编译。

用户已授权阶段性提交推送；每次推送前先拉取远程 main 和核对同事报告。只推本端功能分支，不推 main、不强推。同事负责 App C1 加密草稿/同步/页面；用户另明确本端并行开发作者作品管理，具体文件范围见 `docs/mobile-author-works-spec.md`。新增业务测试必须同步更新分类，再重跑受影响检查。本地检查通过不能记作远程工作流已通过。Android 键盘、导航、SecureStore 与系统终止仍需独立设备验收。
