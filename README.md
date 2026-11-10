<p align="center"><img src="mobile/assets/tako-icon.svg" width="64" alt="Tako 章鱼标志"></p>
<h1 align="center">Tako</h1>
<p align="center"><strong>有脑洞，就开写。</strong></p>
<p align="center">冒险、幻想、日常、吐槽。读点喜欢的，写点自己的。</p>
<p align="center"><a href="#现在的-tako">当前能力</a> · <a href="#界面一览">界面一览</a> · <a href="#本地体验与开发">本地开发</a> · <a href="#contribution">Contribution</a></p>

Tako 是一个正在开发的年轻、多元的文字创作社区。你可以分享今天的新鲜事，写完一个短篇故事，也可以慢慢搭建自己的幻想世界。我们希望让文字被读到，让创作者能持续创作，并亲自参与社区的长期运营。

**当前以独立 Android App 为开发重心。** App 与 Web 使用各自的页面和导航，共享 Go API。项目处于开发与内部测试阶段，暂无公开体验地址；工程进度不代表所有功能都已在最新手机安装包上完成验收。

## 界面一览

<table>
  <tr>
    <td align="center" width="33%"><img src="docs/images/readme/app-splash-prototype.png" width="240" alt="Tako App 开屏视觉原型：蓝色背景与动态看板娘"><br><strong>打开 Tako</strong></td>
    <td align="center" width="33%"><img src="docs/images/readme/app-login-prototype.png" width="240" alt="Tako App 登录视觉原型：Q版看板娘与游客入口"><br><strong>先逛逛，也能开始写</strong></td>
    <td align="center" width="33%"><img src="docs/images/readme/app-community-prototype.png" width="240" alt="Tako App 中篇社区视觉原型：文字列表、频道导航与创作入口"><br><strong>找到想读的内容</strong></td>
  </tr>
</table>

以上来自仓库内的 [App 视觉原型](docs/prototypes/mobile-app-v1/)，用于说明产品编排与品牌方向，**不是当前安装包的功能清单**。图中内容与数字为示例；点赞、关注、周边等未接入能力不会在真实 App 中伪装成功。实际实现与验证范围见下文。

<details>
<summary>展开官网视觉</summary>

![Tako 当前官网：动态构图看板娘、社区入口与统一导航](docs/images/readme/website-desktop-current-v2.png)

这是 2026-11-03 从本机当前 Web 测试环境截取的官网，保留测试环境标识。官网负责介绍项目，社区负责浏览内容，二者不是同一个首页。Web 社区已支持中篇发现、精选和搜索；后续编排仍会继续调整。

</details>

## 三种内容，一个社区

| 形态 | 想承载什么 | 当前进度 |
|---|---|---|
| 短内容 | 日常、吐槽、灵感、创作动态，以及关联自己作品的分享 | 已确定产品方向，尚未实现独立发帖链路 |
| 中篇 | 一次能读完的故事、经历或情绪表达，题材不限 | 创作、发布、阅读、发现、搜索、收藏、两级评论和作者管理已接入 |
| 长文／连载 | 幻想、冒险、二次元与持续展开的世界 | 私密创作、正式发章、目录阅读、私密续读、完结与整改已接工程；App书架与站内新章汇总提醒已接入 |

三个频道独立展示，未来允许短帖关联作者自己的作品。品牌采用二次元看板娘与蓝色主题；创作内容不限定题材、风格或专业背景。

## 现在的 Tako

### 写作与发布

- **账号自主注册：** 内测使用邮箱＋密码，无邀请、无邮箱验证；支持笔名。未验证邮箱不代表已证明邮箱归属，目前不开放邮件找回密码。
- **中篇私密写作：** 加密本机暂存、离线续写、联网确认与同步；冲突保留双方文字，未知结果按原请求恢复。工作稿与正式版本相互独立。
- **明确发布：** 先生成固定预览，再主动确认正式发布。后续改稿不会偷偷替换预览；重试不应多发一个版本。
- **持续修订：** 从指定作品进入修订发行，核对服务器工作稿与正式版本，确认后返回对应作品；支持展示版本切换、隐藏／恢复、历史正文权限与公共阅读核对。
- **作者工作台：** 按展示／最新正式标题查找自己的全部中篇，组合隐藏与平台限制状态筛选；核对两份固定正式全文后，再明确切换展示。本人处置、原因、文字复核与结果也已接入 App。
- **长文发布与管理：** 固定正文预览、独立章号和逐章阅读；私密跨设备续读、不可逆完结和平台指定章节整改已接入。新增App书架可保存追更选择、独立关闭及移出；站内消息按本批新章汇总，隐藏等待、恢复补提醒和已读重试已接入；不发邮件或系统推送。
- **长文私密创作：** 开书、编辑资料、创建章节、离线续写；冲突恢复为同书下的**独立新章节草稿**，原章保留，不自动发布或分配正式章节序号。

### 阅读与互动

- 游客可浏览公开中篇；支持分页、刷新、人工精选与按风格浏览。
- 搜索当前公开中篇的**标题、作者笔名和简介**，支持分页与返回阅读现场；暂不检索正文、私稿或历史版本。
- 收藏作品与“我的收藏”；隐藏或受限时保留记录，但不泄露不可读内容。
- 两级评论与回复；删除主评论会连同回复删除，运营屏蔽主评论时整串暂不可见。评论输入只保留在内存，关闭 App 后不恢复。
- 读者可查看正常版本的时间线；历史正文是否可读由作者授权，受平台处置的版本不对读者展示。

### 治理与数据保护

已有人工后审、限制／撤销、原因留痕，以及既定范围内的站内文字复核；作者管理、运营读取与公共阅读分别验证权限。私密资源按会话账号判定归属，不能靠客户端传入作者 ID 获取内容。

这些是**已实现并验证的工程能力**，不是规模运营成绩。当前没有真实用户留存、推荐效果、治理准确率或高并发容量的成果声明。

## 接下来做什么

| 阶段 | 要交付的用户行为 |
|---|---|
| N1 · 私密创作 | **工程已完成：** 开书、写章、离线续写与独立恢复；原生设备尾项单独验收 |
| N2 · 发布与阅读 | **工程已接线：** 固定预览、首发／追加、目录阅读、隐藏恢复及最小治理 |
| N3 · 续读与完结 | **工程已接线：** 私密续读、不可逆完结与一次指定整改；真实服务自动化通过，Android尾项待验 |
| N4 · 书架与提醒 | **书架与站内消息已接App：** 追更开关、移出保续读、加密操作恢复；新章批次汇总与当前判权（Android待验） |
| N5 · 长文社区 | **章讨论与搜索已接 App。** 两级回复、本人及作者管理、运营屏蔽撤销，以及长文书名、笔名和简介搜索已完成本机联调。Android 待验 |

短帖、推荐算法、付费与周边属于后续方向。完结与整改纠错需要一起交付，不能先开放一个无法纠正的完结按钮。详见 [长文业务规格与验收计划](docs/novels/README.md)。

## 工程怎么支撑业务

| 层次 | 当前选择 |
|---|---|
| Android App | React Native 0.88 · Expo SDK 58 · TypeScript · Expo Router |
| Web／官网 | Nuxt · Vue · TypeScript，与 App 独立界面 |
| 服务端 | Go 1.26 · Gin，模块化单体 |
| 数据与本机暂存 | MySQL 8.4；App SQLite＋AES-GCM＋SecureStore |
| API 契约 | OpenAPI 为唯一 HTTP 契约源，生成类型并校验请求／响应 |
| 验证 | 模型、页面组件、真实 HTTP／MySQL、迁移与恢复演练分别记录 |

N1／M2 的工程与恢复证据见[私密写章复盘](docs/reviews/private-chapter-drafts-review.md)。最新 M3～M5 整合本机通过 **117 项模型检查**、20 项读者／服务组检查（含客户端与协调测试）、实际 MySQL／HTTP、类型／lint、契约和页面组件检查；本次远程CI结果见[整合复核](docs/reviews/cross-review-primary-240ae2e.md)。测试数量是阶段快照，不代替真机或真实用户结果。

## 本地体验与开发

测试环境独立于正式数据，支持生成 **1000 个合成账号、20000 篇中篇**，用于观察大量内容时的展示与业务状态；这不是容量压测成绩。ECS 当前停机，开发不依赖生产环境。

已有本机环境、保留配置和数据卷时，在 Docker Desktop 启动后执行：

```powershell
python scripts/local_restart.py start
python scripts/local_restart.py check
```

浏览器入口：`http://127.0.0.1:3300/community`。App 是独立客户端，需要安装测试包并连接相应 API，不是把上述 Web 页面直接装进手机。

新电脑先读 [工程与环境初始化](docs/handoff/02-engineering-and-setup.md)；已有环境重建镜像或排障读 [重启手册](docs/restart/README.md)。不要复制其他电脑的凭据或删除数据库卷来解决启动问题。

| 想了解什么 | 从这里开始 |
|---|---|
| 文档总览 | [当前入口、业务规格与历史证据](docs/README.md) |
| 当前工作与两端分工 | [交接入口](docs/handoff/README.md) · [主开发进度](docs/handoff/primary-progress.md) · [并行端进度](docs/handoff/parallel-progress.md) |
| 最新业务交付 | [N1 私密写章复盘](docs/reviews/private-chapter-drafts-review.md) · [M2 修订发行复盘](docs/reviews/author-revision-stage-review.md) |
| 业务规则与下一阶段 | [长文规格](docs/novels/README.md) · [中篇修订发行规格](docs/mobile-author-revision-stage-spec.md) |
| 开发与接口 | [开发指南](docs/development-guide.md) · [API／Swagger](docs/api.md) · [App 说明](mobile/README.md) |
| 待验事项 | [设备任务清单](docs/handoff/device-requests.md) · [运行与恢复](docs/operations.md) |

## Contribution

Tako 由人和 AI 一起推进：业务选择、实现、审查和真实验证都需要有人负责。

<table>
  <tr>
    <td align="center" width="33%"><a href="https://github.com/Xstly1014"><img src="docs/images/readme/xstly1014-avatar.png" height="120" alt="xstly1014 指定的银发绿瞳 Q 版头像"></a><br><a href="https://github.com/Xstly1014"><strong>xstly1014</strong></a><br>项目发起 · 产品决策<br>开发协作 · 运营与验收</td>
    <td align="center" width="33%"><img src="docs/images/readme/chatgpt-avatar-v2.png" height="120" alt="ChatGPT 静态 Q 版头像：白发紫瞳龙娘"><br><strong>ChatGPT</strong><br>业务讨论 · 编码协作<br>测试、审查与文档</td>
    <td align="center" width="33%"><img src="docs/images/readme/tako-avatar-v2.png" height="120" alt="Tako 静态 Q 版头像：蓝发章鱼发饰与眨眼比耶"><br><strong>Tako</strong><br>项目原创品牌形象<br>社区的视觉搭档</td>
  </tr>
</table>

三位采用统一风格的静态 Q 版头像。ChatGPT 为 AI 协作工具，Tako 为虚拟品牌角色；xstly1014 使用本人指定的生成头像，点击可访问 GitHub。ChatGPT 头像基于 [fywdy/chatgpt-chibi-pets](https://github.com/fywdy/chatgpt-chibi-pets) 的非官方同人角色重新绘制，保留 CC BY-NC 4.0 署名与许可，用于本文档展示；项目与 OpenAI 无官方合作或背书关系。[图片来源与许可](docs/images/readme/README.md)

GitHub 右侧的 Contributors 由真实提交和账号关联自动统计，与本区头像分别维护。[如何关联账号与头像](docs/contribution-display.md)

欢迎带着对内容、业务或技术的兴趣参与。提议功能时，说明它解决谁的问题、失败时应该怎样，再讨论实现；开始修改前先核对 [协作边界](docs/handoff/03-parallel-work.md)，避免覆盖并行工作。

文档导航：[当前项目状态](docs/project-status.md) · [完整文档目录](docs/catalog.md) · [工具脚本](scripts/README.md)。
