# 跟随上游正式版

交付分支是 fork 的 `feat/cloud-settings-native-client`，一条不含 merge commit 的线性提交栈：

1. 上游正式 tag（`makecindy/cindy` 的 `vX.Y.Z`）；
2. 通用接缝：让设置界面作用于另一台电脑的 `refactor(desktop)` 提交；
3. 通用修复：`fix(desktop)`、`fix(remote-desktop)` 等；
4. 仅云端提交：`feat(cloud)`、`fix(cloud)` 等，最后一个是对新上游的适配；
5. 构建提交：`build(cloud)`，其中发版提交 `build(cloud): deliver X.Y.Z cloud.N` 只改
   `delivery/version.json` 和 `source-freeze.json`。

## 步骤

1. 只跟随非草稿、非预发布的正式 Release。记下 tag 的 commit：`git rev-parse vX.Y.Z^{commit}`。
2. 把当前交付分支保存为 fork 的 `backup/cloud-settings-native-client-<旧上游>` 并先推送。
   `plan.py` 要读取上一次推送的 commit，`baseRecipeCommit` 也必须能从 fork 的分支取到；
   CI 只能取到 fork 分支或 tag 上的提交。
3. 从新 tag 建分支，按上面的顺序 rebase。逐个解决冲突，不整仓使用 ours/theirs。
   仅云端提交可以压成一个，避免在同一批文件里反复解决同样的冲突。适配新上游的改动放在单独的
   `fix(cloud): adapt ... to upstream vX.Y.Z` 提交。
4. 检查：
   - `pnpm --filter desktop typecheck`；
   - `pnpm --filter desktop test`，至少覆盖云客户端、cloud-web、Host settings、云设置页和共享契约；
   - [本目录的离线检查](README.md#local-checks)。覆盖层测试读取客户端源码，接入点变化时会失败：
     修改覆盖层去适配，不放宽锚点检查；
   - `verify` job 只稀疏检出回归需要的文件。上游新增的导入导致缺文件时，把路径加进
     `.github/workflows/cloud-image-delivery.yml` 的 `sparse-checkout`。
5. 发版提交：
   - `delivery/version.json`：`upstreamVersion`、`upstreamCommit`（第 1 步的 commit），`cloudRevision: 1`；
   - `source-freeze.json`：`commit` 为最后一个应用源码提交（适配提交），`upstream` 为 `vX.Y.Z`，
     `cloudParent` 为备份分支的 head，`scope` 写新上游；基座输入未变时保留 `baseRecipeCommit`
     （构建会校验字节一致），变了就删掉或改成新 commit。
6. 强制推送交付分支。`version.json` 变化会触发完整交付，见[交付说明](delivery/README.md)。

## 同一上游上的后续发布

修复直接追加在栈顶，再追加一个把 `cloudRevision` 加 1 的发版提交；下次跟随上游时把它们归入
对应层。应用源码有新提交时，`source-freeze.json` 的 `commit` 要指向包含它们的提交；只改
`deploy/linux-desktop/` 配方时 `commit` 不变。版本规则见 [DUAL-VERSION-UPDATES.md](DUAL-VERSION-UPDATES.md)。
