# SMTP 本机验收

## QQ 邮箱

使用 smtp.qq.com、465、implicit TLS。完整 QQ 邮箱地址填入 SMTP_USERNAME，SMTP_FROM 使用同一发件地址；SMTP_PASSWORD 填第三方客户端授权码，不是 QQ 登录密码。

官方授权码指引：https://help.mail.qq.com/detail/106/985

配置只保存在被忽略的 `.env`。不得将授权码、验证码或完整 SMTP 会话转储写入日志、文档及提交。

## 验收层次

1. 网络：TCP/TLS 能否连接，不验证账号，不发送。
2. SMTP：服务商是否接受本次邮件，不等于收件箱送达。
3. 收件：用户确认实际收到，记录是否进入垃圾箱及延迟。
4. 应用：用户在 Swagger 验证码登录，Cookie 会话、退出与私密草稿链路正常。

## 仅一次指定任务尝试

经用户授权的收件地址填入本机 SMTP_CHECK_TO，为这次测试生成一次稳定 UUID 填入 SMTP_CHECK_DELIVERY_ID。构建后执行：

```sh
docker compose build api
docker compose --profile smtp-check run --rm smtp-check
```

工具只领取指定 delivery_id，不启动全量 worker、不自动循环重试，不打印验证码和凭据。成功会输出状态 sent（SMTP 接受）。失败先调查，不通过更换 ID 反复轰炸收件箱；同 ID 再执行可能重试同码，应在确认测试范围后进行。

SMTP 接受但回执丢失仍可能形成不确定结果，不能把一次程序调用宣称为绝对只送达一封。

常规 mail-worker 需另行启动，不能将 smtp-check 当成生产发送服务。测试使用的个人收件地址和稳定 ID 不写进仓库文档。


## Resend 本机测试

在 .env 配置 MAIL_PROVIDER=resend、RESEND_API_KEY 与 RESEND_FROM=onboarding@resend.dev。原 SMTP_* 可以保留，选择 Resend 时不使用。API Key 不填入前端或聊天。Resend 测试发件人仅向注册邮箱投递；对外用户需验证自有域名。

上面的 smtp-check 历史命名保留兼容，它按 MAIL_PROVIDER 选择发送器，同样只执行一次指定任务。成功表示服务商接受，需本人确认收件。已经收到验证码可直接在 /workspace 填邮箱和验证码登录，不需要先点获取验证码。测试阶段不启动全局 worker。
