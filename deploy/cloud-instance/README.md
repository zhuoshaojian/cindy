# Cloud instance headless runtime image

本目录是 **Cindy headless runtime 镜像的客户端侧权威入口**。它说明镜像需要打包什么、
接受哪些启动输入、持久化哪些目录，以及向控制面暴露什么 status/readiness 契约。完整运行期
契约见 [`../../docs/cloud-instance-runtime.md`](../../docs/cloud-instance-runtime.md)。

> **权威范围（authoritative-for）**：runtime process ABI，包括启动环境变量、固定路径、
> status writer/schema、delete-control socket 与清凭据后的 acknowledgement。
> **非权威范围（not-authoritative-for）**：server desired-state、Provider/Kubernetes 生命周期、
> H7 编排、ACS/ACR/RBAC/Postgres/IaC 和部署 BOM；这些以 server 文档为准。

## 当前状态

- 正式构建入口已建立：[`Dockerfile`](./Dockerfile) 是 packaged headless runtime 的唯一镜像
  真源；[Build-1 workflow](../../.github/workflows/build-cloud-runtime-image.yml) 在原生 Linux x64
  runner 上生成并测试短期 artifact、metadata、SBOM 与 Trivy 报告。
- Local Docker PoC 继续保留：Local Compose 直接选择正式 Dockerfile 的 `development` target，
  可验证 headless 启动、Linux x64 capability gate、持久目录、状态心跳和健康检查，不再维护
  第二份 runtime stage。
- ACS Dev v1 的架构设计已经冻结，目标运行面为 **ACS Serverless + `linux/amd64`**；集群、
  Registry、权限、数据库和部署 Pipeline 尚未建设，当前不能表述为已部署。
- 当前 workflow **不登录或推送 ACR、不签名、不 promote、不部署**；其产物只是 build/test
  artifact。发布与 cosign 的封闭门禁和外部前置见
  [`image-supply-chain.md`](./image-supply-chain.md)。
- ARM64 不在 Dev v1 范围。未来若支持，必须提供原生 agent/native 资产与原生构建链；禁止用
  本地 QEMU 构建正式制品。

## 本仓 owner 边界

`cindy-moved` 只负责 runtime data plane：

- headless runtime 镜像及其 `linux/amd64` capability gate；
- 不可变 endpoint manifest、只读 secret、稳定 `deviceId` 等启动输入；
- `user-data`、`workspaces`、`home` 三类持久目录及临时目录约定；
- status/readiness/idle observation 和 model-access observation；
- delete-control Unix socket，以及 runtime 内凭据清理的 acknowledgement；
- 环境变量、固定路径和跨仓字面量的 runtime 侧定义与契约测试入口。

以下内容不属于本仓 owner：面向客户端的 API、内网 orchestrator、ACS/ACR、Kubernetes
RBAC、Postgres、IaC、Registry 发布和控制面部署。runtime 镜像不持有 kubeconfig、云账号凭证
或 cloud-instance-server token，只消费控制面注入的不可变 endpoint/config、secret 和稳定
设备身份。

ACS Dev v1 的资源参数、namespace/StorageClass/RBAC、API/orchestrator 分层和完整部署 BOM，
以服务端仓库 `cindy-server/docs/cloud-instance/` 索引为权威（待同批落地）。本仓不复制整份
BOM，避免双源漂移；这里只维护 runtime 必须遵守的消费侧契约。

## 目录

- [`Dockerfile`](./Dockerfile)：正式 packaged runtime 构建入口，同时提供 local scaffold 使用的
  `development` target。
- [`image-supply-chain.md`](./image-supply-chain.md)：Build-1 artifact、SBOM、扫描、secret 边界与
  未来 ACR/cosign promotion 前置。
- [`local/`](./local/)：Local Docker PoC/Compose scaffold；不是发布或部署入口。
- [`../../docs/cloud-instance-runtime.md`](../../docs/cloud-instance-runtime.md)：Pod 启动、
  存储、状态、删除和跨仓 wire twin 的完整技术契约。
