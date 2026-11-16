# Tako 本机重启手册

适用于停止Docker，或删除容器/镜像但保留数据卷后的原机恢复。当前运行基线见[项目状态](../project-status.md)；新电脑用[工程初始化](../handoff/02-engineering-and-setup.md)，不要套用原机卷身份。

## 最短路径

打开Docker Desktop并确认Linux containers，在仓库根目录执行：

```powershell
python -X utf8 scripts/local_restart.py start
python -X utf8 scripts/local_restart.py check
```

镜像缺失时自动构建；源码更新但镜像仍旧时，用start --rebuild。Go模块网络失败且固定缓存已齐，可用start --offline；缺缓存会失败，不关闭依赖校验。

成功标准：原数据库身份保留、迁移完成、就绪与Web/API可访问、test标记正确、maintenance最近成功心跳。入口是http://127.0.0.1:3300/community，不能任意改Host。成功启动不证明APK、手机体验、邮件送达或生产上线。

## 数据保护与恢复

保留.runtime、backups、数据库和缓存卷；不使用down -v、volume prune或system prune --volumes。非空业务迁移的回退保护不能靠删表或清用户数据绕过。主开发负责设备，Agent同事不重复承担；重启不安装手机、不造数、不修改系统信任，也不连接暂停的ECS。

需要新快照时，在停止测试写入的安静窗口执行：

```powershell
python -X utf8 scripts/local_test_restore.py
```

它加密备份独立测试库并在临时MySQL核对全字段指纹，不覆盖源库；文件在backups/local-test，密钥在.runtime/local-test/recovery.key，两者均不提交。维护可能改变业务数据，演练前应按现有流程暂停维护并在finally恢复。指纹变化或依赖失败就不能宣称恢复通过。本机恢复不是离机备份。

验证短帖配图时，测试库需要有至少一张被正式版本引用且仍有内容的图片。运行下面的命令会在全表指纹一致后，额外核对恢复库中这类图片的数量和字节数。

~~~powershell
python -X utf8 scripts/local_test_restore.py --require-short-post-media
~~~

详细步骤：[本机状态与保留项](01-local-state.md)、[失败与恢复边界](02-recovery.md)、[交接入口](../handoff/README.md)。可用$tako-restart触发原机恢复，$tako-handoff用于跨电脑/会话接手。

[整理前入口快照](../history/2026-11-06/restart-entry.md)仅供追溯，不执行其中已失效的版本或设备分工。
