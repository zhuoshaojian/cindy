# Cloud instance runtime boundary

这是云端实例容器化的客户端侧边界说明。当前代码提供本地 Docker 编排、Pod
headless bootstrap 中的 runtime status/readiness 心跳，以及 fail-closed idle activity
采集；自动 stop/wake 仍由后续 control plane / provider 消费这些状态执行。

## Capability matrix

| 目标 | 架构 | 调试方式 | agent/native 资产 | 状态 |
| --- | --- | --- | --- | --- |
| Local Docker | AMD64 (`linux-x64`) | `docker compose` + headless logs | Claude/Codex/rg pins + `sqlite-vec/linux-x64` | capability gate 可验证；Electron readiness 待 controller 接线 |
| Local Docker | ARM64 (`linux-arm64`) | 原生容器调试 | 当前 pins / sqlite-vec 缺失 | 明确 fail-closed；不使用 QEMU |
| Alibaba Cloud | AMD64 | ACK/ECS Pod + status/health probes | 需 ACR 多架构镜像与同一 x64 资产校验 | 规划中，未部署 |
| Alibaba Cloud | ARM64 | ACK/ECS 原生 ARM 节点 | 需上游原生 pins、native modules、sqlite-vec 资产 | 规划中，未部署；不得以仿真替代 |

两种调试模式都必须把 provisioning refresh token 作为 secret file 挂载，把
`XDT_POD_DEVICE_ID` 作为稳定设备身份注入；token 不进入 image layer、环境日志或
status JSON。容器使用非 root 用户；数据与状态分别落在可替换的持久化卷（本地
Docker named volume，阿里云后续对应 PVC/NAS），容器被删除不应丢失 refresh
rotation 或本地数据库。

## Planned cloud interfaces

阿里云部署只需要替换编排层，不改变 headless 客户端 seam：

- ACR：按 `linux/amd64`、未来 `linux/arm64` 分别做原生镜像并在发布前运行
  `check-capabilities.mjs`；
- ACK/ECS：Pod 生命周期、优雅 SIGTERM、liveness/readiness 探针、节点架构约束；
- KMS/Secrets Manager：向 `/run/secrets` 注入 account refresh token，轮换后的 token
  仍由应用 safeStorage/持久化卷管理；
- PVC/NAS：`XDT_USER_DATA_DIR`、local DB、状态 JSON 和工作区数据的持久化；
- control plane：调用 server `provision-device`，下发稳定 deviceId，读取 status，
  负责 wake/stop/restart/fencing；data plane 保持 relay、Maker、workspace 和模型
 访问在 Pod 内。

`remote project` / 新建会话 UI、Pod onReady 下游 hooks、remote-file-service 和
model-access 的服务化不在本阶段客户端改动范围。
