# B1 验证边界与独立浏览器测试

正式自动化：`python scripts/test_backend.py` 在 writing_test 执行迁移、Go race/集成/契约测试和 vet。前端 `npm run typecheck`、构建和既有浏览器回归另验。

`scripts/b1_browser_smoke.cjs` 是真实服务浏览器测试，不使用 API 夹具。只允许在指向 writing_test 的临时 API/web/nginx 环境运行；origin 固定 http://localhost:3200，测试客户端与网关共享 network namespace。合成账号及标准 Cookie 会话在测试库预置，凭据保存在忽略目录 .runtime/b1-test/session.json，不是生产认证后门；不发送邮件。

运行前必须完成测试库迁移、构建 API/web，准备 .runtime/b1-test/api.env（仅指向 writing_test、PUBLICATION_ENABLED=true）、nginx.conf 与合成测试会话。三个容器名为 tako-b1-api/tako-b1-web/tako-b1-gateway；真实演练的准备记录在阶段复盘。此脚本依赖该显式准备，不能拿现有用户账号或 writing 用户库替代。

第一阶段验证：实际页面选择已保存草稿、填写元数据、固定预览；API 更新工作稿后重载仍能确认旧修订；服务器提交后拦掉响应，再从界面重试，只生成 V1；匿名且禁用 JavaScript 的 SSR 正确显示正文/no-store，移动宽度无横向溢出。

第二阶段由主机只对测试作品施加隐藏状态，再使用 B1_CHECK_HIDDEN=true 运行脚本，验证 SSR 404 且 HTML 不包含隐藏标题或正文。此 SQL 仅为测试注入，不是交付的运营入口；B2/B3 才交付实际隐藏和治理操作。

完成后移除上述三个临时容器，仅清理该合成账号的 B/草稿/会话数据；不删除数据卷或其他账号。数据结果和临时凭据不提交仓库。不能将这项测试称为真实邮箱或用户真机验收。

公开启用仍需完整 B 治理能力及既有域名/发信/运维门槛。默认 PUBLICATION_ENABLED=false；本机可独立开启，ECS 不随之改变。

## 可重复入口

完成 `python scripts/test_backend.py`、`docker compose build api web` 后运行：

```powershell
python scripts/test_b1_live.py
```

该脚本建立随机命名且带本轮标签的临时服务、仅 writing_test 的合成账号和会话，依次运行两阶段浏览器演练并清理。临时网关使用回环 3200 端口，端口占用时失败，不替换已有服务。辅助配置与凭据在独立 .runtime/b1-test-随机值 目录；结束清除 api.env/session.json，只保留无凭据的测试结果与网关配置。不会自动构建镜像、创建/迁移用户库或更新 ECS。
