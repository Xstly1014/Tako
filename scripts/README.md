# 工具脚本导航

本目录保留原路径，避免破坏CI、技能或跨电脑交接中的调用。当前业务和运行状态见[项目状态](../docs/project-status.md)，本机凭据与运行产物不在此目录提交。

| 任务 | 入口 |
|---|---|
| 原机恢复/健康 | local_restart.py；先读[重启手册](../docs/restart/README.md) |
| 合成环境/数据 | local_test.py、[环境说明](../docs/environments-and-synthetic-data.md)；已有库不重复初始化 |
| 加密备份与独立恢复 | local_test_restore.py、recovery.py；不等于离机备份 |
| 后端真实MySQL/契约 | test_novels_backend.py；--run定向检查，阶段定稿再跑整批 |
| 迁移保留与拒回退 | test_*_migration.py；只操作专用隔离库，不拿应用库练回退 |
| App契约/模型/组件门禁 | check_mobile_contract.cjs、check_mobile_tests.cjs、check_mobile_components.cjs；依赖见[工具说明](mobile-checks/README.md) |
| 真实App源组件到服务 | check_novel_reading_live.cjs、check_novel_publication_live.cjs；DOM/journal替身不是Android证据 |
| 文档目录 | build_document_index.py；只更新[文档总目录](../docs/catalog.md) |

其他浏览器、构建、部署及排查脚本按其顶部说明和对应阶段复盘使用，不因名字包含check就直接对未知环境执行。运行脚本前检查目标是test环境、是否写数据、是否需要恢复前提；不得打印凭据、正文或直接套用生产配置。
