# Tako 独立 App 方向 · 2026-11-01

## 用户已确认

- 手机端优先级高于 Web；目标是需要安装的独立 App。
- 当前只做个人手机安装测试，暂不考虑上架。付费会员购买与商店发布不作为开始开发的前置条件；iPhone 自有安装包仍需单独明确签名/构建路径。
- 视觉与交互以 `docs/prototypes/mobile-app-v1/` 现有原型为基线延伸，不回到桌面页面缩放后的形态。
- 三频道独立编排：短内容双列、中篇全宽文字、长文分区；保持年轻社区和固定看板娘形象。按原生 App 的键盘、安全区、返回手势和生命周期调整交互细节。
- 两级评论平铺，不持久记录或展示版本归属；删除主评论删整串、删除回复删单条；主评论屏蔽使整串暂不可见，撤销不恢复独立删除或屏蔽状态。
- 创作者可在短内容帖子底部关联自己的长文作品，读者进入作品阅读；不因此混排正文或取得管理他人作品的权限。
- 周边属于长期方向，本轮先完成免费社区链路；原型中的价格与商城入口不等于支付履约已进入本轮范围。
- 用户已停止 ECS，当前不连接或部署生产环境。

## 工程组织建议

同一个 Git 仓库内保留 `backend/`（Go 服务）与 `frontend/`（现有 Nuxt Web），新增 `mobile/` 独立移动工程。不搬动 Web 与后端目录。

App 单独实现页面、导航、输入、滚动、手势和应用生命周期；与 Web 使用同一业务后端及 API 契约。接口类型和不依赖平台的校验可按实际需要共享。凭据存储、网络客户端和离线草稿分别适配浏览器与手机，不直接复用依赖 Cookie、相对 URL、IndexedDB 或 DOM 的代码。

已采用 React Native + Expo 58 / Expo Router，现有 TypeScript 经验与 API 契约延续；原型 HTML/CSS 用作设计依据，页面在 App 组件中实现，不把原型当成现成原生代码。

后端业务规则不拆两套。原生客户端登录与同源保护需要明确适配，不通过全局放开 Origin/CORS 或在客户端硬编码浏览器身份来绕过现有保护。

## 首个验证目标

首条 Android 个人阅读测试包已完成安装与阅读工程验证。用户纠正首包视觉后，按原型恢复开屏、Q 版游客入口、形态选择、频道与底栏；撤下自加的精选/标签工具栏，接口筛选测试不代表界面提供筛选。

后续以 App 为主要交付端，常规自动化与真机回归由开发者自行完成，不逐次要求用户操作。当前推进游客阅读→自主注册/登录→原作品收藏→我的收藏再次阅读，复用后端已确认规则；之后接两级评论，再推进创作。ECS 继续不连接。规格见 [App 读者账号与收藏](mobile-reader-account-spec.md)，证据分层记录，不把静态样稿或编译通过当作真机交付。

## 尚需确认的条件

用户此前使用 iPhone。当前是否有 Mac、是否有 Apple Developer 付费会员尚待回答，它们影响首个 iOS 安装和调试路径。Windows 本机、Android 模拟器、Expo Go 预览、原生开发构建及正式安装包的证据须分别记录，不能混为“已交付独立 App”。

续确认：用户目前无 Mac、无付费开发者会员。已核对中国大陆个人可通过 iPhone 的 Apple Developer App 注册，官方列示自动续期年费 ¥688，要求双重认证、真实个人信息与身份核验；不承诺当天开通。开发路线可采用 Windows 编写 React Native + Expo、EAS 云端构建；iPhone 独立开发构建需满足相应签名和会员条件。尚未代为注册、购买会员或启动付费构建。

国内注册官方流程：https://developer.apple.com/cn/help/account/membership/enrolling-in-the-app/

## 已确认 Android 首测路径

用户可使用 Android 手机，并已接受 USB 调试连接。电脑原来无 Android SDK，主机仅 JDK 11，故采用隔离 Docker 工具链本地构建；不要求 Expo 云账号、Apple 会员或 ECS。Google 官方 Windows adb 放在忽略目录 `.runtime/tools/android/`，经 `adb reverse tcp:3300 tcp:3300` 访问本机测试环境，不开放局域网端口。

`mobile/` 为原生页面；初始包内置 JS，使用模板 debug 签名，仅作个人安装，不是商店正式包。App 只读匿名 API，只接受测试环境标记；暂不伪造浏览器身份来登录。完整安装步骤见 `../mobile/README.md`，阶段证据见 `reviews/android-reader-review.md`。

## 官方资料

- React Native 本地 iOS 工具要求：[环境搭建](https://reactnative.dev/docs/set-up-your-environment)。
- Expo iPhone 开发构建安装与会员条件：[环境设置](https://docs.expo.dev/get-started/set-up-your-environment/?device=physical&mode=development-build&platform=ios)。
- Expo 云端和本机构建路径区别：[开发构建介绍](https://docs.expo.dev/develop/development-builds/introduction/)。
