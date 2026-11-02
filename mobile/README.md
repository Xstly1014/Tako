# Tako Android · 本机测试 App

独立 React Native + Expo App，与 Nuxt Web 同仓库、独立页面和导航，共用 Go API。视觉以 `../docs/prototypes/mobile-app-v1/` 为依据，中篇保持无封面全宽文字列表。原型不作为真实数据来源。

## 当前源码与安装包

当前源码已整合 M1 作品管理、C2 固定预览发布与 C1 中篇私稿/发布交接。当前 APK 冻结 9653d74，构建、签名、路由与校验标识核对通过，尚未安装到用户手机或完成原生体验验收。最新证据与 SHA-256 见 `../docs/reviews/mobile-draft-publication-review.md`。

C1-B 已接入原型加号半屏面板中的“中篇”与“我的→草稿箱”，支持确认恢复、服务器/本机列表、纯文本编辑、串行加密暂存、在线确认与本机竞争另存。Session 重连不清空输入，退出提示按账号隔离；[阶段复盘](../docs/reviews/mobile-draft-editor-review.md) 区分模型、真实服务、组件与原生包。C1-C 已接入已确认修订的只读交接；准备预览不公开，正式发布仍需再次明确点击。当前整合包状态与指纹以该复盘最后一节为准，不据旧段落推断用户手机版本。

## 当前范围

- 按用户原型恢复开屏、Q 版游客入口、形态选择、中篇首页与整页阅读。首页保持频道栏＋搜索位＋全宽文字行＋图标底栏，不再展示首包自行添加的精选/标签工具栏。
- 游客浏览真实本机测试库的公开中篇，分页、下拉刷新；数据顺序仍由现有 API 按首次发布时间决定。
- 打开完整中篇，页面返回及 Android 系统返回沿原生导航返回已加载列表。
- 首次失败、分页失败、空列表、作品隐藏/限制和请求取消分别处理；分页失败不清空已加载内容。
- 新增真实邮箱密码注册/登录、设置笔名、个人中心、收藏/取消与我的收藏。沿用无邀请、无邮箱验证的私测规则，暂不支持邮件找回；注册不证明邮箱归属。
- 原生凭据使用 Expo SecureStore，七天会话与浏览器独立；不保存密码，不伪造 Origin，不使用浏览器 Cookie。重启需服务端确认，网络错误不误清凭据，明确 401 才清除。断网退出显示失败，联网后重试。
- 收藏响应丢失保留原请求重试；回执确认后重新读取当前状态，不把历史回执当成当前值。账号切换清空私有视图，旧账号响应不得写入新账号。
- 评论已接入阅读页与输入面板：主评论/回复分页、发表/重试、删除确认、内存输入保护及本人处置原因。设备体验尚未验收，不能将源码接入记作用户手机已更新。个人中心保留原型菜单顺序并增加真实评论入口。
- 阅读页已接真实版本时间线：点节点看元数据，作者授权才可切历史正文；失败保留已加载内容，切版本不清空当前评论输入。规则与证据见 `../docs/mobile-version-reading-spec.md`、`../docs/reviews/mobile-version-reading-review.md`。
- 私稿 C1.1 已有 `src/drafts/` 密文仓储/同步核心，采用 Expo Crypto + SecureStore + SQLite 事务。授权与草稿页已接入，当前阶段边界以编辑复盘为准。测试与权限尾项见 `../docs/reviews/mobile-drafts-core-review.md`，不要按 owner 路由参数直接读取底层仓储。
- 按用户确认保留原型未接入入口，点击明确提示尚未开放，不填假数字或假成功。长文、短内容、搜索、关注、赞、周边与消息仍未接入 App；中篇私稿可用，已确认草稿可进入既有发布流程。

## Windows 本地构建

需要 Docker Desktop。工具和依赖缓存在专用 Docker 卷，不修改全局 Java；`android/` 由 Expo 生成并忽略，原生修改写入配置插件。

依赖锁文件不变时复用安装目录；原生配置、插件与图标输入不变时跳过 prebuild，避免 UI 修改清空已编译原生结果。首次全量构建与后续增量构建分开记录。

```powershell
powershell -ExecutionPolicy Bypass -File scripts/mobile_android.ps1 build
```

输出 `.runtime/mobile/artifacts/tako-test-0.1.0.apk`，另附 SHA-256。Release 变体内置 Hermes JS 与图片，**使用模板 debug 签名仅作个人测试**；无需 Metro、Expo Go 或 Expo 账号。不是商店正式发布包，也未配置远程热更新。

工具版本取自 Expo 58 / React Native 0.88 生成工程：Gradle 9.4.1、Android platform 37.0 / build-tools 37.0.0、NDK 27.1.12297006。固定 Google NDK ZIP 按官方大小和校验值验证后安装；当前网络 Maven Central 返回 403，构建通过 init script 使用阿里云公开镜像，不改变依赖版本。Android 最低版本以生成 manifest 为准，当前 RN 模板 minSdk 24。默认打包两种 ARM ABI；真机安装和运行结果单独记录，不把构建成功记为真机验收。

## USB 连接与安装

Google 官方 [platform-tools](https://developer.android.com/tools/releases/platform-tools) Windows ZIP 解压到 `.runtime/tools/android/`，使 `platform-tools/adb.exe` 存在。不要启动网络 ADB。

1. 手机开启开发者选项、USB 调试，通过数据线连接并允许这台电脑调试。
2. 本机测试环境 3300 正常运行。
3. 执行 `powershell -ExecutionPolicy Bypass -File scripts/mobile_android.ps1 install`；只有一个已授权设备时才安装，保留已有 App 数据。
4. 手机断开/重连后执行同脚本 `connect` 重建 `adb reverse tcp:3300 tcp:3300`。

App 默认 `http://127.0.0.1:3300/api`，经 USB 访问电脑上的回环端口。只接受响应头 `X-Tako-Environment: test`，拒绝其他环境。HTTP 仅允许 localhost/127.0.0.1，未开放局域网端口或放松后端 Origin。原生身份使用 Authorization Bearer；不混入 Cookie/Origin，无正文、凭据或请求参数日志。

APK 启动不需要 Metro，但读取测试数据需要电脑测试服务与 USB 转发；不是离线阅读包。测试结束可 `adb reverse --remove tcp:3300`，并在手机关闭 USB 调试或撤销这台电脑的授权。

## 契约与验证

评论独立模块及 `src/components/CommentsPanel.tsx` 已接入源码。纯内存逻辑可单独运行 `node --experimental-strip-types --test tests/comments.test.ts`；`comments-service.test.ts` 必须使用已造数的本机 3300，会正常创建合成测试账号/评论并删除测试讨论，不发送邮件。组件交互见 `../scripts/mobile-comments-ui/README.md`，断网夹具与真实服务分开记账；它们不验证手机键盘或原生生命周期。

历史阅读纯客户端检查为 `tests/versions.test.ts`；`versions-service.test.ts` 需要真实 3300 和专用 `.runtime/local-test/.env` 的合成运营账号，验证历史授权与限制过滤，只创建/隐藏自己的测试作品，不读取根 `.env`。实际阅读页组合夹具见 `../scripts/mobile-versions-ui/README.md`，不需要真机。

`src/api/contract.d.ts` 来自 `backend/internal/contract/openapi.yaml`，生成命令：

```sh
npx --yes openapi-typescript@7.10.1 ../backend/internal/contract/openapi.yaml -o src/api/contract.d.ts
npm run typecheck
npm run lint
npm test
```

Node 测试需要在能访问本机 3300 的主机运行。覆盖真实 API 分页、标签、匿名正文、不可用作品，以及错误环境、异常响应、取消与断网。原生导航、滚动恢复、安全区和前后台需在真机单独验收。

新增真实服务验证：`node scripts/mobile_account_acceptance.cjs`（从仓库根目录运行），只访问 3300 测试环境，自主注册合成账号并检查身份/收藏/隔离。测试设备脚本 `python scripts/mobile_device_acceptance.py` 使用其生成的忽略目录夹具，自行操作 App 注册、收藏、重启恢复、断网退出和账号切换；不会打印密码或采集其他 App 的页面。需要手机已解锁并允许 USB 调试，安装器确认仍由系统控制。

规格见 `../docs/mobile-reader-account-spec.md`，构建、接口、设备与用户结果分别记在 `../docs/reviews/mobile-reader-account-review.md`，不要把代码接入当作真机已经验收。
