# 当前本机环境

状态日期：2026-11-12。业务与验收现状读 [交接入口](../handoff/README.md)，本页只维护运行所需信息。

| 项目 | 当前值 |
|---|---|
| Compose 项目 | `tako-local-test` |
| Compose 文件 | `infra/compose.local-test.yaml` |
| 配置 | `.runtime/local-test/.env`，不读取根 `.env` |
| 初始化身份文件 | `.runtime/local-test/init-test.sql`，必须与配置及库的 namespace 一致 |
| 测试库 | `tako_sandbox`，schema 36；后续以 migrations 为准 |
| API/Web 镜像 | `writing-community-api:local` / `writing-community-web:local` |
| 基础镜像 | `mysql:8.4`、`nginx:1.28-alpine`、迁移工具 `golang:1.26` |
| 服务 | mysql、api、web、gateway、maintenance；不需要发信、OSS、Metro |
| 地址 | `http://127.0.0.1:3300/community`、`/workspace`、`/account`、`/docs/` |
| 数据 | 1000 个合成用户、20000 篇中篇基线及后续测试记录；不是实际用户和压测结果 |

## 数据卷

- `tako-local-test_mysql_data`：本机独立测试库，重启时必须存在。
- `writing-community_mysql_data`：旧开发库，保留，不因这次重启挂载或删除。
- `writing-community_go_modules`、`writing-community_go_build`：迁移/后端测试缓存，缺少可重建，但首次下载较慢。
- `writing-community_frontend_modules`、`writing-community_npm_cache`：Web 开发/测试依赖缓存。
- `tako-mobile-android-sdk`、`tako-mobile-gradle-cache`、`tako-mobile-native-cache`、`tako-mobile-node-modules`、`tako-mobile-npm-cache`：保留以减少 Android 重建成本。

Docker 中还有其他项目的数据卷，不能根据本页做全局删除。

## 本机文件

`.runtime/local-test/` 中配置、初始化标记和备份密钥不能删。AUTH_PEPPER 等配套密钥丢失不能靠改密码配置恢复旧账号；先找原配置。`backups/local-test/` 是加密快照，缺密钥不可解密。两者均被 Git 忽略，推送不等于备份。

2026-11-12 升级前快照 ~20261112T015038Z-a42d6cb3.tako.enc~ 已通过 65 张表的隔离恢复。~writing-community-api:pre-short-20261112~ 与 ~writing-community-web:pre-short-20261112~ 保留升级前运行镜像。回退应用镜像时保留现有测试卷和迁移 36，不用清表或降级迁移代替应用回退。

提交记录上线后，API 和维护进程使用 writing-community-api:short-509d3de 对应镜像。应用级回退标签为 writing-community-api:short-4d8602b。Web 继续运行 4d8602b。两版 API 共用迁移 36 和原有 tako-local-test_mysql_data 数据卷。

同日短帖图文快照 `20261112T015928Z-f86edefa.tako.enc` 隔离恢复 73 张表。两张被正式短帖版本引用的合成图片共 146 字节。媒体复验命令见[重启手册](README.md)。

2026-11-02 清理前已验证快照：`backups/local-test/20261102T024534Z-5f94e336.tako.enc`，对应 `.runtime/local-test/recovery.key`；32 张表隔离恢复指纹一致。它记录的是 2026-11-02 此次快照，不含此后新增修改。证据见 [重启复盘](../reviews/local-restart-review.md)。

`.runtime/mobile/artifacts/tako-test-0.1.0.apk` 是当前个人测试包，App 源码 2a830ab，短帖试验开关开启，匹配 API 509d3de。删镜像不会删它。APK 哈希见[设备队列](../handoff/device-requests.md)。ADB 在 `.runtime/tools/android/platform-tools/adb.exe`。SDK 本体主要在上述 Docker 卷中，保留仓库却删卷仍会损失缓存。

## 手机开发恢复按需做

目前用户手机已断开，无条件真机验收。只重启后端不用连接手机。手机重新可用时再执行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/mobile_android.ps1 connect
```

该命令需要唯一已授权 USB Android 手机，建立 `3300→3300` reverse。手机 App 中的 127.0.0.1 需要此转发；USB 断开或电脑重启后需要重建。App 内置 JS，不用 Metro。

只有源码改动需要新 APK 时，才运行 `scripts/mobile_android.ps1 build`；安装需要用户设备条件，不是重启默认步骤。构建镜像删掉后脚本会重建；保留 SDK/Gradle/node 缓存仍可复用部分产物。完整重建可能较慢，不能承诺秒启动。

旧 3000 不启动，3100 是过去 ECS SSH 转发入口，不是第二套本机测试环境。ECS 已由用户停止，恢复本机不需要云端凭据。
