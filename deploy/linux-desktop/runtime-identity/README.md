# 云实例身份入口

云镜像构建时隐藏设置个人资料卡的“退出登录”“登录更多账号”，以及侧栏中的账号切换入口。复用原组件和布局；普通客户端不应用这层覆盖。

主进程已有 `assertInstanceAuthMutationAllowed`：退出、增加/切换账号、直接登录及切换本地模式均拒绝；仅 CIS 会话拥有的令牌对可提交。此处不复制校验、不屏蔽资源令牌刷新和 CIS bootstrap，也不限制 OpenAI、MCP 等第三方连接的授权/登出。

已创建实例的登录恢复由 `instance-runtime/auth-recovery.ts` 提供 Pod 内 Unix socket，
仅 resource-v1 模式启动；它不是 renderer 登录接口。CIS 使用原 deviceId 重新获得主人
授权，通过 Kubernetes exec stdin 交付新资源凭证。运行中的 auth manager 校验固定
membership/device，原子更新加密 canonical session，再走 `completeLogin` 恢复数据库和
设备连接。原会话数据、Keyring 和第三方账号不迁移、不重建。

`status.json` 的可选 `authRecovery` 描述能力及 `login-required/pending/ready` 状态；
云 activity publisher 必须保留此字段。CIS 只有收到持久化回执且完整就绪后才能显示成功。
回执按 requestId 和凭证摘要去重，网络重试、写盘失败、进程重启均不能再次花费旧输入。
实际提交沿既有 `remote-input` 维护门禁；未完成写入不能被停机封存。该能力独立于
冻结的 v3 profile 迁移协议，旧镜像不具备此恢复入口。

回归入口：`instance-runtime/__tests__/resourceSession.test.ts` 与 `auth-recovery.test.ts`，
覆盖真实本地 socket、合成凭证、身份拒绝、写盘失败、回执丢失和残留 socket。
这些测试不代表真实认证服务或用户实例已经恢复；需另行记录线上验收。

`stage-cloud-overlays.mjs` 对冻结源码应用覆盖，锚点漂移立即失败。回归测试编译真实覆盖源码、执行资料卡渲染和主进程身份门禁；在同一 `CLOUD_UPDATE_TEST_SOURCE` 下与其他覆盖测试一同运行。UI 提示来自 Main 根据有效实例配置写入的参数，不构成授权依据。
