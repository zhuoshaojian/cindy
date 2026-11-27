# fork 专属一次性 runner

这些 runner 只为 fork 的 `cloud-image-delivery` 交付服务。仓库、分支和命名空间
固定在 [provision.py](provision.py)。runner 镜像由 [Dockerfile](Dockerfile) 在官方 runner 的固定
digest 上加装 Python 3.12、编译工具和 dnsmasq；也可以使用字节一致的搬运副本。它是 CI 工具
镜像，不是 Cindy 运行时基座。

## Runner Pod

- 注册使用仓库级 JIT 接口 `POST /repos/{owner}/{repo}/actions/runners/generate-jitconfig`。名称
  每次唯一（`cfr-<job ID>-a<run attempt>-t<尝试次数>`），标签与该 job 要求的标签完全一致。
- JIT 配置放在短期 Kubernetes Secret 中，只读挂载到 `/run/cindy-jit/config`。[入口](entrypoint.py)
  通过环境变量交给官方 listener，不放进命令参数或日志；GitHub 显示 job 开始后控制器删除该 Secret。
  控制器的 GitHub token 不进入作业 Pod。
- 每个 Pod 只运行一个 job。工作目录用 emptyDir，不挂业务 PVC、宿主 socket 或 ServiceAccount token。
  runner 以 UID/GID 1001 运行，drop ALL capabilities，`allowPrivilegeEscalation: false`。
- 资源（含 sidecar）：check 4 CPU / 16 GiB，build 8 CPU / 32 GiB，cache 1 CPU / 2 GiB；临时存储
  build 150 GiB，其余 100 GiB。镜像必须锁定 digest，真实镜像与网络由部署配置传入。
- 只有 build Pod 带 privileged DinD（[daemon.sh](daemon.sh)）：经典 `overlay2` 存储，启动前确认
  `/var/lib/docker` 实际可用空间不少于 80 GiB，否则在领取 job 前失败。[preflight.py](preflight.py)
  确认 DinD 为 `overlay2`、x86_64 后才启动 runner。check 和 cache Pod 没有 Docker。
- 入口转发取消信号，退出后写 `/ci/runner.done`，DNS/DinD sidecar 看到后退出。Job 设
  `backoffLimit: 0`、`activeDeadlineSeconds`（check 2400 秒，build 9300 秒，cache 3300 秒）和
  完成后 3600 秒的 TTL。
- 启用 ECI ImageCache 自动匹配（`eci-auto-imc`、`imc-perfect-match`），只预热固定 digest 的
  runner/DinD 镜像。不要用手工 ImageCache：它会把根盘与 emptyDir 分到不同磁盘。未命中时照常拉取。

## DNS sidecar

[dns-sidecar.py](dns-sidecar.py) 用 dnsmasq 在 Pod 内做分域解析，Pod 的自定义 nameserver 为
`127.0.0.1`。它不改集群 DNS，不是 HTTP 代理，GitHub 等 TLS 仍由客户端端到端校验。

- `SNI_FORWARD_DOMAINS` 中的域名解析到 `GITHUB_SNI_FORWARD_IP`（operator 提供的 SNI 转发地址），
  只在本地应答；其他域名转发到 `DNS_UPSTREAMS`。
- runner Pod 转发 `github.com`、`githubusercontent.com`、`ghcr.io`、`nodejs.org`；build Pod 另加
  `docker.io`、`production.cloudflare.docker.com`、`production.cloudfront.docker.com`、`dl.google.com`、
  `snapshot.debian.org`、`artifacts.electronjs.org`。漏掉重定向目标会使拉取超时。
- 默认只监听回环地址。build Pod 另监听 Downward API 给出的 `POD_IP`，DinD 的 DNS 指向该地址，
  供嵌套容器使用；不开 Service 或 hostPort。
- 以 UID 0 运行，drop ALL 后只加 `NET_BIND_SERVICE`、`SETGID`，非 privileged。dnsmasq 会清除
  附加组，所以即使目标组仍是 root 也需要 `SETGID`。

## 自动供给控制器

[controller.py](controller.py) 在独立 namespace `cindy-fork-runners` 中常驻，每 30 秒读取
`cloud-image-delivery.yml` 的运行队列，只出站访问 GitHub，没有入站 Service 或 webhook。

- 只为 push 或 `workflow_dispatch` 触发、状态为 `queued` 的 `verify`、`candidate`、`cache` job
  供给 runner；仓库、来源仓库、分支、workflow 路径、commit 和标签都必须匹配。
- 除按状态筛选的列表外，还检查该分支最近 100 次运行，以免遗漏仍显示 `pending` 的运行。
- 不触发、取消或重跑 workflow，不接受 PR，只调用仓库级 API。
- 单副本 Recreate 加 Kubernetes Lease（180 秒），每次外部写操作前续租并核对持有者。
- 每个 job 的状态与 runner ID 存在 ConfigMap `cfr-state-<job ID>`，不存凭据。未完成的 job 最多 3 个，
  超出的留在 GitHub 队列。
- 启动失败最多尝试 3 次；runner 15 分钟仍未上线时重建，已在线或忙碌的不动。注册响应丢失时先
  注销旧 runner 再重新注册。job 开始执行后不再为同一 job ID 供给；用户 rerun 产生新 job ID。
- GitHub job 结束后最多等待 120 秒让 Job 自行退出，然后删除 Job（核对管理标签和 UID）、JIT
  Secret，最后注销 runner。只删除本控制器创建的资源。
- 完成记录保留 7 天。API 失败时不推断完成，也不删除运行中的作业，下一轮重试。
- 日志只输出固定事件和错误码：`job_admitted`、`runner_created`、`runner_assigned`、
  `runner_reclaimed`、`reconcile_failed`、`controller_cycle_failed`。

## 部署与维护

1. 把 [controller.example.json](controller.example.json) 复制到仓库外的私有位置，填入 runner 与
   DinD 镜像 digest、SNI 转发地址和 DNS 上游。真实网络配置不要提交到仓库。
2. 控制器的 GitHub token 放在 Secret `cindy-fork-autosupply-github` 的 `token` 键。建议使用只授权
   本 fork 的 fine-grained PAT，权限为 **Actions: read**、**Administration: write**。token 只挂载到
   控制器容器；ACR/ACS 的 AK 仍由各自的 GitHub Environment 注入，不交给控制器。
3. 部署：

   ```sh
   # 确认 kubectl context 是目标 ACK；不要使用业务命名空间。
   kubectl -n cindy-fork-runners create secret generic cindy-fork-autosupply-github \
     --from-file=token=/private/path/github-token
   python3 delivery/runner/render.py --config /private/path/controller.json \
     > /private/path/controller-manifest.json
   kubectl apply -f /private/path/controller-manifest.json
   kubectl -n cindy-fork-runners rollout status deployment/cindy-fork-autosupply
   ```

[render.py](render.py) 输出：不自动挂载 token 的 ServiceAccount；仅本 namespace 的 Role/RoleBinding
（Job、Secret、ConfigMap、Lease）；按源码和配置哈希命名的 immutable ConfigMap；控制器
Deployment（含 DNS sidecar）。ServiceAccount token 只投射给控制器容器。

- 更新：重新 render 并 apply；新 Pod 最多等待 180 秒接管 Lease，已启动的 job 不受影响。
- 暂停：把 Deployment 缩到 0。已有 ECI 按各自时限退出，控制器恢复后补做清理。
- 排障：查看控制器的固定错误码和 `cfr-state-*`，不要输出 Secret。3 次启动机会用完后，修复根因，
  在 GitHub 取消仍在排队的运行并重跑；新 job ID 会获得新的 runner。
- 回归：[test_autosupply.py](../test_autosupply.py)、[test_runner.py](../test_runner.py)。

参考：[仓库级 JIT](https://docs.github.com/en/rest/actions/self-hosted-runners#create-configuration-for-a-just-in-time-runner-for-a-repository)、
[workflow job 查询](https://docs.github.com/en/rest/actions/workflow-jobs#list-jobs-for-a-workflow-run)、
[ECI ImageCache](https://help.aliyun.com/en/eci/user-guide/use-imagecache-to-accelerate-the-creation-of-pods-2)。
