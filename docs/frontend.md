# Nuxt 写作空间（增量 A）

## 本机入口

- 首页：http://localhost:3000/
- 私密草稿：http://localhost:3000/workspace
- Swagger：http://localhost:3000/docs/

页面与 Go API 通过 Nginx 同源接入；Nuxt 不直连 MySQL，不持有 SMTP 凭据。生产构建使用非 root Node 进程。公开首页服务端渲染，workspace 使用客户端交互并标记 noindex。

```sh
docker compose up -d --build api web gateway
# 已存在网关时，绑定文件更新不会自动重载：
docker compose exec gateway nginx -t
docker compose exec gateway nginx -s reload
```

浏览器编辑需要 HTTPS 或 localhost。其他 HTTP 来源明确提示连接不支持，不提供降级随机数或绕过登录。

## 用户行为

- 验证码通过真实 API 入队，用同一个 delivery_id 检查状态；queued 不显示为送达。主动重发独立操作，受冷却限制。
- 登录后设置笔名，创建和分页查看私密草稿，纯文本编辑，导出 TXT。
- 输入先写 IndexedDB，序列化提交；请求 mutation_id 在网络请求前保存，超时保留原请求重试。
- 后到的确认只更新所对应快照，不清空新输入。跨标签页用本机事务、租约和条件更新保护；不依赖“一个页面只有一次请求”来推断全局安全。
- 本机缓存基线被另一窗口刷新后，旧编辑页仍保留其实际基于的修订，不继承新基线覆盖服务端。
- 冲突自动另存服务端恢复草稿；另存成功才提示双方已保留。不自动合并，不强迫立即整理。
- 登录过期暂停同步但仍可编辑；重登原账号自动处理其待同步记录。账号变化不显示和同步原账号内容。
- 主动退出立即隐藏编辑内容，保留本机草稿，无清理确认。服务端撤销失败如实提示；本机保留不是设备加密。
- 浏览器禁用存储或发生写入异常时，显式进入页面内存模式，服务端保存仍可继续；刷新／关闭可能损失未同步部分，可导出。内存模式不冒充持久保存。
- 完全断网启动网站不在本轮承诺范围。没有离线 Service Worker，也没有草稿删除或富文本功能。

## 检查命令

```sh
docker compose run --rm frontend-tools npm test
docker compose run --rm frontend-tools npm run typecheck
docker compose run --rm frontend-tools npm run build
docker compose run --rm browser-tests npm run test:e2e
```

浏览器测试使用实际 Chromium、真实页面和 IndexedDB；API 由 Playwright 拦截器提供测试协议，所有未知 API 中止，不向真实邮箱发信。浏览器容器共享网关网络命名空间，以 localhost 获得标准安全上下文，不关闭浏览器安全检查。

这不能代替真实 DirectMail、浏览器 Cookie 与 Go 服务的一整条验收；没有测试登录后门，真实环境仍需真实邮箱验证码。

## 依赖选择与待办

Nuxt 4.6.3、Vue 3.5.44、Vue Router 5.4.0、Dexie 4.2.1；Node 24。TypeScript、Vitest、Playwright 精确版本见 package-lock.json。

最新自动解析的 rolldown 1.2.16 下载返回 404，当前暂时 override 至可下载并通过构建的 1.2.15；注册源修复后移除临时 override 并回归，不静默长期冻结。

审计仍报告 7 个 low 条目，集中在 deepmerge 的传递依赖链；moderate／high／critical 为 0。未采用会回退 Nuxt 并重新引入已修复问题的 audit --force 建议。上线前仍需完成影响评估及可用补丁跟踪，不宣称零漏洞。

待验收：真实邮件和 Cookie 登录、Safari／Firefox、中文输入法与真实手机、IDB 真实配额耗尽、存储容量和恢复演练。测试中的 API 中断不是所有网络切换场景的替代证据。
