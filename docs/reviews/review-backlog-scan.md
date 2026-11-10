# 中篇审核逾期巡检

基线 `7f152ea`。一次巡检通过本地测试运营会话读取中篇先审、后审和复核三个队列，复用服务现有授权和分页。先审与后审从首次等待计时，复核从申请创建计时。超过 48 小时的项目按等待时间排序，输出队列、任务标识和起点。逾期是运营提示，处理决定仍走原有审核流程。

```powershell
node --no-warnings --env-file=.runtime/local-test/.env agents/author-support/scripts/review-backlog.ts
```

退出码 0 对应完成遍历。请求失败、分页游标回环、响应异常或超过每队列 200 页时，状态为 `incomplete`，全局逾期数为 `null`，报告注明失败队列及 HTTP 状态。巡检使用同一个计时基准，页间仍可能有人工处理或新增任务。报告描述当次观测，后续处理前须刷新相应队列。

本机 test HTTP/MySQL 实测三个队列均完成读取。先审 0 项、复核 0 项、后审 226 项，其中 211 项超过 48 小时。该数据来自本机测试库。类型检查及两项定向验证通过，覆盖两种游标、重复任务、替换后首次等待、48 小时边界和扫描中断。会话扫描完成后退出。

## 持久化跟踪

```powershell
node --no-warnings --env-file=.runtime/local-test/.env agents/author-support/scripts/review-backlog.ts --track
node --no-warnings agents/author-support/scripts/review-backlog.ts --events
```

`--track` 将事件和最近一次完整积压快照写入本地 `.runtime/author-agent/review-backlog.sqlite`。每类队列只记录新增逾期或不再观测到的任务，积压总量相同也能发现任务更替。任务消失后，负责人仍须从原运营队列核对实际处理结果。扫描失败时保留最后一次完整积压，连续失败只记录一个事件，下一次成功记录扫描恢复。按扫描开始时间拒绝晚到的旧结果。事件和状态在同一事务提交，可通过 `--events` 查询最近 20 条事件。

真实本地服务连续执行两次，均读到 211 项后审逾期。首次产生一个积压事件，第二次零新增事件，重新启动命令后可读到已持久化事件。两次运营会话均正常退出。三项定向测试与类型通过，受控演练覆盖扫描故障、恢复、旧扫描晚到、同量换项和积压清零。

定时运行、通知投递和负责人实际处置仍是开放前的 P1。退出条件是对齐通知渠道和负责人，在目标环境对已超时、扫描失败和恢复完成投递和处置演练。 [审核时效规则](../increment-b-review.md) · [开放门槛](../handoff/07-primary-takeover.md)
