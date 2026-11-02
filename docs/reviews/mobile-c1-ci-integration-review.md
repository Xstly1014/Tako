# 新 C1 路由远程门禁接入复盘

2026-11-02。并行端维护。主开发源码审查绑定 9653d74，预推送合入仅文档 main 0e1e60e；本端首次整合推送为 303d657。目标是让既有 C1 CLI 在远程真实执行，不以旧四套组件结果关闭新路由尾项。

## 实现与首轮真实失败

工作流 component-fixtures 在原四套后增加必跑 `node scripts/check_mobile_drafts.cjs`，相同锁定依赖卷和禁网执行，不改主开发 CLI 或源码。新增子 CLI 失败/脱敏检查后，本机 6 门禁、85 模型、11 服务、类型/lint/契约、原四套及 C1 路由和 actionlint 通过。

[首轮 Mobile](https://github.com/Xstly1014/Tako/actions/runs/41446434106) 的 Windows/Linux 静态/模型通过，但新 C1 step 失败，未开始其浏览器业务断言。安全日志证据为 `EACCES: permission denied, mkdir '.runtime/mobile/qa/empty-host-modules'`，指向 `check_mobile_drafts.cjs:5:4`。不把该失败抹为随机波动，也不拿本机通过或其他 job 代替。

原因：前面的 Docker 夹具以 root 创建 bind-mounted `.runtime/mobile/qa`；Linux runner 后续以普通用户创建 C1 遮蔽目录时没有父目录写权限。Windows 主机卷未暴露相同 UID 所有权行为，不能据本机绿灯推定 Linux 可用。

## 修复与验证

在任何工具容器运行前，由 runner 执行 `mkdir -p .runtime/mobile/qa/empty-host-modules`，让父路径和 C1 必需目录属于 runner。后续 root 容器在其他子目录写入不改变这些现有目录的归属。没有 chmod 777、sudo 改整仓库、清数据或跳过步骤。

在禁网 Node 24.19.0 Linux 容器的独立 tmpfs 中，使用 root 与 UID/GID 1000 确定验证两种顺序：root 先建父目录时普通用户 mkdir 复现 EACCES；普通用户预建后再由 root 创建另一夹具子目录，普通用户同一路径 mkdir 仍成功。该测试验证 Linux 所有权，不冒充 App 组件或原生验收。actionlint 与 diff 检查通过。

修复提交 **099c36d** 的 [Mobile](https://github.com/Xstly1014/Tako/actions/runs/41447328547) 四作业全部 success，并已独立核对 `Draft editing and publication handoff routes (network disabled)` 这个新增 step 为 success，关闭新 C1 路由远程执行尾项；不是只重跑首轮配置。[Backend](https://github.com/Xstly1014/Tako/actions/runs/41447328549) success，[Frontend](https://github.com/Xstly1014/Tako/actions/runs/41447328596) 仍失败在 npm audit --audit-level=moderate。首轮失败和 Linux 所有权实验保留，后续只补证据的文档提交不改变被验 workflow/源码。

## 其他移交

独立 C1-B/C 审查见 cross-review-parallel-9653d74.md，P2 另存/输入竞争由主开发回应；本端没有修改其编辑器。原生设备 P0、frontend moderate audit P1 均保持原责任和退出条件；新增路由 CI 绿灯不会关闭这些事项。
