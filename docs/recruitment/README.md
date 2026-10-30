# Tako 校园项目共创招募素材

当前为审阅稿，尚未代为发布、发送邮件或向公众号上传。

- `tako-recruit-long.png`：1080px 宽完整长图，供公众号插图与详细介绍。
- `tako-recruit-short.png`：邮箱联系短海报，可独立使用。
- `tako-recruit-short-qr-draft.png`：二维码版审阅稿，链接尚未提供，预留位不是二维码，不可作为可扫码成品发布。
- `long.html`、`short.html`、`short-qr-draft.html`：可编辑排版源文件；同目录图片需一起保留。
- `recruit-key-visual.png`：本次内置 image_gen 生成的原创招募主视觉，角色参考现有 Tako 看板娘；未替换产品原素材。

文案依据用户确认：大一至大三、研一至研二在校生，不限专业；基本技术背景、业务理解、AI 协作与开发热情；项目共创、非雇佣、暂无薪酬。联系邮箱 1125448766@qq.com。具体时间投入和职责待双方沟通，不虚构团队规模、职位数量或福利。小时数对比作为团队学习主张呈现，不作为求职效果数据或录用承诺。

二维码待公众号文章/公开链接提供后生成，需手机实扫核对目标再发布。公众号可直接上传 PNG；平台压缩效果需要在文章预览中复核。

## 重新导出

已有项目 Playwright 依赖与 Docker 时，在项目根目录运行：

```powershell
docker compose run --rm -v "${PWD}/docs/recruitment:/materials" browser-tests node /materials/render.cjs
```

导出脚本验证图片解码与横向溢出。1080px 原图用于上传，不要使用聊天窗口中的缩略预览保存。

## 主视觉最终提示词（内置 image_gen）

Reference: frontend/public/images/tako-mascot-v1.png. Original Tako adult anime mascot, preserve navy bob hair, vivid blue streak, blue eyes, coral octopus hairclip, blue-white streetwear jacket, skirt with opaque shorts and sneakers. Refined full-body mascot on right, welcoming hand, same-character chibi at bottom right. Youthful technology community campaign, cobalt blue, icy white, restrained coral, energetic clean cel shading. Landscape 1536x1024, quiet left negative space for separately typeset Chinese recruitment text, geometric stars and subtle portal rings. No text, letters, logos, watermarks or QR codes. Original character, not another brand mascot.
