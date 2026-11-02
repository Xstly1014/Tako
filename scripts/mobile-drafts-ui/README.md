# C1 草稿实际路由夹具

从根目录运行 `node scripts/check_mobile_drafts.cjs`。使用既有 Docker 工具/依赖卷，在禁网容器里构建实际 account、drafts/index、drafts/[id]、DraftAccessGate 和编辑组件；替换原生视图/导航适配器、会话传输、原生工厂。会话、授权门面、仓储、编辑与同步模型仍使用产品实现。

此处安全项/行存储在内存，Crypto 使用浏览器 WebCrypto；HTTP 为受控模拟，不能记为 Android SecureStore/SQLite、真实 API、键盘/生命周期或外观截图验收。真实 SQLite/AES、HTTP/MySQL 另由已分类的 drafts-storage/drafts-sync/drafts-service 测试验证。

覆盖恢复确认、新建、中文表情重开、保存失败与返回保护、锁定后换错账号再切回原账号恢复未存输入、丢回执沿原请求确认、本机冲突另存、退出未同步提示及其失效隐藏、另一账号列表隔离。只输出固定阶段/通过，不转发断言值和页面正文。

该独立入口已由主开发实际运行；目前未修改并行端维护的 CI workflow/四套组件分类。请求 CI 维护方接入这个入口或提供等价分类后，以该次 CI 记录关闭自动门禁尾项；不能据本机运行声称已在远程执行。模型与服务新增用例仍在既有分类文件内。
