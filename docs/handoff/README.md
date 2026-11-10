# Tako 开发交接入口

先读[当前项目状态](../project-status.md)，再读[主开发进度](primary-progress.md)与[并行端进度](parallel-progress.md)。本页只提供接手顺序，不累加运行版本快照。

## 接手顺序

1. 根AGENTS.md及business-first；持续协作另读tako-collab。
2. [业务背景与状态](01-product-and-status.md)、[长文规格入口](../novels/README.md)、[N5复盘](../reviews/n5-discussion-discovery-stage-review.md)。旧背景文件的阶段描述按其日期读取，当前状态以统一状态页核对。
3. [新电脑工程与环境](02-engineering-and-setup.md)；原电脑服务恢复用[重启手册](../restart/README.md)，不重新初始化已有数据库。
4. [主开发手册](05-development-playbook.md)、[并行端手册](06-parallel-development-playbook.md)、[接手清单](07-primary-takeover.md)及[设备队列](device-requests.md)。

## 当前协作规则

主开发负责全部非Agent开发/集成/设备，并行端专职Agent/业务评测。双方各写自己的progress；历史[并行建议](03-parallel-work.md)不能覆盖用户最新分工。推送前fetch并核对对方实际分支、新增提交、进度及重叠，普通合并，不force。对方无新发布不代表没有在途工作。

可转交的[接手提示](04-codex-start.md)与[C1/C2接口约定](c1-c2-interface.md)仍保留；阶段事实绑定原提交，不把旧包结果套给新源码。

## 本地资料与边界

.env、凭据、数据库卷、.runtime、backups、SSH私钥、APK和SDK不随Git交接。新电脑自行准备隔离配置/合成数据，不能复制真实用户内容来跑测试。ECS暂停；不自动改手机/系统信任或重复要求用户逐项实测。

[整理前入口快照](../history/2026-11-06/handoff-entry.md)用于追溯，现行操作不从历史快照执行。[完整文档目录](../catalog.md)可查找专题和历史证据。
