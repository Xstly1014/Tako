# M3共享契约触点（并行端维护）

2026-11-03：用户已明确并行端承担M3完整前后端，并要求先协调共享契约范围。此记录随独立分支先发布，主开发是否读取/确认另记；不把无回复视为其没有进行中工作。

本端只认领OpenAPI中GET /api/my/works的参数/描述、AuthorWorkPage/摘要的向后兼容扩展；服务端入口限work_management.go的列表GET，查询新增独立catalog.go，不改原管理动作/发布、小说或章节接口。生成mobile/src/api/contract.d.ts由完整OpenAPI重新生成，不手拼。

主开发N2的目录/章发布路径及schema保持原归属。共享触点是同一个OpenAPI文件及生成声明，不能凭“不同段”声称无语义冲突；每次推送前fetch并读N2增量，只合入双方事实源后重新生成并跑契约/真实MySQL。若出现同一段的新认领或不兼容接口，暂停该接点并协调，保留双方工作；不ours/theirs、不强推、不改锁/构建。

候选参数q、visibility、restriction；旧请求继续UUID游标，新模式携带带账号/条件绑定的不透明游标。摘要新增latest_title和display_limited，不改变platform_limited含义。详见../mobile-author-catalog-stage-spec.md；该规格不是已交付接口，验证完成前不声明兼容通过。
