# Local cloud-instance container scaffold

> **仅用于本地 scaffold/PoC**：本目录不是正式云发布入口。Compose 直接复用父目录
> [`Dockerfile`](../Dockerfile) 的 `development` target；packaged `runtime` stage 只有这一份
> 真源。不得将本地构建或 CI build/test artifact 描述为 ACR/ACS 已发布制品。
> **权威范围（authoritative-for）**：本目录 Local Docker scaffold 的构建与运行行为。
> **非权威范围（not-authoritative-for）**：正式 runtime process ABI、server 编排和云部署；
> runtime ABI 以 [`../../../docs/cloud-instance-runtime.md`](../../../docs/cloud-instance-runtime.md)
> 为准。

这是本地 Docker 开发资产，不会把 token、`.env`、用户目录或 Docker secret 写入仓库。
镜像默认直接启动 Forge 在构建期产出的 Linux x64 packaged Electron，并复用当前已有的
`--headless` bootstrap 与 Pod provisioning secret-file 输入；容器以非 root 用户运行，
并将 `SIGTERM` 转发给 Electron 进程。

`compose.yaml` 显式构建父目录正式 Dockerfile 的 `development` target；该 target 自带
`pnpm dev:desktop:headless:local` 默认命令，保留源码 Forge/Vite 本地调试流。未显式选择
target 的本地 packaged 构建会落到最终 `runtime` stage，只含 `/opt/cindy` packaged 产物、
固定 agent/native 资产与运行库，不含仓库源码、Forge/Vite、root `node_modules` 或编译器；
这仍不是 registry 发布或云部署。
镜像缺省构建 Global 身份；需要中国大陆身份时传
`--build-arg CINDY_BUILD_REGION=cn`。区域在 Vite/Forge 构建期固化，运行期的
endpoint manifest 必须与它匹配。

最终 runtime 镜像预装 Git、Python 3、GitHub CLI（`gh`）、curl 与 jq，供云端 Cindy
在工作区中执行常见的源码、脚本、GitHub 和 HTTP/JSON 操作。Git 由 base stage 提供，
其余工具也在 base stage 通过 Debian/GitHub CLI 官方 APT 源安装，因此 runtime
会直接继承；不能只装在 source stage，因为 source 只服务构建，最终镜像不会继承其中
安装的构建期工具。完整 packaged runtime 构建（`source` / `packager` / `runtime`）只接受
`linux/amd64`：Apple Silicon 本地不得用 QEMU 构建正式制品，本地 compose 的现有 Rosetta
开发路径也不能当作发布验证，正式 artifact 由 CI 原生 x64 runner 产出。新增或调整
apt/工具层时，可在 arm64 宿主原生构建 `--target base` 验证，无需 QEMU。

客户端 strict Pod gate 只要求 `--headless`、`XDT_POD_DEVICE_ID` 和
`XDT_POD_ACCOUNT_REFRESH_TOKEN_FILE`。gate 成立后，packaged 形态才可能接受挂载的
`XDT_ENDPOINT_MANIFEST_FILE` 与 `XDT_USER_DATA_DIR` override，且两者只有在路径为绝对路径时
才会采用；缺失或相对路径分别回退 CDN 清单或 Electron 默认 userData。本地 compose 会显式
提供这两个绝对路径；正式 Provider 也必须提供，并由正式 Pod spec fail-fast/能力探针防止静默
回退。普通 packaged GUI 即使继承这些环境变量也继续使用 CDN 清单与 Electron 默认 userData。
Pod 工作区根由 `XDT_POD_WORKSPACES_DIR` 指定；entrypoint 未收到该变量时默认
`/var/lib/cindy/workspaces`。远程项目选择器在 Pod 模式下把这个目录作为 `~` 的浏览根，
普通 Desktop 仍按系统 HOME 解析。

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

Compose 用一个 `cindy-cloud-data` named volume 承载 `user-data`、`workspaces`、`home`
三个 subpath；一次性 `cindy-cloud-volume-init` 服务先创建目录并设为容器用户所有，随后
主服务分别挂到 `/var/lib/cindy/user-data`、`/var/lib/cindy/workspaces`、`/home/cindy`。
这需要支持 Compose volume `subpath` 的较新 Docker Engine / Compose。`status` 单独挂为
tmpfs，重建容器不会保留运行时快照。首次挂载空 home 时 entrypoint 从 `/etc/skel` 初始化
一次，已有任意内容则保持不动；旧的三个 named volume 不做自动迁移（本资产仍处本地开发
阶段）。healthcheck 只在
`status.json` 由 cloud-runtime controller 写成 `phase=ready`，且 `auth`、`database`、
`binaries`、`maker`、`deviceLink` 五个阻塞 readiness component 均为 `ready` 时通过；
`modelAccess` 只观测、不阻塞健康。controller 在 provisioning 前即开始心跳：认证失败期间持续
写 `phase=degraded`、`auth=not-ready`，并在进程内指数退避重试；auth / localDb /
agent binaries / Maker / device-link 全部成功后转为 ready。实际 relay 上线仍由
healthcheck 的 `deviceLink=ready` 持续门禁。

```bash
docker compose -f deploy/cloud-instance/local/compose.yaml ps
docker compose -f deploy/cloud-instance/local/compose.yaml logs --tail=100 cindy-cloud
```

本资产不伪造 auth、device-link、model-access 或 remote project/session 的服务端依赖；
端到端验证必须连接对应开发服务，且不能据此宣称 ACS 基础设施已部署。停止时使用
`docker compose ... down`，不会删除 named volumes，除非显式执行 `down -v`。
