<p align="center">
  <img src="frontend/public/images/tako-mascot-v1.png" width="220" alt="Tako 原创看板娘：蓝白街头风服装与章鱼发饰，包含精致版和 Q 版">
</p>
<h1 align="center">Tako</h1>
<p align="center"><strong>有脑洞，就开写。</strong></p>
<p align="center">冒险故事、深夜吐槽、今天的新鲜事。长短不限，题材由你。</p>

Tako 正在成为一个年轻、多元的文字创作社区。短内容分享日常与灵感，中篇讲完一个故事或一段经历，长篇让角色和世界继续生长。看板娘是品牌形象，创作题材由作者自己决定。

**新电脑 / Codex 接手：[工作交接文档](docs/handoff/README.md)。** 当前优先独立 Android App，常规回归由开发者执行；源码在 `mobile/`，沿用用户手机原型。Web/API 已具备收藏与两级评论，App 已接入账号/收藏代码；新包真机回归因 USB 已拔下保留为下一阶段前置门槛。ECS 已停机，本轮不连接生产。

![Tako 当前首页实拍：创作入口与原创二次元看板娘](docs/images/tako-home-desktop.png)

> 官网视觉截图，三类内容卡片展示产品方向。独立社区首页已支持中篇发现与人工精选；短内容、长篇仍是规划方向。

<details>
<summary>看看手机布局</summary>
<br>
<img src="docs/images/tako-home-mobile.png" width="320" alt="Tako 首页 390px 宽移动端布局">
<p>浏览器响应式截图；真实 iPhone 写作验收另见验收记录。</p>
</details>

## 现在能做什么

先把自己的文字写下来，再放心地回来继续。

- 本机支持邮箱＋密码自主注册，无需邮件验证，创建笔名和私密纯文本草稿。内测暂不支持邮件找回密码。
- 自动保存，数据库确认后显示“已保存”；关闭重开后继续写。
- 服务断连时本机暂存；电脑和手机发生冲突时另存副本，保留双方文字。
- 原账号重新登录恢复待同步内容，支持导出和历史恢复。
- 从官网进入真实社区，按首次发布时间与风格找公开中篇；运营可以编排精选，隐藏或受限作品退出后不会自动回榜。

**增量 A 核心链路已验收，ECS 正式数据环境采用 SSH 私有访问，暂无公开体验地址。** 真机粘贴和 Wi-Fi／蜂窝切换仍是明确的验收尾项，待稳定 HTTPS 入口补测；不能将服务断链演练当作网络切换测试。

本机测试入口为 `http://127.0.0.1:3300/community`，独立数据库包含 1000 个合成账号和 20000 篇中篇，用于查看大量内容时的页面与业务状态。ECS 已停，历史 3100 SSH 转发入口当前不使用。两者的账号、正文、会话与凭据独立；[新电脑启动](docs/handoff/02-engineering-and-setup.md) · [环境说明与测试身份](docs/environments-and-synthetic-data.md)。

“已保存”表示数据库已提交。每日离机备份另行运行，正常恢复点约落后一天；本机缓存也不能抵抗浏览器数据被清除。

## 接下来一起把社区做出来

| 阶段 | 用户可以获得什么 | 当前状态 |
|---|---|---|
| A · 保存文字 | 登录、私密草稿、续写与冲突恢复 | 核心链路通过，两项真机补测待完成 |
| B · 公开作品 | 中篇发布阅读、版本管理、治理与纠错 | B1/B2 与 B3.1 人工后审、复核已本人验收；B3.2 暂缓 |
| 发现与反馈 | 社区首页、精选、风格浏览、收藏与两级评论 | Web/API 工程验证通过，两级评论本人确认；App 账号/收藏新包待真机回归 |

正式首发还需补齐既定的内容发现、完整治理及短内容／长篇基础能力。本机已有 B1/B2 发布阅读与版本管理、B3.1 人工后审与复核，尚未公开运营，没有推荐、支付或规模运营成果。

## 从这里了解 Tako

- [增量 A 业务复盘](docs/reviews/2026-10-30-a-business-review.md)：为什么做、踩过什么坑、证据是否足够、还欠什么。
- [A 之后的业务复盘](docs/reviews/2026-10-30-b-business-review.md)：发布、版本、人工治理与自主注册，及发现/反馈优先级纠偏。
- [B2 版本管理与验收](docs/reviews/2026-10-30-b2-review.md)
- [B3.1 人工后审与复核](docs/reviews/2026-10-30-b3-1-review.md)
- [自主注册与存量账号兼容](docs/reviews/2026-10-30-password-registration.md) · [社区发现首版规格](docs/community-discovery-spec.md)
- [社区发现、精选与共享导航复盘](docs/reviews/community-discovery-review.md)
- [环境隔离与大量内容复盘](docs/reviews/environments-review.md)
- [B1 开发与验证记录](docs/reviews/2026-10-30-b1-review.md) · [B 业务规格](增量B开发规格.html)
- [验收证据与边界](docs/reviews/2026-10-30-a-acceptance.md) · [当前进度](docs/reviews/current-progress.md)
- [业务共识](项目业务共识.html) · [增量 A 开发规格](增量A开发规格.html)
- [看板娘与视觉方向](docs/brand-mascot-v1.md)

Go／Gin + MySQL + Nuxt／Vue／TypeScript，从模块化单体起步。当前不宣称高可用或高并发性能。

开发者入口：[启动与测试](docs/development-guide.md) · [API / Swagger](docs/api.md) · [运行与恢复](docs/operations.md) · [ECS 部署](docs/ecs-test-deployment.md) · [真机验收](docs/mobile-acceptance.md)。凭据、正文、备份与开发证书不进入仓库。
