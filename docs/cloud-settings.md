# 云实例设置与运维（客户端）

同账号控制端查看、修改托管云实例（云端 Cindy）的设置，并管理它的生命周期。原生客户端与
CIS 网页版共用这套页面。Host 侧设置服务见 [Host 设置与会话入口](host-settings.md)，
只读快照合同见 [云实例设置快照](cloud-settings-snapshot.md)。

## 原则

- 取值、候选项、默认值和写入都来自选中的云实例。不用本机 profile、本机模型目录或本机默认值填充远端配置。
- 复用本机设置页：分类顺序取 `TAB_IDS` 的受支持子集，展示组件、文案和保存/恢复默认交互与本机一致。
  本机组件只抽出展示部分（`*View`），或经 `settingsTarget` 换成远端目标；本机原有行为不变。
- 云页不调用本机配置 IPC。没有远端合同的设置不画假控件，由「更多设置」在云端桌面打开实例自己的设置页。
- 只有明确的平台或托管约束才算「不提供」（见[有意不提供](#有意不提供)）。合同已有但未接控件、读取失败、
  旧运行时未提供，都不是平台限制。

## 准入

- 云实例入口只对 CIS 准入的账号显示。云模式、已登录、登录初始化完成且 Main 身份已提交后，才经 Main 调用
  `GET /client/access`，严格校验 `{ schemaVersion: 1, allowed: boolean }`。该接口不读实例列表；
  有权限但没有实例也返回 `true`。
- `CloudInstanceAccessProvider`（`CloudInstanceAccess.tsx`）共享结果：前台每分钟、重新聚焦、恢复网络、
  页面重新可见时复核，有效结果后 5 秒内的重复触发合并。只读查询失败按 250 / 1,000 / 3,000 ms 重试；
  明确 `allowed: false` 不重试。
- 未确定、拒绝或失败时隐藏全部云入口，直接打开 `/cloud-settings` 回到普通设置。旧 CIS 返回 404 同样隐藏，
  不回退到实例列表或本地推断。
- 结果不落盘。换账号立即丢弃，Main 与 Renderer 都拦截旧身份的迟到响应。查询成功不授予操作权；
  每次操作由 CIS 重新校验准入和实例归属。

## 实例运维

原生客户端里，云实例是「设置 → 远程控制 → 我的设备」中的一台设备（`CloudDeviceDirectory`）。准入账号在
云实例卡上多一组运维操作；其他账号的设备列表与请求不变。旧深链 `tab=cloud-instances` 跳到这里。
设备目录决定远控（在线、开关、远程桌面），CIS 决定生命周期。侧栏不单列云实例，也没有云设置快捷入口。

- **领取**：没有实例时显示「领取云实例」，调用 CIS 无 ID 的 wake，由 CIS 原子创建默认实例。CIS 返回容量且未达上限时
  可再领取一个。响应丢失或 `LOGIN_REQUIRED` 时回读列表，不重放领取。
- **休眠 / 唤醒**：确认具体目标后提交，同一实例不并发写入。实例列表稳定时每 30 秒读取，状态转换中每 5 秒，
  本人刚操作后 30 秒内每 2 秒。打开设置或读取状态不会唤醒实例。
- **更新与维护**：设备卡打开「更新」对话框（`CloudMaintenanceDialog`），显示云版本与可用更新；
  自动更新和更新时段随改随存，带 revision 校验。时段可选默认、每天整点起两小时（按本机时区），或保留已存的自定义时段。
  维护策略只在打开对话框时读取，不随列表轮询。
- **立即更新**：复用 CIS 所有者接口 `GET/POST /instances/:instanceId/maintenance/upgrade`，只提交请求 UUID，
  不选镜像、不跳过备份。已有活动操作时只回读，不并行申请。Main 只在 CIS 声明 `manualUpgrade`、有可用更新，
  且实例运行中、已登录、无资源变更时提交。可在维护窗口外、自动更新关闭时申请，不改自动更新选择；
  任务保护、停机备份和升级由 CIS 执行。
- 这些操作只经 Main 访问 CIS，不依赖云端 Host 在线，不经 SSH 或 DeviceLink 通用 invoke。

## 云端登录

实例待登录（`loginRequired`）时，设备卡打开独立的非模态登录窗口（`main/cloud-settings-client/login-window.ts`）。

- 不切换主窗口路由，不设 parent / modal / alwaysOnTop。主窗口可继续操作；完成后收起登录窗口、刷新实例列表，不抢焦点。
- 复用本机登录界面与主题。控制器只持有不透明 handle，不调用本机登录初始化、账号切换或凭证保存。
  专用 preload（`cloudLoginWindowPreload.ts`）只暴露窗口操作、只读外观和当前代次的云端登录。
  验证码 webview 规则见 [Electron 安全与进程边界](dev-rules/electron-security-and-process-boundaries.md)。
- 短信 / 邮箱验证码经本机现有 Auth / CAPTCHA 链路发送，CIS 的 `personal/prepare-code` 只登记待验证目标；
  验码、归属检查和云端凭证写回在 CIS 完成。第三方登录与 SSO 打开 Auth 的 authorize 页面，Main 轮询 CIS attempt。
  continuation 只在 Main 与 CIS 之间传递，不进 Renderer、日志或磁盘；本机登录态不复制到云端。
- 选择与实例归属不符的身份时拒绝，不能把个人实例转成企业实例。
- 同一实例重复打开复用进行中的尝试。改选实例、关闭登录窗口、切换账号、主窗口关闭到后台，都会取消旧尝试并清空表单；
  普通最小化或遮挡不取消。主窗口销毁或退出应用时销毁登录窗口。
- 休眠实例：CIS 状态带 `loginWakeSupported: true` 时，创建 attempt 附带 `wake: true`，卡片显示「唤醒并重新登录」。
  字段缺失时不发送。

## 实例设置页

路由 `/cloud-settings?deviceId=<id>`（`CloudSettingsView`），从设备卡进入。页头常驻目标实例名，
实例状态在页面可见时每 30 秒刷新。

```text
设置页 → preload 封闭方法 → Main（身份 / 窗口 / 目标校验）
  → CIS 普通客户端设置会话 → settingsWeb 队列 → Host（HostSettingsService / settingsManagement）
设置页 → DeviceLink 私有通道 cloud:* → 实例 Host
```

### 身份与传输

- Main 持有 Access Token、HTTPS 服务地址和远程会话 ID。CIS 地址取当前区域端点清单的 `cloudInstanceApiBaseUrl`。
  Renderer 只拿本机句柄，不能覆盖账号、组织、服务地址、控制设备或实例。
- 句柄绑定发起的 webContents：窗口销毁、主 frame 导航、账号 / 区域 / 设备变化时失效；异步响应前后都复核作用域。
  Token 轮换不算身份变化。
- 请求统一 `credentials: 'omit'`、`redirect: 'error'`、`no-referrer`、`no-store`，8 秒超时，限制响应体大小；
  网络错误、响应正文和凭证不转给界面。
- 新增 IPC 只供本机可信 Renderer，不加入 DeviceLink 通用 invoke 白名单。

### CIS 设置会话

| 路由 | 用途 |
| --- | --- |
| `POST /client/instances/:instanceId/settings/sessions` | 创建短期设置会话 |
| `POST .../sessions/:sessionId/heartbeat` | 续租 |
| `POST .../sessions/:sessionId/requests` | 提交 settingsWeb 命令 |
| `GET .../sessions/:sessionId/requests/:requestId` | 查询结果；CIS 声明 `resultWait` 时带 `wait=1` |
| `DELETE .../sessions/:sessionId` | 关闭会话 |

- 命令直接复用 `shared/settingsWeb.ts` / `shared/settingsManagement.ts`，不新增 Host resource 或第二套执行器。
- 每个句柄最多 4 个在途请求。Host 声明 `readBatch` 时按 `readBatch` / `remainingDomains` 分页读取，否则逐域读取。
- 保存带读取时的 revision 与 operationId，一次只改一个域。冲突保留草稿；POST 响应丢失时查询原 requestId，
  不自动重发；成功后回读。
- 授权票据（供应商、IM、MCP 的 list / run / status / respond / cancel）只接受本会话发起的 operationId，最多 128 个；
  Main 拒绝跨窗口的票据和操作 ID。离页、取消、关闭、过期都有回收路径。「已收到回调」不等于「已绑定」。
- 需要回调到 Host 回环地址的授权（如 OpenAI）：控制端 Main 按授权 URL 中唯一的 redirect 与 state 监听本机回环地址，
  校验后沿原 respond 命令把回调发回同一云端操作；也可手动粘贴同 origin / path 的回调 URL。
  PKCE、换票和凭证保存仍在云端 CLI，凭证不回传控制端。监听最长 5 分钟或到票据过期，取消立即释放。
- 云端 CLI 登录子进程把 `BROWSER` 设为空操作，不在云桌面另开无人管理的浏览器。

私有通道（`cloud:personalization:v1`、`cloud:im-settings:v1`、`cloud:storage-usage:v1`、`cloud:provider-settings:v1`）
只在云运行时注册，只接受实例主人，见 [Host 设置 · 私有通道](host-settings.md#私有通道)。普通桌面和旧运行时返回
`CHANNEL_NOT_ALLOWED`，云页保留旧卡片或只显示标题。

### 页面覆盖

| 分类 | 云页提供 | 说明 |
| --- | --- | --- |
| 通用 | 显示语言、协作、Agent 资源、LSP | 语言只列 Host 接受的值；实例当前语言超出云端 wire 时改为「在云端桌面中打开」 |
| 个性化 | 个人指令正文、记忆开关、子代理 / 辅助模型 / 视觉桥接、终端默认 Shell、加密重试、聊天检索 | 正文经 `cloud:personalization:v1`；模型候选来自目标目录；已保存但目标缺失的 Shell 保留显示 |
| 模型供应商 | 本机供应商页组件：列表、详情头、额度、模型列表与模型设置、添加向导、连接编辑、分享与 CLI 建议 | 目录与模型管理经 `cloud:provider-settings:v1`；登录、密钥和新建连接走 CIS 管理票据，密钥不经 DeviceLink。旧运行时或非实例主人只显示票据列表 |
| IM 机器人 | 官方 Slack / Telegram / X / 飞书，六类个人机器人 | 见下文 IM |
| 插件 | 上游「管理另一台电脑的插件 / 技能」页，目标固定为该实例 | 走 DeviceLink，不经 CIS；网页版显示「在云端桌面中打开」 |
| 工具 | 内置工具开关、浏览器、自定义 MCP 增删改与凭据 | MCP 复用本机 `McpServerDialog`，经实例下发的管理票据执行；凭据只写不回显 |
| 电脑使用 | 浏览器自动化、浏览器后端、电脑自动化 | 不提供 Android / ADB：云实例接触不到用户的设备 |
| 存储 | 数据库提醒阈值、磁盘与数据占用（只读） | 占用经 `cloud:storage-usage:v1`，剩余低于 10% 提示；清理在云端桌面进行 |
| 关于 | 实例版本、使用统计、Debug 日志、崩溃自动上传 | 不显示应用更新与 Beta 通道 |
| 更多设置 | 打开云端桌面中的实例设置页 | 承接本页未提供的设置 |

单域读取失败只影响该分组：原位显示错误与重试，最近一次读取失败的分组保留上次值但不可编辑。身份或归属错误使整页失败。

### IM

- 新运行时（`cloud:im-settings:v1` 可用）直接渲染本机官方 IM 区块（`HookConnectionsSection`）及个人 Telegram 人设 /
  行为 / 群组、个人微信工作目录；连接快照每 2.5 秒轮询，其他视图写后回读。旧运行时保留票据卡片与 CIS 设置域。
- 开启、添加、重新授权、关联等绑定动作走云授权票据，授权页在控制端打开；通道内只允许结束绑定，不发起新绑定。
  目录在实例的目录浏览器中选择，不在实例上弹窗。
- 官方与个人分区不变。条目数来自目标完整分页结果，不硬编码；Slack 工作区逐条展示，只读行保留。
- 官方 Hook 与个人机器人使用独立作用域，个人设置不能改官方 bot。云页看不到与实例配对的其他电脑，跨设备 Agent 不可选。
- 凭据字段只存在当前表单内存，提交、切换目标、失联或离页后清空；已存秘密不回读。结果未知只查询原操作，不重放连接。
- 自动模型以空模型 + 空来源表示，显示实例解析后的实际模型；不当作固定推荐模型，也不以空值判损坏。
  已保存跨设备 Agent 路由的渠道，Host 返回 `unavailable`，云页不开放编辑，避免丢失设备绑定。
- Telegram 已保存但不在当前发现列表中的群保留。

### 有意不提供

| 项目 | 原因 |
| --- | --- |
| 退出登录、登录更多账号、切换账号 | 托管实例身份由 CIS 绑定。云镜像隐藏入口，Main 的 `assertInstanceAuthMutationAllowed` 拒绝直接调用，见 [`runtime-identity`](../deploy/linux-desktop/runtime-identity/README.md)。第三方供应商 / 插件的授权与退出不受影响 |
| 应用更新、Beta 通道 | 由 CIS 镜像、准入和维护策略承接 |
| 应用行为（关闭主窗口、保持唤醒） | 容器不休眠，运行时防止关闭 Cindy；实例自己的设置页也隐藏这一节 |
| 外观、系统通知、发送快捷键、链接打开方式、输入建议、提问导航条、回复动效 | 只影响实例自己的窗口，经「更多设置」修改。`appearance`、`desktopChat` 不属于原生云域 |
| 麦克风、macOS 权限、Agent Island、本机外设、Android / ADB | 属于控制端硬件或平台，不能呈现为云端设置 |
| 伙伴全局模型链 | 上游已移除全局编辑器；Host 读取返回 `unavailable`，写入返回 `UNSUPPORTED_CAPABILITY` |

### 保存与默认值规则

1. 可编辑域使用目标返回的 `value / defaults / customizedKeys / revision / operationId`。不用本机默认值补缺字段，首次打开不写入。
2. 单项恢复默认只清该项；整域恢复只清该域字段，不动其他渠道或作用域。
3. 保存失败、冲突、结果未知、「已保存但应用失败」分开处理。结果未知查询原操作，不重放写入。
4. 结构化模型路由、群组列表复用既有有界 wire schema，不提供任意 JSON 编辑。
5. 机器人连接、通知发送、删除和清理只在用户明确点击时执行。

## CIS 网页版

- `renderer/cloud-web/` 是同一套页面的浏览器构建：`CloudInstancesPage` 列实例，`CloudSettingsPanel` 显示设置，
  身份是 CIS 网页会话。
- 原生客户端经 DeviceLink 的调用，在网页中改为 settingsWeb 的 `channel` 命令（封闭名单 `SETTINGS_WEB_CHANNELS`），
  远程桌面信令改为 `desktop` / `desktopIce`。CIS 只从实例主人已登录的浏览器转发；Host 执行与 DeviceLink 相同的主人校验。
- 网页没有插件页，插件分类显示「在云端桌面中打开」。
- 窄屏（< 768px）样式 `settings-responsive.css` 只由 cloud-web 入口加载，不影响桌面客户端。

## 开发与发行

### 源码联调

```sh
pnpm restart:desktop:remote --region=cn --isolated=dev --passive --endpoints-file=/absolute/path/to/private/endpoint.json
pnpm desktop:whoami --all
```

- 私有端点清单放仓库外，写明当前区域 `region` 与 HTTPS `cloudInstanceApiBaseUrl`，每次启动显式传入。
  不要临时修改仓内公共清单：重启后会丢失 CIS 地址，登录成功但云入口全部隐藏。
- 以 `DESKTOP_DEV_VERDICT=ready` 和 `desktop:whoami` 的 checkout、区域、沙箱为准。首次在独立沙箱登录，
  不复制正式版或 Dev 包的凭证与数据。登录后操作的是账号的真实云实例。
- 缺少服务地址与账号无权限分开诊断，不能用本地推断绕过准入。参数规则见 [Desktop 开发规则](dev-rules/desktop-development.md)。
- DEV 构建的 `/cloud-settings-trial` 是内存试用页，不连真实实例或账号。UI 场景在
  `apps/desktop/scripts/fixtures/cloud-*`。

### 隔离 Dev 发行包

- 版本 `<上游版本>-dev.cloud.<YYYYMMDD>.<序号>`，仅 CN。包内 `cloud-pilot-distribution.json` 必须恰为
  `{ version: 2, profile: "CindyCloudDev-cn", region: "cn", appVersion }` 且 `appVersion` 等于应用版本，否则拒绝启动
  （`main/cloudPilotDistribution.ts`）。没有运行时参数能开启该模式。
- 在鉴权和业务模块加载前切换 userData、sessionData、appData、应用名（钥匙串 safeStorage 名）、持久设备 ID 和
  Cindy 管理的 home；Claude / Codex / GitHub / Pi 配置与浏览器运行目录也在该 profile 内。端点使用包内 `cloud-dev-endpoints.json`。
- 不执行正式版更新检查或补丁，不注册 URL scheme，不提示移入「应用程序」。普通发行包行为不变。
- 签名：

  ```sh
  node apps/desktop/scripts/ci/sign-cloud-dev-local.mjs \
    --app /path/to/staging/Cindy\ Cloud\ Dev\ CN.app \
    --keychain /path/to/dev-signing.keychain-db \
    --identity <persistent-certificate-SHA1>
  ```

  只接受 bundle ID `com.xd.cindycn.clouddev`、profile `CindyCloudDev-cn` 的暂存副本，拒绝已安装应用；
  缺少固定证书直接失败，不回退 ad-hoc。按主应用和各 Helper 的 bundle ID 显式签名后做深度严格校验，不改凭据 ACL。
  macOS 钥匙串按签名要求识别应用（Apple TN2206），持续复用同一张证书才能跨重新打包保留授权。
  证书与钥匙串密码放仓库外。这不是 Developer ID 公证包，对外分发须走团队签名与公证流程。
- 云镜像的构建与交付见 [`deploy/linux-desktop/README.md`](../deploy/linux-desktop/README.md)。

## 随上游升级维护

- 对比本机 `SettingsView` 分类、子组件与搜索入口的变化。新增控件要决定云页是否提供，并登记到上方「页面覆盖」或
  「有意不提供」；不以旧 wire 目录代替 UI 审查。
- 共用展示组件随上游变化时两处一起变；新增控制字段由类型检查提醒补齐远端适配。上游新增字段不会自动接通远端协议。
