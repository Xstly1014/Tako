# 移动端 CI 与独立环境复现 · 2026-11-02

本会话已认领交接 03 建议的 CI 方向，分支 `codex/mobile-ci-portability`。初始基线 `712777e`，现已拉取并快进到同事最新 `3a17e22`；用户已授权阶段性提交/推送，要求每次推送前先拉取同步。未创建第二个代理，不连接 ECS。

## 同事进度与并行约定

远程 `bc7f4f3` 记录清理镜像后的真实重启，`a0d1b3c` 交付原生历史阅读，`3a17e22` 完成项目总复盘和 C1 私密草稿规格/原生契约预检。主开发下一步是加密仓储、同步与创作页；尚未实现这些能力，也未完成新增功能真机验收。本端继续工程检查，已将新增版本模型/真实服务及阅读页组件组合接入 CI，不修改 App 页面、会话、依赖、草稿规格或后端。

共享交接与 current-progress 以同事远程版本为准，前轮本端改动已撤回，避免两端同时汇总产生冲突。本端证据集中在本文件和独立阶段复盘。同事可从本分支合并下述独占文件，继续负责 `mobile/src/**`、业务测试、OpenAPI、依赖和构建配置；新增测试需与本端同步分类，缺分类门禁会明确失败。

## 实现范围

- 新增 `.github/workflows/mobile-checks.yml`，Windows/Linux 类型、lint、契约与模型检查；Linux 断网组件夹具；真实 MySQL 迁移/造数/API/账号收藏检查。
- 新增 `scripts/check_mobile_contract.cjs`、`scripts/check_mobile_tests.cjs`、`scripts/check_mobile_components.cjs` 与 `scripts/mobile-checks/` 独立工具锁、失败验证、API 端口 override 和使用说明。
- 为消除真实复现出的 React 重复加载，组件入口使用空目录遮住宿主依赖，两个原脚本统一解析 Docker /app/node_modules；既有评论/版本组件脚本和业务步骤均未修改。
- 未修改 `mobile/src`、现有测试、App 依赖、OpenAPI、Go 业务或 schema。生成器使用兼容的独立 TypeScript 5，不放松 peer 校验来强装，也不改 App TypeScript 6。
- 阶段报告：`docs/reviews/mobile-ci-portability-review.md`。本端只新增独占文件，共享文档与同事实现完全沿用远程版本；其他文档中的“CI 未认领”是旧检查点，以本文件为准。

## 环境与证据

起点为 Windows，本机无测试配置/数据卷、npm 依赖与镜像。Docker Desktop 启动后确认 Linux 引擎可用且卷列表为空，随后使用仓库首次初始化脚本创建本机独立配置。未复制原机密钥或数据。Python 3.13.9 embedded 从 python.org 下载至忽略目录，未修改全局 Python。

- Node 24.19.0 / npm 11.17.0。第一次 npm ci 因全局缓存 `D:/nodejs/node_cache` 不可写而失败；改用 `.runtime/npm-cache` 后 mobile 与独立工具的锁定安装通过，未修改全局配置。
- 同步 `3a17e22` 后 App 类型检查、Expo lint、24 项会话/评论/版本纯模型测试通过，零 skip/todo。
- 实际 OpenAPI 重新生成与已提交类型语法比较通过；3 项门禁自动化测试通过，覆盖格式不误报、类型漂移/坏源拒绝、无源码写回、服务缺失/错误环境/种子不足拒绝，以及 skip/未分类测试拒绝和断言值不泄露。这些门禁夹具不是业务服务验收。
- actionlint 1.7.12 检查新工作流通过；未执行远程 Actions，未验证远程 Windows/Linux job。
- 冷启动先后遇到 Docker Hub token 连接失败、distroless 拉取 EOF/TLS 超时、Go 模块代理 EOF 和容器 npm ECONNRESET。单独拉取重试后镜像齐备；容器显式继承 Docker 引擎已有 HTTP/HTTPS 代理后恢复依赖下载，未改全局配置、关闭证书校验或关闭 Go 校验和验证。原 `backend/Dockerfile` 使用预定义代理 build args 构建成功，没有替换运行镜像。
- 真实 MySQL 8.4 的迁移 1～13、10 账号/60 作品种子完成；真实 API 镜像经 CI override 在回环 3300 启动，同步后 7 项 reader/comment/version 检查通过，零 skip/todo；账号/收藏验收脚本通过，包括原生/浏览器凭据隔离、多账号归属、幂等、隐藏元数据保护和退出重试。未发真实邮件。
- 组件首次复验出现 `useMemo` 空引用，确认是宿主 mobile/node_modules 与 Docker /app/node_modules 两份 React 导致。最终独立入口遮蔽宿主依赖后，评论及历史阅读断网组件检查均通过，包括输入保留、登录、重试、删除/回复、切号，以及历史授权、失败保留原文、迟到响应和分页。本次安装依赖时曾误并行操作同一卷，已停止相关容器并顺序重装成功，再验证最终结果。
- 当前保留的本机服务是 API/MySQL 检查环境，3300 没有 Web 社区页面；没有启动 gateway、旧 3000、ECS 或手机。正式 Web 环境需要按交接 02 继续准备，不将 API 端口当作完整社区入口。

## 边界与退出条件

- 本轮同步后的本机检查已收口：锁定安装、类型/lint、24 项模型、3 项门禁验证、真实迁移/种子、7 项 reader/comment/version、账号收藏 API 及两套断网组件均通过。远程 CI 尚未运行，不能称整个 CI 已远程验收。
- P1，远程 CI：本阶段推送后验证三个 jobs 与两个静态平台；失败先修复，每次补丁推送仍先拉取远程同步，不把 actionlint 或 Windows 本机结果替代远程执行。
- P1，交接 02 的完整 Web/1000 账号/20000 作品初始化尚未在本机执行；本轮小规模 API 环境不能代替完整展示环境或压力测试。
- P0，移动体验交付前：账号/收藏/评论新包真机门槛继续保留。CI 不验证键盘、系统返回、安全存储或杀进程行为。

使用命令与测试分类见 [工具说明](../../scripts/mobile-checks/README.md)。新工具目录与新 workflow 由本分支维护，主开发合并前避免同时修改；共享业务、依赖和生成类型仍由主开发协调。
