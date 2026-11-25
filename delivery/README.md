# 云镜像交付流水线

本分支只放交付工具，不含客户端代码。[`cloud-image-delivery.yml`](../.github/workflows/cloud-image-delivery.yml)
按 [`version.json`](version.json) 取上游 `makecindy/cindy` 的正式版本，用上游自带的镜像配方
（`deploy/linux-desktop/`，见上游该目录的 README）构建，隔离验收后发布候选镜像，再准备 ACS 镜像缓存。
它不修改 CIS、实例或新领取默认；产品验收和实例准入在流水线之外完成。
首次配置见 [BOOTSTRAP.md](BOOTSTRAP.md)，runner 见 [runner/README.md](runner/README.md)。

每个版本只交付一份镜像。Runner、DinD 和 BuildKit 只是构建工具，不进入云实例。

## 交付一个版本

1. 等上游发布正式版本（tag `vX.Y.Z`，不用 `-beta`）。只能交付已合入云实例配方的版本，否则检查失败。
2. 改 `version.json`：`upstreamVersion`、该 tag 指向的完整 `upstreamCommit`，`cloudRevision`
   从 1 开始；同一上游版本再交付时只把 `cloudRevision` 加 1，提交不变。
3. 推送到 `cloud-image-delivery`。

镜像版本为 `X.Y.Z-cloud.N`，两个不可变标签：`X.Y.Z-cloud.N-cn-amd64` 与 `sha-<本分支提交>-cn-amd64`。

## 触发

| 推送内容 | 行为 |
| --- | --- |
| 只改说明文档（`delivery/**/*.md`），或 `delivery/` 与本 workflow 之外的文件 | 不触发 |
| 交付工具或构建设置变化，`version.json` 未变 | 只运行 `verify` |
| `version.json` 合法递增 | `verify → candidate → cache` |
| `workflow_dispatch` | 完整交付，仍受分支、Environment 和不可变标签约束 |

- 只接受本 fork 该分支的 push 和 dispatch，不运行 PR；`concurrency` 保证同时只有一个运行。
- 国内下载镜像写在 [`build-sources.json`](build-sources.json)，只能是上游配方允许替换的下载项
  （`build-image.py` 的 `--source-arg`），配方仍校验每个校验和与签名。上游升级 Plank 版本时这里的
  地址要随之更新，否则构建因校验和不符失败。

## Job

1. `verify`（`cindy-fork-cloud-check`，无发布凭据、无 Docker）：使用 runner 自带的 Node 24，
   只安装 `checks/package-lock.json` 锁定的检查依赖；`upstream.py --plan-only` 只取该 tag 和计划要读的
   两个文件，`plan.py` 核对 tag 与提交、检出位置、该版本含云实例配方、Electron 版本精确固定，以及
   `version.json` 相对上次合法递增；运行本目录的 Node 与 Python 测试。
2. `candidate`（`cindy-fork-cloud-build`，Environment `cloud-image-candidate-cn`）：
   - 先确认已声明不可变标签、构建缓存仓库不是运行时仓库、x86_64、Python >= 3.12、
     Docker 存储驱动为 `overlay2`；
   - 按固定 SHA-256 把 Git LFS 和（`acr-ak` 模式下的）阿里云 CLI 装到 job 临时目录，不用 sudo；
   - 登录构建缓存仓库；`upstream.py --history` 检出该版本（含提交历史，文件内容按需下载），
     `build.py` 用上游 `build-image.py --builder --cache-repository` 与 `build-sources.json` 构建；
     再执行 `smoke.py`；
   - 重新登录运行时仓库，执行 `publish.py`：只发布 smoke 过的那份，核对镜像标签、构建记录里的
     上游提交与版本、打包后原生模块加载的 Electron 版本；
   - 上传不含凭据的记录 artifact，保留 30 天：`candidate.json`、smoke 结果、构建日志与记录。
3. `cache`（`cindy-fork-cloud-cache`，Environment `cloud-image-cache-cn`）：按 artifact ID 取回
   `candidate.json`，运行 `cache.mjs`，上传 `cache-status.json`。

两个 Environment 都设 `deployment: false`：仍使用 Environment 的 secret 和分支规则，但不创建
GitHub 部署记录。若启用 GitHub App 自定义部署保护规则，必须改回创建 deployment。

## 隔离 smoke

`smoke.py` 要求原生 Linux x86_64 和 Docker daemon，运行一次性容器：无网络、只读根、tmpfs
数据和合成密钥，并模拟 root 属主的旧 HOME 目录。初始化只持有建测试目录所需的能力，然后以
UID 10001、清空能力和 `no_new_privs`，经镜像自带的 seccomp 入口启动桌面。检查项：

- Xfce/Plank 已就绪，Cindy 窗口可见；
- 每个 renderer 为 UID 10001、无能力、NoNewPrivs，并启用 seccomp filter；
- Dock 偏好设置无法打开，Chrome 是 Xfce 默认浏览器；
- ASAR 内的应用版本等于 OCI 版本；
- `docker stop` 后 60 秒内正常退出，退出码 0。

外层容器的 seccomp/AppArmor 设为 unconfined，由镜像自带过滤器负责，不使用 `--no-sandbox`。
smoke 不验证真实身份、OAuth 或 DeviceLink。

## 发布

`publish.py` 只发布 smoke 过的那份镜像，不重新构建：

- 发布前核对交付计划、image ID、标签、两层布局、smoke 的全部检查项和应用版本，以及五份构建
  记录（含打包后的 SQLite/sqlite-vec/PTY 结果）。
- 写入两个不可变标签：`<版本>-cn-amd64` 与 `sha-<本分支提交>-cn-amd64`，二者必须读回同一
  manifest digest。写入前并行检查两个标签在公开端点和 VPC 上传端点都没有冲突；冲突或读取失败
  时不写任何标签。
- CI 传 `--reuse-buildkit-export`：用已测的 BuildKit 结果按 digest 上传（不带标签），确认
  config digest 等于已测 image ID 后，用 `docker buildx imagetools create` 写两个标签。已有
  一个标签时按它的精确 manifest 补另一个。不传该参数时用 `docker tag` + `docker push`。
- 失败时保留 `publish-build.log` 和 `publish-metadata.json`。
- `candidate.json` 记录精确引用、digest、config ID、记录哈希和 smoke 结果；
  `productAcceptance`、`deviceLink`、`oauth` 与 ACS 状态为 `pending`，`releaseApproved: false`。

运行时仓库必须开启 tag 不可变策略，脚本的先查后写防不了并发写入。

## ACS 缓存

`cache.mjs` 从 Secret `CLOUD_IMAGE_CACHE_TARGETS` 读取目标网络及其 Pod 模板清单，格式见
[acs-targets.example.json](acs-targets.example.json)：

- 每个模板的主容器必须是 `$runtime`（本次发布的精确引用）；每个 initContainer 为 `$runtime`
  或允许仓库中带 digest 的精确引用。仍在用旧 init 镜像的实例按实际登记，不要把旧引用当长期默认。
- 每个目标内按精确引用去重，一个引用建一个缓存；最多并行两个，任一失败后不再开始新的。
- 缓存名和请求 token 由计划哈希决定，重跑会复用已有缓存，失败的缓存不会被自动删除重建。
  最多等待 Ready 15 分钟；超时后云端可能仍在创建。
- Ready 时再次核对镜像、Region、平台、网络和资源组。
- `cache-status.json` 只含摘要、不透明的缓存 ID 和状态，不含 VSwitch 或安全组；
  `podMatchVerified` 为 `false`，实际 Pod 命中需另行确认。
- 脚本只调用 `ListImageCaches`、`CreateImageCache`、`GetImageCache`，不删除缓存。

## 构建缓存

runner 一次性使用，跨运行的缓存放在独立的私有 Registry 仓库
（`CLOUD_IMAGE_BUILD_CACHE_REPOSITORY`，标签可更新，不得等于运行时仓库）。这些缓存不是实例
镜像，不进入 CIS 或 ACS 清单，可以随时清理，清理后按完整 Dockerfile 重建。

- 两个缓存标签：`fork-cloud-settings-cn-amd64-v2-base`（基座，`mode=max`）和
  `fork-cloud-settings-cn-amd64-v4-prepared`（应用准备层，`mode=min`）。
- 基座按 `baseRecipeCommit` 标识，只随 `runtime-base` 输入变化。准备层含安装好的 pnpm 依赖、
  Electron、Agent 资源、构建头文件和预编译的 native 模块，随上游源码、版本和准备脚本变化；
  云修订号和说明文档不影响它。
- 执行顺序：`prepare-build`（解析准备层缓存）→ `materialize-build`（断网的
  `prepared-materialized` 目标，实际读取恢复的文件）→ `full-build`（基座、运行时、记录）。
  元数据显示 `CACHED` 不代表文件已恢复；判断缓存是否生效，要看三份日志里安装步骤都没有重新执行。
- BuildKit 拉取源元数据时遇到连接重置、TLS 握手超时、I/O 超时或 unexpected EOF，会在同一
  runner 上自动重试一次，保留 `*-attempt-1.log` 和 `*-attempts.json`。其他错误直接失败。
- 构建池在 VPC 内时，该变量可填同一缓存仓库的 VPC 地址，见 [BOOTSTRAP.md](BOOTSTRAP.md#acr-镜像仓库)。

## 凭据边界

- 发布 AK 只注入两个登录步骤，不进入 Dockerfile、build arg 或构建环境；Docker 登录写入 job
  私有的 `DOCKER_CONFIG`，job 结束时删除。
- 缓存 AK 只在 cache 步骤注入，与 ACR 身份分开。
- artifact 和日志不含 HOME、密钥、构建上下文或私有网络配置。

## 流水线不做的事

完整 OAuth 与 DeviceLink 验收、Pod 实际缓存命中、签名、稳定通道和晋级都不在流水线内；
交付计划的通道字段目前只有 `candidate`。GitHub artifact 只保留 30 天，不是长期发行目录。
