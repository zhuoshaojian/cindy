# 云实例实时任务活动

云镜像打包覆盖层。把 `instance-runtime/status.ts` 中未接线的 `activity-unknown` 占位值
替换为实时任务活动读数。普通客户端构建不引用此目录。

## 读数来源

复用原有重启阻断探针，并补充输入队列和调度器：

- 逻辑 turn、Claude 后台活动、插件后台活动、后台 Bash、Cindy slot 在途工作、Pi 子任务；
- 排队输入、压缩、等待交互、派发/终态收口和调度自动续跑；
- scheduler 内存中的执行/排队、持久化 running 记录、未来两分钟内到期的任务；
- 正在执行的远程调用和远程桌面输入，以及账号/数据库 owner 切换。

这是已接入的来源清单，不是进程内全部异步工作。新增任务执行器时须补来源及对应
busy/unknown 测试。

## 判定规则

- 来源缺失、异常、类型错误、超时或 owner 变化都报告 `activity-unknown`，并给出具体 blocker。
- 异步读取前后各采一次内存来源；同一时间最多一个在途扫描，超时（1 秒）不会堆积查询。
- 至少两次采样且安静满 10 秒才报告 idle。
- 状态每 5 秒原子发布；停止后迟到的扫描不能把 stopping 覆盖为 ready。
- 不记录会话 ID、正文或凭证。

自动任务被认领后，执行期间 `nextFireAt` 为空。只有与调度器真实在途自动执行匹配的同一任务
可接受空值，且仍报告 busy；读取排期前后都保留在途快照，覆盖执行结束与重排的竞态。其它任务
缺少排期、值损坏或来源异常仍是 unknown。任务 ID 只在进程内匹配，不写入状态或维护回执。

## 状态字段

保留 v1 状态字段及就绪、身份、OAuth、`authRecovery` 语义。新增观察字段 `cloudActivity`；
`idle.blockers` 沿用现有开放字符串数组，不改变协议。`maySuspend` 恒为 false，不启用自动停机。

该读数不是 drain 锁，不能据旧快照直接重启实例；执行前仍须检查实时状态和生命周期栅栏。
此目录不负责重启、切换实例镜像或发布默认镜像。持久化 running 记录为 0 不是实时空闲证明。
探针只随包含此覆盖层的镜像生效，不得用热改运行中的 asar 或注入调试器代替。

## 构建接线

`overlay.mjs` 改写 main 进程的 4 个源文件：`bootstrap-electron.ts`、`instance-runtime/status.ts`、
`maker-ipc/register.ts`、`maker-ipc/agent-input-coordinator.ts`。虚拟模块
`virtual:cindy-cloud-task-activity` 解析为 `publisher.mjs`；`runtime-maintenance` 也从这里读取
`readMaintenanceActivity`。`stage-cloud-overlays.mjs` 在打包前对构建用的源码导出应用转换；
`cloudTaskActivityPlugin({ sourceRoot })` 是同一转换的 Vite 插件形式，供测试使用。锚点缺失、
重复或漂移都会使构建失败。不改变 IPC 权限、远程 allowlist、Platform 或部署策略。

## 测试

```sh
CINDY_ACTIVITY_TEST_SOURCE=/absolute/path/to/client node --test deploy/linux-desktop/runtime-activity/*.test.mjs
```

未设置 `CINDY_ACTIVITY_TEST_SOURCE` 时跳过真实源码转换测试。
