# 私密书籍真实客户端联调

只针对本机3300/test，先迁移并重建自己的API；不会连接ECS或发信。用真实NovelsApi/BookWriter与MySQL验证资料创建／CAS／账号隔离／丢响应回执。创建两个UUID@example.test合成账号；索引只记录清理位置，不含令牌。

```powershell
node --experimental-strip-types scripts/mobile-novels-service/acceptance.cjs
python scripts/mobile-novels-service/cleanup.py
```

无论成功失败都执行cleanup；它严格限定本次索引的合成邮箱，不接受自定义邮箱或全库清理。存在上次索引则拒绝新一轮，先清理。不会把模型或DOM叫真机通过。

后端完整隔离回归：`python scripts/test_novels_backend.py`，仅writing_novels_test；本机需已有独立local-test配置与MySQL。组件门禁 `node scripts/check_mobile_drafts.cjs` 包含C1导航与小说表单；小说单独复验可运行 `node scripts/check_mobile_novels.cjs`。沿现有CI入口，无新增工作流。
