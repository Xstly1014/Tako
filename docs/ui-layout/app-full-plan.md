# App 全页面规划与覆盖清单

2026-11-18。基线 a8656ea。用户要求先完成全 App 前端，再实现缺失业务；随后明确保留周边、关注并制作原型。

## 状态与范围

这是第一轮可点击布局提案，不是 114 个已完成的原生页面。计数包含同一路由的子视图、表单和结果态。页面当前仍需评审；原生 App 代码及现有真实接口未替换。旧版基线保留在 mobile/src 和 mobile-app-v1。

已确认：沿用原风格、少说明、管理动作进详情、作者列表不显示版本，评论收藏按真实口径，点赞未开放不显示。周边和关注仅前端原型，不默许新增支付、社交权限或通知规则。

## 跨页布局提案

| 维度 | 提案 |
|---|---|
| 栅格 | 单列，页面边距 16，正文额外 8；评审框 360/390/430 |
| 间距 | 8/12/16/24；列表细分隔，不叠加装饰卡片 |
| 密度 | 普通列表约 4–6 行；长正文完整滚动，不为首屏挤小字号 |
| 层级 | 页标题18，条目16，正文18，辅助12；400/600字重 |
| 导航 | 社区／周边／创作面板／消息／我的；书架从我的进入；关注位于社区和作者主页 |
| 状态 | 正常／加载／空／失败／未登录／不可访问／离线／结果未确认的独立预览；真实资格仍由原接口决定 |
| 适配 | 可切3档宽度；正文滚动，弹层内部滚动，焦点约束和Esc关闭；原生键盘安全区待迁移验证 |

## 页面目录

| 页面 | 原路由或子状态 | 原型定位 | 布局状态 |
|---|---|---|---|
| Tako | `/` | `#splash` | 提案 |
| 欢迎 | `/welcome` | `#welcome` | 提案 |
| 阅读偏好 | `/preferences` | `#preferences` | 提案 |
| 我的 | `/account` | `#account` | 提案 |
| 设置 | `规划子页` | `#settings` | 提案 |
| 编辑资料 | `account 内编辑态` | `#profile-edit` | 提案 |
| 账号与安全 | `规划子页` | `#security` | 提案 |
| 关于 Tako | `规划子页` | `#about` | 提案 |
| 协议与隐私说明 | `规划子页` | `#legal` | 提案 |
| 问题反馈 | `规划子页` | `#help` | 提案 |
| 反馈结果 | `规划子页` | `#help-result` | 提案 |
| 社区 | `/community` | `#community` | 提案 |
| 精选中篇 | `community 筛选态` | `#featured` | 提案 |
| 搜索中篇 | `/search` | `#search` | 提案 |
| 搜索结果 | `search 结果态` | `#search-results` | 提案 |
| 中篇阅读 | `/works/[id]` | `#reader` | 提案 |
| 公开历史版本 | `works/[id] 内版本态` | `#reader-versions` | 提案 |
| 评论 | `阅读页评论面板` | `#comments` | 提案 |
| 评论与回复 | `评论线程面板` | `#thread` | 提案 |
| 我的评论 | `/my-comments` | `#my-comments` | 提案 |
| 我的收藏 | `/favorites` | `#favorites` | 提案 |
| 短内容 | `/short-community` | `#short-community` | 提案 |
| 短帖详情 | `/short-posts/[id]` | `#short-reader` | 提案 |
| 短帖公开版本 | `short-posts/[id] 内版本态` | `#short-reader-versions` | 提案 |
| 长文 | `/novel-community` | `#novel-community` | 提案 |
| 搜索长文 | `/novel-search` | `#novel-search` | 提案 |
| 长文搜索结果 | `novel-search 结果态` | `#novel-search-results` | 提案 |
| 书籍详情 | `/novel/[id]` | `#novel` | 提案 |
| 章节目录 | `novel/[id] 内目录态` | `#directory` | 提案 |
| 章节阅读 | `/novel-chapter` | `#chapter-reader` | 提案 |
| 章节评论 | `/novel-comments；my-comments 长文态` | `#chapter-comments` | 提案 |
| 书架 | `/shelf` | `#shelf` | 提案 |
| 作者主页 | `前端提案` | `#author-profile` | 提案 |
| 我的关注 | `前端提案` | `#following` | 提案 |
| 关注者 | `前端提案` | `#followers` | 提案 |
| 关注动态 | `前端提案` | `#following-feed` | 提案 |
| 消息 | `/notices` | `#notices` | 提案 |
| 互动消息 | `前端提案` | `#interaction-notices` | 提案 |
| 公告详情 | `/notice/[id]` | `#notice` | 提案 |
| 开始创作 | `全局创作面板` | `#create` | 提案 |
| 中篇草稿 | `/drafts` | `#drafts` | 提案 |
| 写中篇 | `/drafts/[id]` | `#draft-editor` | 提案 |
| 草稿同步 | `草稿列表/编辑状态` | `#sync` | 提案 |
| 同步详情 | `草稿冲突与锁定态` | `#sync-detail` | 提案 |
| 核对发布 | `/publish` | `#publish` | 提案 |
| 修订核对 | `publish 对照态` | `#publish-compare` | 提案 |
| 固定预览 | `publish 固定预览态` | `#publish-preview` | 提案 |
| 发布结果 | `publish 结果态` | `#publish-result` | 提案 |
| 确认原发布 | `publish 恢复态` | `#publish-recovery` | 提案 |
| 写短内容 | `/short-compose` | `#short-compose` | 提案 |
| 关联我的长文 | `short-compose 选择态` | `#novel-picker` | 提案 |
| 短帖固定预览 | `short-compose 预览态` | `#short-preview` | 提案 |
| 短帖提交结果 | `short-compose 结果态` | `#short-result` | 提案 |
| 我的中篇 | `/my-works` | `#my-works` | 沿用确认基线 |
| 作品管理 | `/my-works/[id]` | `#work-manage` | 提案 |
| 正式版本 | `作品详情内版本态` | `#work-versions` | 提案 |
| 核对展示版本 | `作品详情内对照态` | `#version-compare` | 提案 |
| 候选版本全文 | `作品详情内对照态` | `#version-candidate` | 提案 |
| 管理记录 | `作品详情内记录态` | `#work-history` | 提案 |
| 提交记录 | `/work-submissions` | `#work-submissions` | 提案 |
| 原提交内容 | `work-submissions 详情态` | `#submission-detail` | 提案 |
| 读者反馈 | `/author-feedback` | `#author-feedback` | 提案 |
| 全部反馈 | `author-feedback 筛选态` | `#all-feedback` | 提案 |
| 作品讨论 | `/my-work-feedback/[id]` | `#work-feedback` | 提案 |
| 我的短帖 | `/my-short-posts` | `#my-short-posts` | 提案 |
| 短帖管理 | `/my-short-posts/[id]` | `#short-manage` | 提案 |
| 短帖正式版本 | `短帖详情内版本态` | `#short-versions` | 提案 |
| 短帖版本核对 | `短帖详情内版本态` | `#short-version-detail` | 提案 |
| 短帖提交记录 | `/my-short-posts/[id]/submissions` | `#short-submissions` | 提案 |
| 提交图文 | `短帖提交详情态` | `#short-submission-detail` | 提案 |
| 我的长文 | `/novels` | `#novels` | 提案 |
| 章节草稿 | `/novel-drafts` | `#novel-drafts` | 提案 |
| 书籍资料 | `novels 资料编辑态` | `#book-edit` | 提案 |
| 写章节 | `/chapter-edit` | `#chapter-edit` | 提案 |
| 核对章节发布 | `/chapter-publish` | `#chapter-publish` | 沿用确认基线 |
| 章节发布结果 | `chapter-publish 结果态` | `#chapter-result` | 提案 |
| 章节提交记录 | `正式管理提交详情` | `#chapter-submission` | 提案 |
| 长文正式管理 | `/novel-manage` | `#novel-manage` | 沿用确认基线 |
| 正式章节管理 | `novel-manage 章节详情` | `#chapter-manage` | 提案 |
| 章节版本 | `novel-manage 版本态` | `#chapter-versions` | 提案 |
| 章节版本核对 | `novel-manage 对照态` | `#chapter-version-detail` | 提案 |
| 正式书籍资料 | `novel-manage 资料态` | `#novel-settings` | 提案 |
| 我的作品公告 | `novel-manage 公告态` | `#author-notices` | 提案 |
| 写作品公告 | `novel-manage 公告编辑态` | `#notice-compose` | 提案 |
| 核对公告 | `novel-manage 公告预览态` | `#notice-preview` | 提案 |
| 公告管理 | `novel-manage 公告详情态` | `#author-notice-detail` | 提案 |
| 完结前核对 | `novel-manage 完结态` | `#completion` | 提案 |
| 我的举报 | `/content-reports` | `#reports` | 提案 |
| 短帖举报记录 | `content-reports kind=short-post` | `#short-reports` | 提案 |
| 举报内容 | `content-reports 提交态` | `#report-compose` | 提案 |
| 举报已提交 | `content-reports 提交结果` | `#report-submitted` | 提案 |
| 举报详情 | `content-reports 详情态` | `#report-detail` | 提案 |
| 内容不可用 | `阅读权限态` | `#unavailable-content` | 提案 |
| 中篇处置与复核 | `/my-moderation` | `#my-moderation` | 提案 |
| 短帖处置与复核 | `/my-short-posts/[id]/appeals` | `#short-appeals` | 提案 |
| 长文处置与复核 | `novel-manage 复核态` | `#novel-appeals` | 提案 |
| 处置详情 | `三类内容处置详情态` | `#appeal-detail` | 提案 |
| 原处置内容 | `处置证据态` | `#appeal-evidence` | 提案 |
| 申请复核 | `复核填写态` | `#appeal-compose` | 提案 |
| 复核进度 | `复核结果/历史态` | `#appeal-history` | 提案 |
| 授权整改 | `长文章节整改态` | `#rectification` | 提案 |
| 整改稿核对 | `长文章节整改预览态` | `#rectification-preview` | 提案 |
| 周边 | `前端提案` | `#merch` | 提案 |
| 商品详情 | `前端提案` | `#product` | 提案 |
| 核对订单 | `前端提案` | `#checkout` | 提案 |
| 收货地址 | `前端提案` | `#addresses` | 提案 |
| 编辑演示地址 | `前端提案` | `#address-edit` | 提案 |
| 我的订单 | `前端提案` | `#orders` | 提案 |
| 订单待付款 | `前端提案` | `#order-pending` | 提案 |
| 订单详情 | `前端提案` | `#order-shipped` | 提案 |
| 物流详情 | `前端提案` | `#logistics` | 提案 |
| 申请售后 | `前端提案` | `#after-sale` | 提案 |
| 售后进度 | `前端提案` | `#after-sale-detail` | 提案 |
| 配送与售后 | `前端提案` | `#shipping-rules` | 提案 |

## 弹窗与确认

| 名称 | 原型定位 |
|---|---|
| 登录 Tako | `login` |
| 创建演示账号 | `register` |
| 开始创作 | `create` |
| 筛选作品 | `work-filter` |
| 题材筛选 | `search-filter` |
| 阅读选项 | `reader-more` |
| 短帖选项 | `short-more` |
| 分享内容 | `share` |
| 写评论 | `comment` |
| 回复青禾 | `reply` |
| 查看原图 | `image` |
| 选择配图 | `photos` |
| 选择题材 | `tags` |
| 新建书籍 | `new-book` |
| 阅读设置 | `reader-settings` |
| 续读位置 | `reading-position` |
| 管理书架 | `shelf-actions` |
| 商品规格 | `sku` |
| 付款面板预览 | `payment` |
| 退出登录？ | `logout` |
| 离开编辑？ | `leave` |
| 删除这条评论？ | `delete-comment` |
| 取消收藏？ | `unfavorite` |
| 关注林间？ | `follow-author` |
| 取消关注？ | `unfollow` |
| 加入书架并追更？ | `follow-book` |
| 停止追更？ | `unfollow-book` |
| 移出书架？ | `remove-book` |
| 保留冲突副本？ | `conflict-copy` |
| 固定这份预览？ | `freeze-preview` |
| 隐藏作品？ | `hide-work` |
| 隐藏短帖？ | `hide-short` |
| 隐藏章节？ | `hide-chapter` |
| 隐藏整本书？ | `hide-book` |
| 切换展示版本？ | `switch-version` |
| 切换展示图文？ | `switch-short` |
| 切换章节展示版？ | `switch-chapter` |
| 开放历史版本？ | `history-public` |
| 撤回待审提交？ | `withdraw-chapter` |
| 发布作品公告？ | `publish-notice` |
| 撤回公告？ | `withdraw-notice` |
| 提交这份整改稿？ | `rectification-submit` |
| 取消演示订单？ | `cancel-order` |
| 确认收货预览 | `received` |

## 页面骨架与取舍

```text
列表：返回 · 标题 · 入口 → 搜索/筛选 → 细分隔内容行 → 分页反馈
详情：返回 · 标题 → 内容/状态 → 次级管理入口 → 需要时显示主动作
编辑：返回 · 标题 → 必填表单/正文 → 局部错误 → 核对
发布：返回 → 固定内容全文 → 权利确认 → 提交 → 原结果/待确认
弹层：遮罩 → 标题/关闭 → 选择项或必要说明 → 明确动词按钮
空/错误：原内容区域 → 一句原因 → 一个下一步动作
```

A 推荐：保留上述逐步路径，列表负责找对象、详情负责动作。B 不采用为默认：将所有管理按钮铺在列表中，首屏密度下降且误触风险增大。各页面具体字段、入口和主动作以可点击提案为评审依据，不能把本表当成用户已逐页认可。

## 原生迁移次序与退出条件

1. 确认发现/阅读/我的/周边这组主入口和关键详情，锁定共享顶栏、导航与弹层。
2. 整包替换阅读与互动：三形态、搜索、目录、书架、评论、作者主页和关注。
3. 整包替换创作与管理：草稿、三种发布、版本对照、反馈、举报与复核，保留加密和恢复行为。
4. 账号、消息与周边提案收口；新业务接口另开明确规格，不能借样稿决定付费规则。
5. 每一整包只做相关类型/lint和关键交互核验，最终再做新 APK 与真机。所有旧路由能到达、业务错误状态未丢失，才算原生前端完成。

## 真实差距（P1）

- 原型状态切换是评审工具，不等同于每页真实异常处理已实现。
- 周边价格/库存/配送/退款、关注可见性/通知均待决定；退出条件为页面评审后单独确认业务规格。
- 原型中若有与现有业务不一致的文案或入口，以现有契约和用户确认权利为准，在原生迁移前修正。
- Android 上一包构建失败（Gradle daemon unexpectedly disappeared），旧 APK 保留；不能声称本轮原型已进入 APK。
