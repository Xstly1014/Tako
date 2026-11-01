# 02 · 工程与新电脑启动

## 目录与唯一事实源

| 目录 | 内容 |
|---|---|
| `backend/` | Go/Gin 模块化单体，identity/draft/publication，MySQL migrations 目前 00013 |
| `backend/internal/contract/openapi.yaml` | HTTP 唯一契约源，当前 0.12.0；运行时校验及路由/响应测试共用 |
| `frontend/` | Nuxt/Vue/TS Web，已具备完整于 App 的创作/管理/互动能力 |
| `mobile/` | Expo 58 / RN 0.88 / Expo Router 独立原生页面；生成类型 `src/api/contract.d.ts`，`src/auth/session.ts` 管生命周期，SecureStore 仅在 context 适配 |
| `docs/prototypes/mobile-app-v1/` | 用户提供的视觉基线；保持原文件，不为实现方便改写原型 |
| `scripts/` / `infra/` | 独立测试环境、造数、恢复、构建/验收工具；ECS 脚本本轮不执行 |
| `docs/reviews/` | 阶段证据，旧记录是当时快照；当前状态看本系列及最新复盘 |

Web Cookie 与 App `tako_app_` Bearer 不可互用，Origin/Cookie 不可混入原生请求。不得通过硬编码 Origin、全局放开 CORS、人工注入会话冒充真实登录。所有私密资源用会话验证归属；expected_account_id 只能防切号，不能授权。

## 环境边界

- 当前只用独立本机 `tako-local-test` Compose，入口 `http://127.0.0.1:3300/community`，库 `tako_sandbox`，schema 13。
- 每台电脑创建**自己的**测试配置、数据库、测试账号密码和数据卷。1000 用户/20000 中篇是合成展示数据，不是并发压测或真实用户。
- 旧 3000 已停，数据保留；不要按旧 development-guide 默认启动根 Compose。ECS 已停，不需要 SSH 私钥，不连接 3100/云端。
- `.runtime/`、`.env`、SDK、数据库卷、APK、证书与备份不在 Git 中。不要复制原电脑根 `.env`；本轮不需要 Resend/SMTP/OSS 配置，不发送真实邮件。

## 干净电脑首次启动（Windows PowerShell）

前置：Git、Docker Desktop（Linux containers，给足内存/磁盘）、Python 3。Node 24 可选但推荐用于 host 上的 API/模型测试。命令从仓库根目录运行，先读 AGENTS 和 skills。

```powershell
git clone https://github.com/Xstly1014/Tako.git
cd Tako
git switch -c codex/mobile-ci-portability
python scripts/local_test.py init
docker volume create writing-community_go_modules
docker volume create writing-community_go_build
docker build -f backend/Dockerfile -t writing-community-api:local backend
docker build -f frontend/Dockerfile -t writing-community-web:local frontend
python scripts/local_test.py migrate
python scripts/local_test.py seed --users 1000 --works 20000
python scripts/local_test.py up
python scripts/local_test.py status
```

`init` 在忽略目录创建独立密钥及测试标记 SQL，重复执行保留旧配置。外部 Go 缓存卷需先创建；镜像构建不等于迁移，迁移不等于造数。首次造数和镜像下载可能较慢。不要删除卷解决凭据不匹配；查清环境与数据是否需保留。

可登录的合成邮箱为 operator/author/reader @tako-test.invalid；密码只在本机 `.runtime/local-test/.env` 的 TEST_*_PASSWORD，使用编辑器本机读取，不发到聊天或命令输出。也可在 Web/App 正常自主注册新合成账号。

## 检查与证据

```powershell
python scripts/test_feedback_backend.py
node --experimental-strip-types --test mobile/tests/*.test.ts
node scripts/mobile_account_acceptance.cjs
```

第一条在独立 `tako_feedback_test` 迁移后执行全量 race/MySQL/契约和 vet；不在业务库跑清理测试。第二条需要 Node 24 与 3300 服务；第三条创建仅供设备验收的合成账号/作品，将随机凭据存入忽略目录，不打印、不发信。它们**不证明**手机 SecureStore、键盘或导航通过。

移动端类型/lint：安装 Node 24 后在 `mobile/` 执行 `npm ci`、`npm run typecheck`、`npm run lint`。SDK 新库用 `npx expo install`，按 `mobile/AGENTS.md` 先读 SDK 58 官方文档。API 变更后按 `mobile/README.md` 重新生成契约类型，不手工修改生成文件。

## Android 个人安装包

```powershell
powershell -ExecutionPolicy Bypass -File scripts/mobile_android.ps1 build
# 以下需要已授权且解锁的唯一 USB Android 手机；本轮用户已拔下，暂不执行：
powershell -ExecutionPolicy Bypass -File scripts/mobile_android.ps1 install
python scripts/mobile_device_acceptance.py
```

构建使用隔离 Docker/JDK17/Android SDK，不要求全局 JDK 或 Expo 云账号。首次全量 native 编译很慢，日志与产物在 `.runtime/mobile/`；后续 JS 修改可复用缓存。生成 `android/ios` 不提交，也不手改其原生行为，使用 app.json/plugins。

安装前把 Google 官方 Windows platform-tools 解压到 `.runtime/tools/android/platform-tools/adb.exe`，保持仅 USB ADB；脚本建立 `3300→3300` reverse。App 内置 JS，不依赖 Metro/Expo Go，但读测试 API 需要本机服务和 USB。使用模板 debug 签名，只供个人测试，不是商店发布包。不可将新电脑构建缓存、生产凭据或 APK 作为源码提交。

## 已知交接风险

本机已有 Docker 缓存不代表新电脑可直接运行，网络可能影响 Google SDK、Maven 和 npm 下载；现有构建固定官方 NDK 校验，Gradle 使用已配置镜像，不跳过完整性检查。另一端的并行任务就是验证从零可复现性；遇到问题明确失败点，不用 force/legacy-peer-deps 或放松安全规则“跑通”。
