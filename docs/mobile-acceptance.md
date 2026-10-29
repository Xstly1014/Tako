# iPhone 与 ECS 双设备验收

此入口仅用于验收，不替代实名域名的公网 HTTPS。ECS 主应用依旧只有 SSH 可达的 127.0.0.1:3100；手机使用额外的私有来源和 Secure Cookie，不放松桌面 Origin 校验。

## 最终路径

手机 Safari HTTPS → 电脑原生 Caddy → 本机 SSH 3102 转发 → ECS 回环 3101/mobile-gateway → mobile-api → 同一云端 MySQL。电脑仍通过 SSH 的 localhost:3100 使用主 API。

Tailscale 曾按用户选择安装，但 iPhone App Store 无法安装，未完成设备授权；客户端已停止并禁用，未启用 Funnel。Docker Desktop 的热点入站转发在本机正常、手机不可达；改为原生 Caddy 后用户确认可以下载证书。不能将本机 HTTP 200 当作真机连通性证据。

## 准备

1. 电脑连 iPhone 热点，记录电脑 IPv4 和网关（手机）IPv4；地址变化时必须重配，不能复用不匹配的证书。
2. `python scripts/mobile_https.py 电脑IP 手机网关IP`：生成最长七天的开发 CA/服务证书，并从 infra/Caddyfile.mobile-ecs.template 生成本机配置。工具不安装系统信任。
3. 若需要：`python scripts/install_caddy.py` 下载官方 Caddy 2.11.7，并验证 GitHub release asset SHA256；二进制位于忽略目录。
4. 云端合并 infra/compose.ecs-mobile.yaml 与主配置，MOBILE_APP_ORIGIN 设为 https://电脑IP:3443。mobile-api 和主 API 共享账号/草稿库，但仅接受各自准确来源。
5. SSH 增加本机 127.0.0.1:3102 → ECS 127.0.0.1:3101 转发；只在本机监听。
6. Caddy 原生运行 .runtime/mobile-certs/Caddyfile，只绑定电脑热点地址，并只允许手机和电脑两个地址。管理接口关闭，不启用自动公有证书或访问日志。
7. Windows 如需放行，由用户以管理员权限创建 Tako-iPhone-Acceptance 规则，仅针对电脑 IP、手机 IP 和 TCP 3443/3444。当前工具账号没有读取/修改防火墙的管理员权限，不应绕过该限制。
8. 手机通过 http://电脑IP:3444/tako-dev-ca.cer 下载 CA，在设置中安装 Tako Local Test CA，再在“关于本机→证书信任设置”中启用信任。打开 https://电脑IP:3443/workspace。

## 验收

先验证真实登录、中文/表情保存、刷新、切 App 后继续输入。再让电脑和手机打开同一份测试草稿：保持手机旧基线，电脑保存新版，手机后提交应自动另存，不覆盖电脑版本。

断线演练可以仅停止云端 mobile-api，保持页面、热点和 SSH：手机继续输入并暂存，电脑仍可保存；恢复 mobile-api 后应自动同步，有冲突则另存双方。这样不会因为热点 DHCP 变更导致测试源站地址变化而混淆 IndexedDB 的按源隔离。

## 已有技术检查

开发 CA 的证书链/IP校验通过；HTTPS 透传到 ECS 的健康检查 200，私密接口匿名 401，正确来源的无效 JSON 返回 400，错误来源返回 403。上述不能代替用户的 iPhone 输入/保存验收。

## 清理

测试结束：停止 Caddy，停止云端 mobile-api/mobile-gateway；用户在 iPhone 移除 Tako Local Test CA 描述文件，并以管理员 PowerShell 执行：

```powershell
Remove-NetFirewallRule -Name "Tako-iPhone-Acceptance"
```

不删除本机或云端草稿。开发 CA 私钥仅存 .runtime，禁止提交和上传；电脑/手机的证书信任必须由用户控制。


## 最终结果 · 2026-10-30

用户确认：实际 iPhone 下载/安装信任开发证书后，真实登录、中文/表情保存刷新、切 App 返回保存均正常。电脑/手机打开同一份测试草稿，仅停止手机 API，手机继续输入显示未确认，电脑保存新版；恢复手机 API 后自动另存恢复副本，用户确认两份均完整且可重开。

临时手机云端服务与电脑 Caddy 已停止；用户确认移除证书与防火墙规则。未删除任何草稿，电脑 SSH 3100 与 ECS 核心服务继续运行。

## 待补测

用户选择在稳定 HTTPS 入口就绪后补测真机粘贴、Wi-Fi／蜂窝切换，最迟在邀请外部作者进行移动端测试前完成。当前服务断链演练不能替代这两项。验收要求是内容完整、保存状态准确、恢复同步无覆盖。
