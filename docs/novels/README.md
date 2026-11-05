# 长文／连载小说规格入口

更新：2026-11-05。N1私密开书与离线写章、N2固定发布/正式管理/观察期及中篇先审、N3私密续读/不可逆完结/一次指定整改已接本机API0.26/迁移24和实际App/Web入口。N3工程自动化闭环见[连续复盘](../reviews/n3-reading-completion-implementation-review.md)，不是真机或真实用户业绩。当前设备不可用，主开发持有P0 C1及新页验收；同事专职Agent。N4追更、N5按章讨论与长文发现未实现。

- [业务规则](longform-business-spec.md)：创作、固定目录、发布、完结、整改、书架追更、私密续读和按章讨论。
- [交付与验收](delivery-and-acceptance.md)：纵向分期、失败场景、证据门槛及未决工程细节。
- [N1-A 模型决策](adr-001-private-books.md)：独立书籍、CAS、载荷绑定回执与迁移边界。
- [N1-B 章节决策](adr-002-chapter-drafts.md)：独立章稿表、固定请求、加密作用域和独立章节恢复。
- [N2 阶段规格](n2-publication-reading-spec.md)与[ADR003](adr-003-chapter-publication.md)：多章排队、提交预约章号、独立审核、正式发布与阅读；实时实现/证据及剩余P1见[连续复盘](../reviews/n2-publication-implementation-review.md)。
- [N3续读与完结整改规格](n3-reading-completion-spec.md)：连续工作区、定位/冲突、不可逆核对与一次整改；实际入口和工程证据已交付，Android尾项单独验收。
- [主开发手册](../handoff/05-development-playbook.md)：主开发负责非Agent业务、自动化及设备；同事专职Agent评测。

阅读约定：标为“用户确认”的是已确定业务权利；“工程默认”由实现阶段验证并固化；“待定”必须在指定阶段退出前解决。候选接口不是已交付 OpenAPI，不能拿本系列文档替代实现和集成测试。现有中篇、评论、草稿和搜索继续按原契约工作。

下一连续包规格：[N4书架、追更与站内新章提醒](n4-shelf-follow-spec.md)。两项权利已确认；N4-A服务内核源码API0.27/迁移25及严格客户端已实现，运行仍0.26/24，App页面/提醒尚待。[ADR004](adr-004-shelf-subscriptions.md)与[阶段记录](../reviews/n4-shelf-follow-stage-review.md)区分证据，不把订阅记录当提醒已送达。
