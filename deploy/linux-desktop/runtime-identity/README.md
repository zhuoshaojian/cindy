# 云实例身份入口

云镜像打包覆盖层。在云实例主窗口中隐藏设置页个人资料卡的“退出登录”“登录更多账号”，
以及侧栏账号菜单中的已保存账号切换和本地模式登录项。复用原组件和布局；普通客户端不应用。

覆盖层只改 UI。主进程 `assertInstanceAuthMutationAllowed` 已拒绝退出、增加/切换账号、
直接登录及切换本地模式，仅 CIS 会话拥有的令牌对可提交。覆盖层不复制该校验，不影响资源
令牌刷新和 CIS bootstrap，也不限制 OpenAI、MCP 等第三方连接的授权/登出。

界面标记 `cloudIdentityManaged` 由 preload 根据 `--cindy-cloud-main-window` 参数得出；该参数
只在 Linux 且实例配置有效时由主进程添加（见 `runtime-window-controls`）。它只是展示提示，
不构成授权依据。

## 登录恢复

已创建实例的登录恢复由客户端 `instance-runtime/auth-recovery.ts` 提供，不属于此覆盖层，
也不是 renderer 登录接口：

- 仅 `resource-v1` 模式启动，监听 Pod 内仅属主可访问的 Unix socket
  `/tmp/cindy-auth-recovery/control.sock`（`POST /v1/recover`），没有 TCP 监听。
- 请求的 membership/device 必须与实例一致。运行中的 auth manager 原子更新加密 canonical
  session，再走 `completeLogin` 恢复数据库和设备连接。原会话数据、Keyring 和第三方账号不迁移、
  不重建。
- 按 requestId 和凭证摘要去重，网络重试、写盘失败、进程重启都不会再次花费旧输入。凭证持久化
  后 socket 才返回 `applied`。
- 提交走维护门禁的 `remote-input` 入口，未完成的写入不会被停机封存。
- `status.json` 的可选 `authRecovery` 报告 `login-required` / `pending` / `ready`。云 activity
  publisher 必须保留此字段；`cindy-cloud-healthcheck.mjs --startup` 也读取它。
- 设备被 device-link 移除（4410）后，实例不会自动重新登记，`authRecovery` 报告
  `login-required`：CIS 和客户端显示需要登录，启动检查按等待登录放行，不再反复重启。此时即使
  账号会话仍有效，也接受一次恢复，并在恢复后重建设备连接。
- device-link 只接受显式登录换来的令牌（非空 `amr`、晚于移除时间的 `auth_time`）重新登记。
  同时出现 `authRecovery` 时，`status.json` 顶层写 `authRecoveryCapabilities: ["explicit-access-token"]`，
  表示 `/v1/recover` 接受可选的 `accessToken`（主人这次显式登录的访问令牌）。实例只在它绑定本设备、
  且带显式登录信息时采用，否则用 refresh token 换来的令牌。旧 CIS 会丢弃顶层未知字段，也不会发
  `accessToken`，此时恢复后设备仍被拒绝，实例继续报告需要登录。

## 测试

```sh
CLOUD_UPDATE_TEST_SOURCE=/absolute/path/to/client node --test deploy/linux-desktop/runtime-identity/overlay.test.mjs
```

`stage-cloud-overlays.mjs` 对构建用的源码导出应用覆盖，锚点漂移或重复注入立即失败。回归测试
编译真实覆盖源码，执行资料卡渲染和主进程身份门禁。登录恢复的回归在客户端
`instance-runtime/__tests__/resourceSession.test.ts` 与 `auth-recovery.test.ts`，使用本地 socket
和合成凭证，不代表真实认证服务或用户实例已经恢复。
