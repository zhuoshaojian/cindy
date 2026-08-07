# 云端 Cindy headless runtime 技术契约

> **状态**：技术契约（参考）
> **权威范围（authoritative-for）**：`cindy-moved` 的 runtime process ABI——启动环境变量、
> 固定路径、status writer/schema、delete-control socket，以及清除凭据后如何 acknowledgement。
> **非权威范围（not-authoritative-for）**：server desired-state、Provider/Kubernetes 生命周期、
> H7 编排、ACS/ACR/RBAC/Postgres/IaC 与部署 BOM；这些以服务端仓库文档为权威。

本文描述云端 Cindy 数据面的启动输入、持久目录、状态观测和删除前凭据清理契约。镜像入口
见 [`../deploy/cloud-instance/README.md`](../deploy/cloud-instance/README.md)。Local Docker
PoC 已完成；Build-1 已建立正式 Dockerfile 与原生 Linux x64 build/test artifact workflow，
但 ACS/ACR/RBAC/Postgres/IaC、registry promotion、签名和部署 Pipeline 尚未建设，不能将本文
理解为生产环境已经部署。

## 1. Owner 与部署边界

`cindy-moved` 负责 headless runtime image、启动输入校验、进程可见的持久目录、
status/readiness writer、capability gate 和 Pod 内 delete acknowledgement。API、orchestrator、
ACS/ACR、Kubernetes 对象、RBAC、Postgres、IaC、Registry 与控制面部署由服务端/基础设施侧负责。

Pod 是纯数据面：

- 不持有 kubeconfig、ServiceAccount token、云账号密钥或 cloud-instance-server token；
- 不调用 cloud-instance-server；生命周期由控制面经 Provider/Kubernetes API 管理；
- 只访问 endpoint manifest 声明的 auth、device-link、model-access 等数据面服务；
- 只消费控制面注入的不可变 endpoint manifest、只读 bootstrap secret 和稳定 `deviceId`。

ACS Dev v1 固定使用 ACS Serverless 与 `linux/amd64`。资源规格、namespace、StorageClass、
NetworkPolicy、RBAC、API/orchestrator 分层和部署 BOM 只在服务端仓库的
`cindy-server/docs/cloud-instance/` 索引维护（待同批落地）；本仓不得复制第二份参数表。

## 2. Pod 启动输入

客户端的 strict Pod trust gate 只由 `--headless`、非空
`XDT_POD_DEVICE_ID` 和非空 `XDT_POD_ACCOUNT_REFRESH_TOKEN_FILE` 共同成立。缺少任一条件时，
普通 Desktop 不得接受 Pod 专用的 endpoint 或存储覆盖。正式云 Provider 还必须显式提供下表
标出的路径输入；它们是部署契约，但不额外参与客户端 strict gate 判定。

| 输入 | 云端约定 | 语义 |
| --- | --- | --- |
| `--headless` | 必需 | 不创建 BrowserWindow，进入 headless bootstrap |
| `XDT_POD_DEVICE_ID` | 必需、稳定、最长 128 字符 | relay、auth 和控制面共同识别的设备身份；重启/唤醒不得变化 |
| `XDT_POD_ACCOUNT_REFRESH_TOKEN_FILE` | 必需；默认挂载 `/run/secrets/account-refresh-token` | 只读 bootstrap account refresh token 文件；内容不得进入 image、env、日志或 status |
| `XDT_ENDPOINT_MANIFEST_FILE` | 正式 Provider 必配绝对路径；约定 `/run/config/endpoint.json` | 不参与 strict gate；packaged Pod 仅在 gate 已成立且路径绝对时采用 override，缺失或相对路径会回退 CDN，正式 Pod spec 应 fail-fast/能力探针阻断 |
| `XDT_USER_DATA_DIR` | 正式 Provider 必配绝对路径；约定 `/var/lib/cindy/user-data` | 不参与 strict gate；客户端仅在 gate 已成立且路径绝对时采用 override，缺失或相对路径不会采用 override，正式 Pod spec 应 fail-fast/能力探针阻断 |
| `XDT_POD_WORKSPACES_DIR` | 可省略；默认 `/var/lib/cindy/workspaces` | 远程项目与任务工作区根；启动前创建并规范化 |
| `CINDY_CLOUD_STATUS_FILE` | 可省略；云镜像固定 `/var/lib/cindy/status/status.json` | 控制面/探针读取的原子状态快照 |
| `XDT_POD_MEMBERSHIP_ID` | 控制面注入 | runtime status 的账号隔离标识，不替代 token 验证 |
| `XDT_POD_DEVICE_NAME` | 控制面注入 | relay 使用的稳定云端设备名标记 |

因此 `XDT_ENDPOINT_MANIFEST_FILE` 与 `XDT_USER_DATA_DIR` 的“必配”是 Provider/正式 runtime
contract，不代表 `hasHeadlessPodRuntimeInput` 会校验它们。Secret 与 ConfigMap/配置文件必须以
只读输入提供。挂载的 account refresh token 是首次
bootstrap 材料；runtime 轮换后的账号凭据写入持久 `user-data`。冷启动优先验证持久凭据，再
考虑挂载的 bootstrap 材料，避免重复消费已经轮换的前任 token。runtime 将 endpoint manifest
视为本次进程启动的不可变输入；服务端如何更新材料或收敛 Pod 不由本文规定。

持久凭据的读取结果分三态：存在、确定缺席、暂时不可读。只有确定缺席（底层 `ENOENT`）才允许
回落到挂载的 bootstrap 材料或执行清除持久状态这类破坏性动作。暂时不可读（safeStorage 不可用、
`EPERM`、`EIO` 等）一律按可恢复故障处理：不消费挂载材料、不清除任何持久状态，写
`phase=degraded` 与 `auth=not-ready`，并按 5 秒起、上限 5 分钟的进程内指数退避重试。这条不变量
使 PVC 权限或 IO 抖动不会把一个有效持久会话降级成对已被 `consumeOnce` 的 one-shot bootstrap
token 的重复置备——那会让实例永久无法恢复。退避期间只记录凭据状态、尝试次数、下次重试间隔和
错误类别等 metadata，不记录凭据内容。

## 3. 持久目录与临时目录

runtime 只把需要跨进程保留的状态写入以下三个持久挂载点：

| 目录 | 默认挂载点 | 内容与生命周期 |
| --- | --- | --- |
| `user-data` | `/var/lib/cindy/user-data` | 登录轮换状态、safeStorage、local DB、runtime 配置和用户数据 |
| `workspaces` | `/var/lib/cindy/workspaces` | 云端 Cindy 创建和访问的项目工作区 |
| `home` | `/home/cindy` | `HOME`、agent/CLI 配置和用户级工具状态；当前只要求可写并持久，初始化策略由未来正式 Pod spec 明确 |

Pod runtime 在 Linux headless 模式使用 Electron basic safeStorage；`safe-storage/*.enc` 只是该
backend 的存储格式，等同明文保护强度，不是 Secret Service、OS keyring 或强静态加密边界。
运维仍须按敏感凭据对待 `user-data`、PVC/runtimeRoot、备份和快照，并依赖服务端精确 revoke
与 Provider 物理删除完成生命周期清理。

这些挂载点在 stop/restart/delete 等生命周期中的保留或删除策略由服务端文档规定；本文只
规定 runtime 进程读写的路径 ABI。`/var/lib/cindy/status` 不属于持久状态，避免新进程把旧
heartbeat 当成当前健康证据。

`/tmp` 及其它临时目录是可抛弃空间。当前 delete-control socket 位于
`/tmp/cindy-cloud-delete-control.sock`，Xvfb 等辅助进程也只能把临时文件写到临时目录；任何
需要跨 stop/restart 保留的状态不得依赖 `/tmp`。正式 Pod 应给临时目录提供可写的有界
ephemeral 存储，并保持 secret/config mount 只读。

镜像以非 root 用户 `cindy`（当前 UID `10001`）运行。持久目录必须在启动前归属该用户或通过
等价的 Pod security context 提供写权限；runtime 不需要 Docker socket、Kubernetes API token
或特权容器权限。

## 4. Capability gate 与制品架构

Dev v1 的唯一正式目标是 `linux/amd64`。entrypoint 在启动 Electron 前验证 Claude、Codex、
ripgrep 和 `sqlite-vec/linux-x64` 等受管资产；缺失或架构不匹配时 fail closed。

[`../deploy/cloud-instance/Dockerfile`](../deploy/cloud-instance/Dockerfile) 是 packaged runtime
和 local development target 的唯一镜像真源；Build-1 workflow 只生成、扫描并上传短期测试
artifact，不访问 registry。正式制品必须由原生/托管 `linux/amd64` builder 产出；禁止在本地
用 QEMU 构建正式镜像。未来 ARM64 支持必须作为独立原生资产与构建链交付，不能以仿真绕过
capability gate。

镜像构建、内容禁入、SBOM/Trivy 与未来 ACR/cosign 前置见
[`../deploy/cloud-instance/image-supply-chain.md`](../deploy/cloud-instance/image-supply-chain.md)。

## 5. Status、readiness 与 probe

runtime controller 周期性原子写入 version 1 的 `status.json`，文件权限为 `0600`。关键字段
包括实例/账号身份、`phase`、启动与 heartbeat 时间、`draining`、组件 readiness，以及 idle
观测。控制面只读取该快照，Pod 不向控制面回调或推送状态。

阻塞 runtime readiness 的组件固定为：

- `auth`
- `database`
- `binaries`
- `maker`
- `deviceLink`

只有上述组件全部为 `ready` 且活动采集没有失败时，runtime 才写入 `phase=ready`。控制面或
探针还必须验证 heartbeat 新鲜；missing、损坏、未来时间或过期的 status 一律 fail closed，
默认 stale 窗口为 30 秒。优雅终止时 runtime 写入 `phase=stopping`、`draining=true`。

`modelAccess` 是 **observation-only**：它反映服务端托管模型凭据是否就绪，但不参与 Pod
phase、健康探针或 idle suspend gate。未订阅、服务端禁用、手动 key fallback 或短暂
model-access 故障都不能导致一个其它组件健康的 Pod 被反复重启。该状态只用于观察，不构成
模型目录持续同步 SLA；具体刷新与重试行为以当前实现为准。

本地 PoC 的 healthcheck 是该 status ABI 的客户端侧验证入口。ACS Provider 如何读取状态、
评估 readiness 或接入 Pod probe 属于服务端权威范围；对侧应消费这里定义的 schema，而不是
由本文复制其编排语义。

## 6. Stop 与 delete-control runtime ABI

runtime 的 stop/sleep 路径不调用 delete-control endpoint，也不触发账号凭据清理。socket 在
进程存活期间可供受控的容器内调用方访问，但它的存在不改变 stop 语义。

delete-control 只定义以下 Pod 内行为：

1. 仅接受 Unix socket 上的 `POST /v1/delete-credentials`；其它方法或路径返回 404。
2. 收到请求后，runtime 清除 `user-data` 内可写的持久 Account 凭据。
3. runtime 复核凭据文件已物理不存在；只有复核成功才返回 HTTP 200 与
   `{"cleared":true}`。
4. 清理或复核失败时返回 HTTP 500 与 `{"cleared":false}`，不得伪造成功 ack。

socket 固定为 `/tmp/cindy-cloud-delete-control.sock`、权限为 `0600`，不发布为网络端口。它按
Pod 内用户权限边界设计：Agent 子进程与 control 进程同为 `cindy` UID、属于同一信任域，因此
该 Unix socket 不是独立认证边界；method/path 校验与文件权限不能用来声称调用方已鉴权。
server 的 revoke、desired-state、Provider 物理删除、H7 兜底和记录删除顺序只在
`cindy-server/docs/cloud-instance/` 索引下维护（待同批落地），本文不复制。

## 7. 跨仓 wire twin

下表是 **非规范导航与契约测试入口**，用于定位两仓必须保持相同的字面量；它不复制、解释或
替代 server 侧语义。修改固定路径、环境变量、status schema 或 delete-control 字面量时，必须
同步修改两仓契约测试。

| 契约 | `cindy-moved` | `cindy-server` 对应路径 |
| --- | --- | --- |
| Pod 启动环境与默认目录 | `apps/desktop/src/main/headless-startup.ts` | `cloud-instance-server/src/provider-shared.ts` 的 `buildRuntimeEnvironment` 与 `CLOUD_RUNTIME_*_TARGET` |
| status schema/阻塞 readiness | `apps/desktop/src/main/cloud-runtime/status.ts`、`readiness.ts` | `cloud-instance-server/src/runtime-status.ts` |
| delete-control socket/path | `apps/desktop/src/main/cloud-runtime/pod-delete-control.ts` | `cloud-instance-server/src/provider-shared.ts` 的 `POD_DELETE_*` |
| 云端设备名 sentinel | `packages/maker-shared/src/deviceList.ts` | `cloud-instance-server/src/provider-shared.ts` 的 `CLOUD_DEVICE_NAME_SENTINEL` |

表中 server 路径只用于导航；对侧行为与编排语义以 server 文档和代码为准。服务端仓库路径以
checkout 中的实际仓名为准；本仓不创建跨仓相对链接，避免在单仓浏览时产生坏链接。
