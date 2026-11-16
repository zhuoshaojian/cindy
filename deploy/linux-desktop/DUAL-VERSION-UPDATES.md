# 上游版本与云修订号

云镜像版本由上游完整版本加云修订号组成，提交在 [`delivery/version.json`](delivery/version.json)。
校验、排序和标签格式实现在 [`delivery/versioning.py`](delivery/versioning.py)。

## 版本出现的位置

| 位置 | 示例 |
| --- | --- |
| `version.json` | `"upstreamVersion": "0.1.136"`、`"cloudRevision": 2` |
| 应用版本（关于页、`app.getVersion()`、ASAR 内 `package.json`） | `0.1.136-cloud.2` |
| 镜像版本标签 | `0.1.136-cloud.2-cn-amd64` |
| 镜像源码标签 | `sha-<完整配方 commit>-cn-amd64` |
| OCI 标签 | `io.cindy.upstream-version`、`io.cindy.cloud-revision`、`org.opencontainers.image.version` |

- 仓库源码的客户端版本不变；云构建只在导出的构建源码中把 `apps/desktop/package.json` 写成组合版本。
- smoke 读取 ASAR 内的实际版本，发布前要求它与 OCI 标签和交付计划一致。
- 云客户端内自更新关闭（[`runtime-updates/`](runtime-updates/README.md)），升级由 CIS 负责。
- 目前只支持 `region: cn`、`platform: linux/amd64`，其他组合拒绝构建。

## 排序与递增

- 按整数四元组 `(major, minor, patch, cloudRevision)` 比较，不按字符串或 SemVer 预发布规则。
- 同一上游：修订号每次加 1，`upstreamCommit` 不得改变。
- 新上游：修订号从 1 开始；上游版本不得倒退。
- 推送到交付分支时，`plan.py` 把新的 `version.json` 与上一次推送的版本比较并执行以上规则。
- 部署身份是 Registry manifest digest。两个镜像标签都不可变；修复已发布的候选必须递增修订号。
- 不发布纯 `X.Y.Z` 或 `latest` 标签。

## CIS 升级

CIS（`cindy-server` 的 `cloud-instance-server`）只消费已准入的精确镜像 digest，负责选版、
任务保护、升级前备份、维护停机和失败恢复；这些规则以 `cindy-server` 的文档为准。

原生客户端在云实例版本信息旁提供“立即升级”，调用所有者接口
`GET/POST /instances/:instanceId/maintenance/upgrade`。POST 只提交请求 ID，不提交镜像，
由 CIS 选择合格版本；已有进行中的请求时只读取并显示其进度，不发起并行升级。
详见[客户端接入说明](../../docs/cloud-settings.md)。
