# 历史阅读组件组合检查

使用真实 ReaderScreen、VersionTimeline、CommentsPanel 和内存编辑器，复用评论夹具的账号传输与 DOM 原生控件适配器；网络禁用，读取响应由 Playwright 拦截。不是原生布局、键盘、路由/系统返回或真实权限测试。

准备依赖卷方式同 `../mobile-comments-ui/README.md`，从仓库根目录执行：

```powershell
docker run --rm --network none -v "${PWD}:/materials" -v writing-community_frontend_modules:/tools/node_modules -v tako-mobile-node-modules:/app/node_modules -w /tools mcr.microsoft.com/playwright:v1.56.1-noble node /materials/scripts/mobile-versions-ui/run.cjs
```

覆盖节点只看元数据、授权后显式切换、真实阅读组件正文更新、评论收起再打开输入保留、读取失败保留原正文、迟到响应不覆盖新选择、分页失败重试与节点去重、受限节点不补齐。滚动适配器只记录 scrollTo 调用，不证明手机实际滚动行为。
