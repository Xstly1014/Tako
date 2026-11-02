# 评论组件交互回归

这套测试运行真实 `CommentsPanel`、`AuthSheet`、`CommentEditor`、`Session` 和评论客户端代码，但把 React Native 控件替换为 DOM 适配器、业务服务替换为确定性夹具。用于检查组件事件连线，不是 React Native Web 产品，不是 Android 截图或权限验收。

覆盖：收起后再开保留输入；游客登录后确认带入而不自动发表；无笔名时设置后文字不丢；模拟成功后丢响应，重试同一请求只生成一次；根评论删除确认；回复与展开；换账号清空原账号未发表文字及本人处置原因。入口启用 React StrictMode，检查重复挂载/清理下的组件生命周期。DOM 适配器不模拟原生键盘、虚拟列表性能、安全区、系统返回或 Expo 导航容器，它们仍需真实设备验证。

依赖使用项目现有锁文件及 Docker 卷，不增加应用依赖。新电脑先准备依赖：

```powershell
docker run --rm -v "${PWD}/frontend:/app" -v writing-community_frontend_modules:/app/node_modules -w /app node:24-bookworm-slim npm ci
docker run --rm -v "${PWD}/mobile:/app" -v tako-mobile-node-modules:/app/node_modules -w /app node:24-bookworm-slim npm ci
docker run --rm --network none -v "${PWD}:/materials" -v writing-community_frontend_modules:/tools/node_modules -v tako-mobile-node-modules:/app/node_modules -w /tools mcr.microsoft.com/playwright:v1.56.1-noble node /materials/scripts/mobile-comments-ui/run.cjs
```

在仓库根目录执行。组件测试用 `--network none`，无需启动 3300，不会发邮件、访问真实账号或写数据库。前两条首次下载依赖与 Docker 镜像本身需要网络；命令不会复制根 `.env` 到 App。

另外运行 `mobile/` 的类型、lint 和完整 Node 测试。`comments-service.test.ts` 才访问真正的 3300 测试服务；不能把本夹具报告填到真实服务或真机证据栏。失败截图只含夹具内容，写入忽略目录 `.runtime/mobile/qa/`，不能拿来当原型视觉基线。
