# 文档索引

当前以独立Android App为开发重心，Web共享同一Go API。README是产品介绍，本目录保留工程入口、业务规格与按提交绑定的验证证据。

先读[统一项目状态](project-status.md)，需要查找文件时用[完整文档目录](catalog.md)。目录组织与归档约定见[文档维护规则](maintenance.md)。

## 当前入口

| 需求 | 文档 |
|---|---|
| 接手项目与核对进度 | [交接入口](handoff/README.md) · [主开发](handoff/primary-progress.md) · [并行端](handoff/parallel-progress.md) |
| 现有电脑重启 | [重启手册](restart/README.md) |
| 新电脑初始化 | [工程与环境](handoff/02-engineering-and-setup.md) · [环境与合成数据](environments-and-synthetic-data.md) |
| 开发、接口与恢复 | [开发指南](development-guide.md) · [API](api.md) · [运行与恢复](operations.md) |
| 协作、设备待验 | [并行边界](handoff/03-parallel-work.md) · [开发手册](handoff/05-development-playbook.md) · [设备清单](handoff/device-requests.md) |
| README图片／贡献展示 | [图片来源与许可](images/readme/README.md) · [GitHub Contributors说明](contribution-display.md) |

## 业务与设计

- [长文系列](novels/README.md)：规则、ADR、分期及失败验收，当前N5讨论链路已接，下一包为长文元数据搜索。
- [中篇修订发行](mobile-author-revision-stage-spec.md)与[作品工作台](mobile-author-catalog-stage-spec.md)：具体交付以对应分支/复盘为准。
- [App原型](prototypes/mobile-app-v1/README.md)：用户当前认可的视觉方向；示例数据不代表业务已实现。
- [视觉系统](visual-system-v2.md)与[页面布局规则](design/layout-rules-v4.md)：注明日期和适用范围，原型不能替代运行页面。

## 历史与证据

[阶段复盘](reviews/)按主题/日期/提交保留，包含成功、失败与未完成项；不能仅因日期早或没有导航链接而删除。根目录业务共识与增量A/B HTML、B/品牌原型、SMTP/ECS说明仍用于追溯历史决策或特定工具，不是当前公开部署承诺。

设计目录只保留仍有明确引用的选定截图；新自动导出PNG默认不纳入版本管理。需要作为新基线时，先核对合成数据与页面版本，再用`git add -f`有意选入具体图片，不批量强加整个目录。旧的无引用截图、被替换的官网图及重复开发快照已清理，恢复需查看Git历史，不保留另一套废弃副本目录。
