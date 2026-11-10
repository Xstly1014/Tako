# 文件与文档维护规则

## 入口与证据分开

- README.md负责产品介绍；docs/README.md负责导航；docs/project-status.md汇总当前业务、运行和未完成项。
- handoff/README.md和restart/README.md只放接手/操作步骤，不逐批追加“当前版本”段落。
- 业务权利放对应规格和决策账本；阶段结果放reviews并绑定源码/证据层级；认领与协作各写自己的progress，不修改另一端进度。
- 旧入口快照放history并显式标为历史，保留指向当前入口的链接。日期早、没被首页链接不等于废弃。

## 目录边界

| 位置 | 用途 |
|---|---|
| backend、frontend、mobile | 运行源码与各自测试，不为整理改路由/模块结构 |
| agents/author-support | 并行端所有；整理时不改评测、费用证据或其进度 |
| scripts | 开发、验证、恢复工具；分类见scripts/README.md，不任意移动被CI引用的脚本 |
| infra、.github | 环境模板与CI，不把本地Compose当生产交付 |
| docs/novels、publication | 业务规格与模型决策 |
| docs/reviews | 阶段结果、失败、互审与退出门槛 |
| docs/handoff、restart | 协作与本机恢复手册 |
| docs/prototypes、design、brand、images | 原型、设计与素材来源；不能当已接入产品 |
| docs/history | 历史入口快照，现行指令优先看入口 |
| .runtime、backups、.env | 本地运行资料/凭据/备份，不提交、不作为文档整理删除对象 |

根目录三个业务HTML仍有历史评审引用和既有打开路径，保留原位。未经核对不批量搬迁/删除图片、APK缓存、数据库卷或脚本。确需迁移时同时修正Markdown/HTML、代码、CI和技能引用，再核对旧入口的兼容方式。

## 更新与校验

新增文档后从仓库根运行：

```powershell
python -X utf8 scripts/build_document_index.py
```

提交前检查git diff --check及新增/迁移链接。文档整理不重跑无关Go/App全量测试，不启动服务或发送外部通知。目录生成脚本仅枚举docs内的Markdown/HTML，不读取.env或扫描运行数据。历史记录不改写成当前完成声明。
