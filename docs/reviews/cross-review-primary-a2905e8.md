# 主开发交叉审查与整合 · a2905e8

2026-11-02。审查对象为并行端 a2905e8（相对此前已集成 5f153c3），已读取该 ref 的 parallel-progress、C1 CI/独立审查与 publication-state-read 报告及实际差异。main 保留双方历史普通合并至 2cfd6fb；工作区先保存本端检查点 710d04a、0e0e0b3，未覆盖同事的范围。

## 审查结论

未确认此次新增代码的 P0/P1 阻塞缺陷。C1 独立路由步骤的 runner 目录预建发生在首个 root 容器之前，保持用户归属而非放宽权限、跳过或加重试；失败脱敏门禁覆盖 CLI 子进程错误/超时。对方原 099c36d 的远程成功是其历史证据，本次本机重新运行六项门禁及五套页面夹具。

接受 2b2b952 对已确认发布与现状 GET 的隔离：refreshState 清空过时可读状态，只为 GET 单独记录读取失败；PublicationFlow 原确认与 journal 未被改写。重试入口通过原有 run 锁串行，只调 GET；身份/代次和 mounted 校验仍存在，未知现状不猜测公开权限。新增发布组件回归实际确认失败时仍显示 V1、重试只增加 GET，未增加 POST。

对方发现本端 9653d74 另存竞争 P2 成立，已在 710d04a 修复并新增确定顺序模型及路由回归；详见 mobile-draft-copy-concurrency-review。这里不把本人修复后的自查算作对方已复验，需其按新 SHA 独立回应。

## 整合证据与边界

- 2cfd6fb 整合树：86 模型、11 顺序真实 API/MySQL、四套原组件及独立 C1 路由、OpenAPI 生成一致性和 6 项门禁检查通过，零 skip/todo。Mobile 类型/lint 由同一冻结源码构建检查。
- 真实服务第一次在 community 预检收到 503，尚无测试执行；local_restart check 确认 test 环境/数据库健康和入口恢复后重新运行，11 项全通过。未定位首次 503 根因，不能称已修复偶发服务问题；再次出现时保留请求 ID/状态和资源指标排查，不输出正文/凭据。
- 本端 frontend 更新独立见 frontend-dependency-audit-review；未改对方 CI 文件或阈值，改变的前端依赖使新机组件依赖安装可获得修复版。
- APK 以 2cfd6fb 的 Mobile 运行源码冻结重建；构建/指纹/远程 CI 在后续结果段补齐。不以中途 710d04a 包替代整合包。
- 设备未连接，原生生命周期/输入/安全存储 P0 未关闭；ECS 未操作。合成测试和工程结果不代表真实增长或治理业绩。

## 本轮最终结果

- 冻结 Mobile 源码 `2cfd6fbe198dddc33a2ff640f21b0928b822c485`；其后的 4c63ad0 仅文档变化。构建前后运行源码/依赖/配置差异为空，没有在打包中途混入并行改动。
- Android 标准构建 7m54s，581 任务（46 执行、535 缓存），入口类型/lint及 apksigner 验签通过。`.runtime/mobile/artifacts/tako-test-0.1.0.apk` 为 60,026,558 字节，SHA-256 `c5740f459877fb6f6a5d2181a0da18cefbc852b4bf465c75edd9f133a0aef541`；Hermes bundle 2,529,140 字节。直接核对 saveInputs、副本/交接校验标识、C2 新错误文案已入包，两种 ARM ABI 的 SQLite 库存在。未安装/执行真机。
- 源码整合提交 4c63ad0 的 [Mobile](https://github.com/Xstly1014/Tako/actions/runs/41455088741) 全四作业（包含新 C1 step）、[Frontend](https://github.com/Xstly1014/Tako/actions/runs/41455088475)、[Backend](https://github.com/Xstly1014/Tako/actions/runs/41455088445) 均 completed/success。首次关闭原 frontend moderate 门禁失败，不是降低审计阈值。最终补录只改文档，不能据此称后续新源码也已验过。
- 前端锁生成后，另对原组件共用依赖卷执行 npm ci，五套移动页面回归重新通过；没有依赖旧锁的本机绿灯代替新依赖验证。

本阶段工程收口。剩余：P0 真机输入/粘贴、后台/杀进程、切网、授权恢复和发布返回在真实移动作者使用前完成；P2 deepmerge 低危/临时覆盖的上游退出条件见依赖报告；P2 首次预检 503 未复现根因，如再现先采集脱敏请求状态/资源证据再扩测；710d04a 的同事独立复验待回应，不能冒称其已认可。无新的真实用户或生产运行结论。
