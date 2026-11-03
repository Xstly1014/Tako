# README 图片来源

2026-11-03。本目录供项目文档展示，业务运行代码未改动。

| 文件 | 来源与用途 |
|---|---|
| app-splash-prototype.png／app-login-prototype.png／app-community-prototype.png | 本仓库docs/prototypes/mobile-app-v1原型，通过Playwright禁用动画后截取.phone；未改原型源，示例内容和数字不代表真实用户或已实现功能 |
| xstly1014-avatar.png | 本轮内置imagegen生成，用户随后指定作为本人贡献者头像；不是GitHub实际头像或真人肖像 |
| chatgpt-chibi.webp | fywdy/chatgpt-chibi-pets的ChatGPT白发龙娘idle.webp，未修改的参考源存档；不再作为README展示图 |
| chatgpt-avatar-v2.png | 参考上述白发龙娘身份及xstly1014头像画风，以内置imagegen重绘的单张静态头像；保留来源、CC BY-NC 4.0及NOTICE |
| tako-avatar-v2.png | 参考项目原Tako身份与服装、xstly1014头像画风重绘的静态头像；仅换README展示，不替换App/官网角色素材 |
| website-desktop-current-v2.png | 2026-11-03从当前本机3300官网匿名截图，1440px宽，保留test环境提示；不是旧官网图或新设计稿 |

本轮两张新头像与xstly1014头像统一为近景、圆形淡色背景及清晰赛璐璐线条，均为静态PNG。原Tako参考为`mobile/assets/tako-chibi.png`；旧官网截图不再被README引用。

## ChatGPT 同人素材

- 作者／发布者：[fywdy](https://github.com/fywdy)。
- 项目：[chatgpt-chibi-pets](https://github.com/fywdy/chatgpt-chibi-pets)。
- 固定提交：`d5bbb27c79e5c08e8b8ab44d4023cd35a67418e2`。
- 原文件：[idle.webp](https://github.com/fywdy/chatgpt-chibi-pets/blob/d5bbb27c79e5c08e8b8ab44d4023cd35a67418e2/chatgpt-white-dragon-chibi-v5/qa/previews/idle.webp)。
- 美术许可CC BY-NC 4.0：署名、非商业使用；不纳入本项目商业产品素材授权。[完整许可](chatgpt-chibi-LICENSE.txt)和[原始NOTICE](chatgpt-chibi-NOTICE.md)随文件保留；本项目不暗示官方合作或赞助。

## 生成头像记录

使用内置image_gen，未使用API/CLI。图片最初以AI协作头像为构思；用户随后指定作为xstly1014的头像，README按最终选择标记。

原始提示词：

> Use case: stylized-concept. Asset type: square contributor avatar for the GitHub README of Tako, an anime-themed youthful fiction community. Create ONE polished 2D anime chibi anthropomorphic character representing ChatGPT as a friendly coding collaborator, an original fan interpretation, NOT an official mascot. Adult-coded chibi woman, very large expressive emerald green eyes, short white-silver bob with a single emerald hair streak, subtle dark charcoal hair accessory, white and charcoal tech streetwear hoodie with emerald trim. Bust portrait, leaning slightly forward with a warm clever smile, one hand raising a small green pencil. Clean crisp anime linework and cel shading, readable at 96px, no glossy 3D. Simple pale mint circular backdrop on an off-white square background. Strong silhouette, face occupies most of square, generous edge safety for circular cropping. No text, no lettering, no official OpenAI knot logo, no watermark, no additional characters. Cheerful, young adult, capable and approachable, not infantile.

### ChatGPT 静态头像 V2 提示词

输入图1：上游ChatGPT角色参考；图2：xstly1014画风参考。使用内置image_gen。

> Create one STATIC square 2D anime chibi contributor avatar, NOT animation or a sprite sheet. Reference image 1 is the ChatGPT fan character identity: preserve long snowy white hair, subtle lavender shading, violet eyes, small white dragon horns, white/lavender outfit, tiny dragon-wing accents. Reference image 2 is ONLY the art style, framing and finish: match its bold crisp dark linework, confident layered cel shading, detailed bright eyes, adorable but adult-coded proportions, shoulder-up portrait filling the square, soft circular color backdrop on off-white. Do not copy image 2's green hair streak, pencil, outfit, or face identity. ChatGPT fan character should be cheerful and clever, smile with one hand near her cheek as if thinking, lavender neck bow and elegant compact white/lavender jacket details. Strong readable face occupying 60% of square, eyes aligned similar height as reference2, rounded-safe margins. Use pale lavender circular backdrop, no busy scenery. Polished youthful anime illustration, no text, no letters, no watermark, no official OpenAI logo. Single still portrait.

### Tako 静态头像 V2 提示词

输入图1：项目Tako身份/服装；图2：xstly1014画风参考。使用内置image_gen。

> Create one STATIC square 2D anime chibi contributor avatar, NOT animation or a sprite sheet. Reference image 1 is Tako's fixed original mascot identity: preserve the short dark navy bob with vivid royal blue streak/underside, big blue eyes, coral orange octopus hairclip, white shirt, royal-blue and white streetwear hooded jacket, orange octopus pendant and orange hardware. Reference image 2 is ONLY the art style, framing and finish: match its bold crisp dark linework, confident layered cel shading, detailed sparkling eyes, adorable but adult-coded chibi proportions, shoulder-up/bust portrait filling the square, clean circular backdrop on off-white. Do not copy image 2's white hair, green palette, pencil or outfit. Tako poses slightly turned with an energetic playful wink, joyful open smile, one hand giving a peace sign beside her face. Pose must feel alive but avoid broad full-body composition. Preserve recognizability and costume of reference1. Face fills 60% of square, eyes at similar height to reference2, rounded-safe margins. Pale blue circular backdrop on off-white, no scenery, no lettering, no watermark, no other characters. Clean, polished Japanese 2D anime avatar.
