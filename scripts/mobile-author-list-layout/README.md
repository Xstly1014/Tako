# 作者作品列表布局验证

渲染真实 `AuthorCatalogView`，用显式 DOM 适配映射当前组件使用的 RN 样式，检查 360×640 / 390×844 / 430×932。输入是本机 test API 本人目录的已保存快照，包含至少四条合成作品、长标题和真实评论/收藏统计；不是凭据文件。不能把本脚本当作原生字体、键盘、手势、安全区或 HTTP 交互测试。

复现（PowerShell，已具备既有锁定依赖卷）：

```powershell
New-Item -ItemType Directory -Force .runtime/mobile/qa/author-list-20261104/empty-host-modules | Out-Null
docker run --rm --network none `
  -e LAYOUT_FIXTURE=/materials/.runtime/mobile/qa/author-list-20261104/catalog.json `
  -v "${PWD}:/materials" `
  -v writing-community_frontend_modules:/tools/node_modules:ro `
  -v tako-mobile-node-modules:/app/node_modules:ro `
  -v "${PWD}/.runtime/mobile/qa/author-list-20261104/empty-host-modules:/materials/mobile/node_modules:ro" `
  -w /tools mcr.microsoft.com/playwright:v1.56.1-noble `
  node /materials/scripts/mobile-author-list-layout/run.cjs
```

数据与截图只存忽略目录。脚本检查无版本或管理动作、长标题/横向溢出、筛选取消与应用、确认按钮可触达及无匹配状态。真实 API/账号归属由后端集成、服务组与整条作者联调验证；实际 Android 操作另见 `docs/reviews/mobile-ui-rework-stage-review.md`。
