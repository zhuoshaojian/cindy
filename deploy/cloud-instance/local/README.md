# Local cloud-instance container scaffold

这是本地 Docker 开发资产，不是生产镜像，也不会把 token、`.env`、用户目录或 Docker
secret 写入仓库。它使用当前已有的 `--headless` 命令和 Pod provisioning secret-file
输入，容器以非 root 用户运行，并将 `SIGTERM` 转发给 Electron 进程。

## 前置条件

1. 在宿主机准备一个 gitignored 的纯文本账号 refresh token 文件（只读权限）。
2. 生成一个**容器可访问**的 endpoint manifest。若 auth/device-link 在宿主机运行，
   将其中的 `localhost` 改为 `host.docker.internal`；不要把 token 写入 manifest。
3. 仅支持当前 pin 已验证的 Linux x64。ARM64 会在 entrypoint capability gate 阶段明确
   失败，不使用 QEMU；Linux ARM64 的 agent pins 与 sqlite-vec 原生资产待后续补齐。

示例（命令只引用路径，不展开 secret）：

```bash
cd /Users/sirius/Public/cindy-moved
export CINDY_POD_REFRESH_TOKEN_FILE=/path/to/gitignored/pod-refresh-token
export XDT_POD_DEVICE_ID=pod-local-docker-1
export CINDY_ENDPOINT_MANIFEST_FILE=/path/to/endpoint.local.docker.json
docker compose -f deploy/cloud-instance/local/compose.yaml up --build
```

状态目录为 Docker volume `cindy-cloud-status`，用户数据为
`cindy-cloud-user-data`，工作区为 `cindy-cloud-workspaces`。healthcheck 只在
`status.json` 由 cloud-runtime controller 写成 `phase=ready` 且所有 readiness
component 为 `ready` 时通过。当前 controller 已接入 Pod headless bootstrap，并在
auth / localDb / agent binaries / Maker / device-link 成功后开始心跳；实际 relay
上线仍由 healthcheck 的 `deviceLink=ready` 持续门禁。

```bash
docker compose -f deploy/cloud-instance/local/compose.yaml ps
docker compose -f deploy/cloud-instance/local/compose.yaml logs --tail=100 cindy-cloud
```

`device-link`、model-access、remote project/session 等能力不在本资产中伪造；它们仍需
各自的服务端与 Pod onReady 基建阶段接入。停止时使用 `docker compose ... down`，不会
删除 named volumes，除非显式执行 `down -v`。
