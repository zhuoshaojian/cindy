# 交付环境首次配置

[交付流水线](README.md) 运行前需要在 fork 上完成以下配置。真实值只放在 GitHub 的
Repository/Environment 设置或仓库外的私有配置里，不写进源码、命令参数、日志或 artifact。

## GitHub

1. 在 fork 启用 Actions。不需要修改主仓、默认分支或组织/企业 runner。
2. 创建两个 Environment，部署分支规则选 **Selected branches and tags**，只允许分支
   `feat/cloud-settings-native-client`，不加 tag 规则；reviewer 按团队政策设置。
3. 填写下表。两个开关等其余配置和下文的权限验证完成后再设为 `true`。

| 位置 | 名称 | 用途 |
| --- | --- | --- |
| Repository variable | `CLOUD_IMAGE_DELIVERY_ENABLED` | `true` 时开启候选交付 |
| Repository variable | `CLOUD_IMAGE_CACHE_ENABLED` | `true` 时开启发布后的缓存步骤 |
| `cloud-image-candidate-cn` variable | `CLOUD_IMAGE_REPOSITORY` | 运行时仓库：Registry 主机和路径，不含 tag 或 digest |
| 同上 variable | `CLOUD_IMAGE_PUSH_REPOSITORY` | 可选：同一仓库的 ACR VPC 地址，只改变上传路径 |
| 同上 variable | `CLOUD_IMAGE_BUILD_CACHE_REPOSITORY` | 私有构建缓存仓库，标签可更新，不得等于运行时仓库 |
| 同上 variable | `CLOUD_IMAGE_IMMUTABLE_TAGS` | `true`，表示运行时仓库已启用 tag 不可变 |
| 同上 variable | `CLOUD_IMAGE_BUILDX_DRIVER_OPTS` | 可选：BuildKit driver 选项，每行一个，见 [Runner](#runner) |
| 同上 variable | `CLOUD_IMAGE_REGISTRY_AUTH` | `password`（默认）或 `acr-ak`；失败不会切换到另一种 |
| 同上 secrets | `CLOUD_IMAGE_REGISTRY_USER`、`CLOUD_IMAGE_REGISTRY_PASSWORD` | `password` 模式的 Registry 登录凭据（不是 RAM AK） |
| 同上 variable | `CLOUD_IMAGE_ACR_INSTANCE_ID` | `acr-ak` 模式的 ACR 企业版实例 ID（`cri-…`） |
| 同上 secrets | `CLOUD_IMAGE_ACR_ACCESS_KEY_ID`、`CLOUD_IMAGE_ACR_ACCESS_KEY_SECRET` | `acr-ak` 模式的 ACR AK，只注入两个登录步骤 |
| `cloud-image-cache-cn` secrets | `CLOUD_IMAGE_CACHE_ACCESS_KEY_ID`、`CLOUD_IMAGE_CACHE_ACCESS_KEY_SECRET` | ACS 缓存 AK，只注入缓存步骤 |
| 同上 secret | `CLOUD_IMAGE_CACHE_TARGETS` | 目标网络、允许的仓库和主/init 模板清单，格式见[示例](acs-targets.example.json) |

workflow 文件不在默认分支上，网页可能不显示 Run workflow；可用 REST API 对
`cloud-image-delivery.yml` 发起 `workflow_dispatch`，`ref` 设为交付分支。不要为了试跑而递增
版本号或发布占位镜像。

开关打开后，用一次真实交付确认构建、原生 smoke、发布和全部缓存 Ready 都能完成；配置完成
不等于交付可用，缓存 Ready 也不等于 Pod 实际命中。

## ACS 缓存账号

缓存用 AK 直接调用 OpenAPI，不用 OIDC、角色信任或 STS。ACS 与 ACR 可以在不同账号，凭据分开配置。

1. 给缓存账号中的 RAM 用户授权（替换 Region 和 `ACCOUNT_ID`）：

   ```json
   {
     "Version": "1",
     "Statement": [{
       "Effect": "Allow",
       "Action": ["acc:ListImageCaches", "acc:CreateImageCache", "acc:GetImageCache", "acc:DeleteImageCache"],
       "Resource": "acs:acc:cn-shanghai:ACCOUNT_ID:imagecache/*"
     }]
   }
   ```

   流水线只调用 List、Create、Get。`DeleteImageCache` 只供人工清理：使用 `Force=false`，先核对
   缓存所属的交付，不删除仍在使用或需要保留的回退镜像缓存。
2. 账号首次使用镜像缓存时，由管理员创建服务关联角色；日常缓存 AK 不需要这项权限：

   ```json
   {
     "Effect": "Allow",
     "Action": "ram:CreateServiceLinkedRole",
     "Resource": "*",
     "Condition": {"StringEquals": {"ram:ServiceName": "imc.acc.aliyuncs.com"}}
   }
   ```

3. 私有运行时仓库要先给 ACS 配好 ACR 拉取授权。缓存配置没有 Registry 密码字段，不要把凭据
   写进去，也不要为此把仓库改成公开。
4. 用同一个 AK 验证查询、创建和 Ready 后，再打开 `CLOUD_IMAGE_CACHE_ENABLED`。

ACS 调用（[acs-api.mjs](acs-api.mjs)）使用临时 CLI profile，并剥离子进程环境里其他阿里云
凭据，调用结束即删除。

## ACR 镜像仓库

- 运行时仓库 `cloud-runtime-cn`：在 ACR 确认已开启 **Tag 不可变** 后，才设
  `CLOUD_IMAGE_IMMUTABLE_TAGS=true`。该策略对 `latest` 例外，流水线不写 `latest`。
- 构建缓存仓库：另建一个私有仓库，允许覆盖标签，配到 `CLOUD_IMAGE_BUILD_CACHE_REPOSITORY`。
  它可能包含构建中间源码，不开放匿名读取；不要为它关闭运行时仓库的不可变策略。
- VPC 端点（可选，构建池在 ACR 所在 VPC 内时）：
  - `CLOUD_IMAGE_PUSH_REPOSITORY` 设为运行时仓库的 VPC 别名，例如
    `example.cn-shanghai.cr.aliyuncs.com/ns/cloud-runtime-cn` 对应
    `example-vpc.cn-shanghai.cr.aliyuncs.com/ns/cloud-runtime-cn`。脚本拒绝其他实例、地域或路径；
    读回校验、发布记录和 ACS 引用始终使用 `CLOUD_IMAGE_REPOSITORY`。
  - `CLOUD_IMAGE_BUILD_CACHE_REPOSITORY` 可直接填缓存仓库的 VPC 地址。
  - 切换前核对两端 manifest 和 layer digest 一致、层下载确实走内网；`/v2/` 返回 401 不能证明链路可用。

推送身份必须属于 Registry 所在账号。给专用 RAM 用户运行时仓库和构建缓存仓库的 Pull/Push 权限：

```json
{
  "Version": "1",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["cr:PullRepository", "cr:PushRepository"],
    "Resource": "acs:cr:cn-shanghai:ACCOUNT_ID:repository/INSTANCE_ID/NAMESPACE/REPOSITORY"
  }]
}
```

`CLOUD_IMAGE_REGISTRY_AUTH` 的两种模式：

- `password`：Registry 的登录用户名和密码。
- `acr-ak`：Registry 主机须为 `*.cn-shanghai.cr.aliyuncs.com`。登录时用 AK 调
  `GetAuthorizationToken` 换取一小时的临时凭据；CLI profile 放在 job 临时目录，换取后即删除，
  不读写 `~/.aliyun`。运行身份另需下面的权限。该 API 不支持资源级授权，临时凭据继承 AK 的
  全部 Registry 权限，所以这个 AK 只应有上面两个仓库的权限。

  ```json
  {"Effect": "Allow", "Action": ["cr:GetAuthorizationToken"], "Resource": "*"}
  ```

两种模式都经 stdin 把密码交给 `docker login`，只写入 job 私有的 `DOCKER_CONFIG`；错误只输出
固定错误码。实现见 [registry_login.py](registry_login.py)。

## Runner

- 环境：Linux x86_64、Python >= 3.12、Git；构建池另需 Docker 与 Buildx。可用一次性 VM，或由
  ACK 调度的一次性 ECI（见 [runner/README.md](runner/README.md)）。不要把业务 Kubernetes 节点、
  业务实例或个人电脑注册为 runner。
- runner 只注册到本 fork 仓库，每个实例只跑一个 job，结束后回收工作盘与凭据；不注册到组织或
  企业，不复用已有 GitLab Runner。标签只用于调度，不是授权边界。

  | job | 标签（另加 `self-hosted, Linux, X64` 和 `cindy-fork-run-<run_id>-<run_attempt>`） | 权限 |
  | --- | --- | --- |
  | `verify` | `cindy-fork-cloud-check` | 无发布凭据、无 Docker |
  | `candidate` | `cindy-fork-cloud-build` | 独立 privileged DinD；发布步骤读取 candidate Environment |
  | `cache` | `cindy-fork-cloud-cache` | 无 Docker；读取 cache Environment 的 AK |

- 构建池的 Docker daemon 使用经典存储：`--feature=containerd-snapshotter=false --storage-driver=overlay2`。
  流水线把 image ID 当作 config digest，containerd image store 下两者不一致；`docker info` 的
  Driver 不是 `overlay2` 时 candidate job 直接失败。
- DinD 内的 BuildKit 通过 `CLOUD_IMAGE_BUILDX_DRIVER_OPTS` 配置，每行一个选项；不用 ECI 时可留空：

  ```text
  image=registry.example.com/public/buildkit@sha256:<digest>
  network=host
  ```

  `network=host` 指本 Pod 的网络命名空间（Pod 不设 `hostNetwork`），BuildKit 由此使用 Pod 的
  DNS；Cindy smoke 仍使用 `--network=none`。
- runner、DinD 和 BuildKit 镜像都按 digest 固定。拉不到 Docker Hub 时，可以把官方 digest 搬到
  自有仓库（如 `crane copy --no-clobber`），核对两端 manifest、config 和全部 layer digest 一致后
  再使用，不覆盖已有标签。
- 出站：runner 需要 GitHub 的注册、领任务、Actions 下载和 artifact 端点；构建还需要 Docker Hub、
  Debian、Electron、Chrome 等下载源。ECI 方案用每个 Pod 内的 DNS sidecar 解析这些域名，不修改
  集群共享的 `CustomDNSConfig`，见 [runner/README.md](runner/README.md)。

## 参考

- [GitHub 自托管 runner 安全与 JIT](https://docs.github.com/en/actions/reference/security/secure-use)、
  [自托管 runner 通信要求](https://docs.github.com/en/actions/reference/runners/self-hosted-runners#requirements-for-communication-with-github)
- [ACR 权限](https://www.alibabacloud.com/help/en/acr/user-guide/ram-authorization-information)、
  [Tag 不可变](https://www.alibabacloud.com/help/en/acr/user-guide/turn-on-immutable-image-version)、
  [VPC 访问](https://www.alibabacloud.com/help/en/acr/user-guide/configure-access-over-vpcs)、
  [GetAuthorizationToken](https://help.aliyun.com/zh/acr/developer-reference/api-cr-2018-12-01-getauthorizationtoken)
- [ACS API 授权](https://help.aliyun.com/zh/cs/api-acc-2024-04-02-ram)、
  [CreateImageCache](https://www.alibabacloud.com/help/en/cs/api-acc-2024-04-02-createimagecache)、
  [GetImageCache](https://www.alibabacloud.com/help/en/cs/api-acc-2024-04-02-getimagecache)
