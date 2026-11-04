# 长文／连载小说规格入口

更新：2026-11-04。N0 是业务规格基线；N1 私密开书与写章已接App和本机3300，包括加密离线续写、冲突恢复为独立新章节草稿。N2固定发布、正式管理、资料审核、处置复核与公开目录阅读已接App和本机API0.22.0；观察期运营入口与同批App/真实服务联调已补齐，原生证据仍交同事。N3完结/续读、N4追更和N5讨论仍属后续阶段。工程证据见[N1-A](../reviews/private-novels-review.md)、[N1-B](../reviews/private-chapter-drafts-review.md)，原生验收待同事执行。

- [业务规则](longform-business-spec.md)：创作、固定目录、发布、完结、整改、书架追更、私密续读和按章讨论。
- [交付与验收](delivery-and-acceptance.md)：纵向分期、失败场景、证据门槛及未决工程细节。
- [N1-A 模型决策](adr-001-private-books.md)：独立书籍、CAS、载荷绑定回执与迁移边界。
- [N1-B 章节决策](adr-002-chapter-drafts.md)：独立章稿表、固定请求、加密作用域和独立章节恢复。
- [N2 阶段规格](n2-publication-reading-spec.md)与[ADR003](adr-003-chapter-publication.md)：多章排队、提交预约章号、独立审核、正式发布与阅读；实时实现/证据及剩余P1见[连续复盘](../reviews/n2-publication-implementation-review.md)。
- [N3续读与完结整改规格](n3-reading-completion-spec.md)：连续工作区、定位/冲突、不可逆核对与一次整改；当前规划中，未交付运行入口。
- [主开发手册](../handoff/05-development-playbook.md)：主开发负责业务与自动化，同事负责打包和真机。

阅读约定：标为“用户确认”的是已确定业务权利；“工程默认”由实现阶段验证并固化；“待定”必须在指定阶段退出前解决。候选接口不是已交付 OpenAPI，不能拿本系列文档替代实现和集成测试。现有中篇、评论、草稿和搜索继续按原契约工作。
