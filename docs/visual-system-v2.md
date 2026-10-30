# Tako 视觉纠偏 V2 · 2026-10-30

用户反馈：浅底卡片与大段口号过多、视觉重心不清；看板娘反复复用精致版+Q版同一张图，登录入口缺少品牌形象。当前 V2 供审阅，不代表用户已批准视觉定稿。

## 设计原则

- 工作界面优先内容与操作：白色主画布、中性灰文字和分隔线、蓝色只强调主要动作与选中态。减少大圆角、彩色容器、渐变与装饰性标签。
- 发布页聚焦正文和确认发布；时间线作为侧栏导航，正文预览为主区域；审核页用任务列表和审阅区，不建设装饰性仪表盘。
- 看板娘不出现在每个业务页右上角。品牌页、首次登录、适当空状态使用独立角色，审核与长文阅读尽量不被插画打断。
- 正常/待审/驳回/撤回颜色保持业务含义，同时保留文字；不把品牌色当处置状态。

## 固定角色锚点

同一成年角色：海军蓝短发、蓝色挑染、蓝眼睛、珊瑚色章鱼发饰；蓝白宽松街头外套、白色内搭、深色裙装及不透明打底短裤、蓝白运动鞋。服饰和身份固定，只改变姿势、表情及场景。正式立绘与 Q 版作为独立资源，不再把设定合图当所有场景的 UI 图片。

- `frontend/public/images/tako-mascot-welcome-v2.png`：独立持本立姿，首次登录桌面端。
- `frontend/public/images/tako-mascot-working-chibi-v2.png`：独立 Q 版电脑工作姿态，移动端登录及空状态。
- 原始 `tako-mascot-v1.png` 保留作为设定参考，未覆盖。生成角色的小细节一致性仍需用户评审，不能凭提示词称为完全定稿。

两份素材均通过内置 image_gen，以原始设定图为参考并请求透明背景；没有通过代码裁剪合图充当新姿态。

## 登录调整范围

现有 LoginPanel 只修改展示层，保留验证码请求、检查状态、重发倒计时、一次性验证码输入和会话逻辑。首次登录是品牌立绘与表单的双栏；手机只展示独立小 Q 版与表单；编辑中会话过期使用 compact 模式，不放大幅立绘、不清空编辑内容。

B 仍为静态交互原型，未实现公开发布、权限或审核后端。本轮只将既有 A 登录展示层更新到本地前端；未部署 ECS。

## 生成提示词记录

共同提示：Use case stylized-concept. Reference is ORIGINAL Tako identity sheet, not an edit target. Preserve exact adult character identity and fixed clothing: adult woman in her twenties, navy shoulder-length bob with vivid blue streak, blue eyes, small coral octopus hairclip, blue-white oversized streetwear jacket with coral octopus accents, white t-shirt, navy skirt with opaque black shorts, white-blue sneakers. Restrained professional 2D hand drawn anime illustration, crisp simple linework and flat controlled cel shading, no glossy airbrush, no bloom, no floating symbols, no sparkle, no gradients. Genuinely transparent background. No text, logos, scenery or watermark.

立绘追加：Create ONE refined adult character ONLY, no chibi, no additional person, no concept sheet. Full body standing in relaxed three-quarter pose, one arm casually holding a closed slim notebook against torso, other hand relaxed small welcoming gesture at waist. Calm confident subtle smile, mature proportions. Comfortable grounded pose, no jumping, no foreshortened hand toward camera, no fanservice. Entire body and shoes visible, generous clean alpha margins. Intended as quiet brand illustration beside a professional login form. Portrait asset.

Q版追加：Create ONE standalone chibi rendition of the same ADULT character ONLY. No fullsize rendition, no child, no other figures. Compact seated pose at a small plain laptop, focused calm expression, one hand thoughtfully near chin and other on keyboard. Same exact costume, hairclip, hair streak and adult identity translated to tasteful 3-head-tall chibi design. Professional restrained mascot illustration for empty states, not baby-like or toy-like. Entire silhouette visible, transparent background, quiet precise shapes, limited shading. Square asset.
