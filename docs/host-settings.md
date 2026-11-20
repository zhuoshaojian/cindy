# Host 设置与会话入口

托管云实例（Host）侧的设置服务：可写目录、写入入口、私有通道和 settingsWeb 传输。
控制端页面见 [云实例设置与运维](cloud-settings.md)，只读快照见 [云实例设置快照](cloud-settings-snapshot.md)。

## 边界

- 设置属于**运行任务的 Host**，不属于控制端电脑或 CIS 网页。Host 持有真值；CIS 接收脱敏快照，并中转用户明确提交的命令与回执。
- 当前任务的模型与运行参数用 `get_session_runtime` / `set_session_runtime`，不能用新任务默认值修改存活任务。
  资源、镜像、启停、更新属于 CIS / 平台策略。
- 模型与来源必须经执行端实际目录验证。查询只读本地已有目录，不为查询刷新授权或修复配置；没有可用推荐时返回空模型 / 来源，
  不编造占位型号。
- IM / 插件权限只能选既有固定权限档。凭据、任意文件路径和原始配置 JSON 不经此接口；数据删除、日志上传、凭据授权
  保留专用入口，出现在目录中不代表已获授权。

## 可写目录

`HOST_SETTINGS_DOMAINS`（`shared/hostSettings.ts`）= 原四域 + `shared/settingsEditableCatalog.ts` 的附加域。附加域各有固定 schema、
作用域（owner / profile / workspace）和生效边界（`additionalSettingsMetadata`），服务端校验与之对齐。
是否显示取决于 Host 的平台、已连接能力和原生配置；未连接的插件或 IM 工作区没有伪造选项。

| 领域 | 字段 | 现状与生效边界 |
| --- | --- | --- |
| `newTaskDefaults` | `harness`、`providerId`、`modelId`、`effort`、`fast`、`thinking`、`worktree`、`planMode` | 保存在应用窗口；读取 `unavailable`，写入 `UNSUPPORTED_CAPABILITY` |
| `personalization` | `userPrompt`，最多 8000 字符 | 设置会话只返回是否自定义；正文只经 `cloud:personalization:v1`。后续 Agent 启动生效 |
| `databaseWarning` | `thresholdGiB`（1–1024）、`disabled` | Host profile；立即更新提醒策略，不改数据库内容 |
| `appearance` | `uiFamily`、`codeFamily`（最多 256 字符）；`uiSize`（整数 12–24）、`codeSize`（整数 10–24）、`windowZoom`（0.5–3，步长 0.1） | 只作用于该 Host 桌面 |

附加域中的特殊状态：

- `contacts`、`contactsSync`：上游已把智能通讯录移到插件，只保留在 wire 目录，始终读为 `unavailable`。
- `botModelChain`：上游已移除全局伙伴模型链编辑器；读取 `unavailable`，写入 `UNSUPPORTED_CAPABILITY`。只读快照仍报告已保存的值。
- `imGlobal` / `im*`：已保存跨设备 Agent 路由（`agentDeviceId`）的渠道读为 `unavailable`，避免写回时丢失设备绑定。

## 写入入口

- **CIS 设置会话**：原生云设置页与 CIS 网页都经 settingsWeb 队列提交 `update`，带单领域白名单、revision 和 Host 发行的
  `operationId`。`set` 等于默认值也记为自定义；`clear` 删除 override、跟随版本默认值。一次请求不跨领域，不承诺多文件全局事务。
- **Agent 设置工具**：云实例上的 Agent 使用上游 `cindy_helper` 的 `settings` 类目
  （`list_app_settings` / `get_app_settings` / `update_app_settings` / `reset_app_settings`），授权与确认沿用上游。
  上游没有的 Host 领域在云实例启动时登记为上游设置分区（`host-settings/appSettingsSections.ts`，分区 ID 与领域名相同），
  读写仍走本服务的单领域校验、CAS 与文件锁；普通桌面不登记。上游已有分区或模型工具的领域不重复登记；
  按工作区区分的工具设置、个性化正文和新任务默认值不进这组工具。
- **经上游分区落盘**：外观、Git 安全、运行资源、记忆、子代理模型、视觉桥、辅助模型，以及桌面通用 / 聊天 / 通知三组偏好
  （上游 `preferences` 分区），设置会话仍按本服务做 revision 比对和回执，但写入与生效调用上游对应分区
  （`host-settings/upstreamSections.ts` → `manageAppSettings`），并触发上游设置变更通知。单字段恢复默认即写回默认值；
  Git 安全、视觉桥目标模型、辅助模型无法靠写值恢复，改为整组恢复后再写回其余仍自定义的字段。
- IM 渠道默认路由变化前沿用设置页的 `prepareImDefaultSettingsChange`，失败则不保存。
- 读取和保存都从可信上下文核对当前 owner；参数不能自报 owner 或目标实例。保存前、取得文件锁后、发布文件前重验身份与 revision。
- Renderer 只经 `hostSettings.hostOwned` 得知自己运行在托管云实例上（preload 启动时同步查询一次），没有其他
  `host-settings:*` Renderer 通道。
- 云实例和 Dev 包启动时删除旧版投放的 `cindy-settings` Skill：只删仍指向 profile 内 `host-settings-skills` 的链接和该目录
  （`host-settings/retiredSettingsSkill.ts`），用户自建的同名 Skill 不动。

## 应用窗口持有的偏好

与上游一致，云实例的新任务默认值、个人指令、桌面偏好、模型显示 / 引擎 / 收藏 / 思考档都由应用窗口保存（localStorage），
Main 只保留上游已有的内存镜像，不另存 Host 正本。为此给上游 `preferences` 分区补了 `user-prompt`、`model-engine`、
`model-effort`、`new-task-history` 操作（`shared/appPreferenceControl.ts`）。

- **新任务默认值**：由新任务页、上游 `cindy_helper` 的默认模型工具和远程草稿修改，不经设置会话。
- **个人指令**：经 `user-prompt` 操作读写，窗口未应答时为 `unreadable`。任务启动时执行 Host 在原装配点从窗口读取
  （共尝试三次），仍不应答则拒绝启动；随后按原顺序追加项目上下文。控制端发来的正文副本不被采用。
  实例本机个性化页与上游一样只有保存；控制端云设置页另有恢复默认，revision 冲突时禁止覆盖。
- **桌面偏好**：`desktopGeneral` / `desktopChat` / `desktopNotifications` 经 `preferences` 分区读写
  （`host-settings/desktopPreferenceDomains.ts`）。是否自定义按值与默认值比较；`ghostPanelRestoreMode` 固定读默认值且不可写。
- **模型显示 / 引擎 / 收藏**：`modelVisibility` 读上游 Main 镜像，经 `model-visibility` 操作逐个修改；`modelEngines` 经
  `model-engine` 操作；`modelFavorites` 经上游收藏请求 `requestModelFavorites` 逐条增删，保留原条目与速度档
  （`host-settings/modelPresentationDomains.ts`）。
- **思考档**：云设置页供应商面板经 `model-effort` 操作读写窗口的模型记忆，与本机模型设置抽屉用同一组 setter；
  窗口未应答时列表照常返回，思考档显示为默认。
- 窗口未应答时以上各组为 `unreadable`。运行态消费（桌面通知、窗口创建期点击行为、Agent Island）沿用上游，由窗口偏好同步给 Main。
- 只读快照无法同步读取窗口里的值，这些叶子与集合（含 `modelParameterHistory`）报告 `unavailable`。

### 旧版 Host 文件回迁

早期云版本把这些偏好存在 Host 文件里。云实例启动约 10 秒后把它们写回窗口一次，再改名为 `*.returned.json` 保留；
窗口未应答时每 30 秒重试，最多一小时（`host-settings/retiredHostPreferences.ts`）。从未接管或无法读取的文件只改名、不改窗口。

| 文件 | 写回方式 |
| --- | --- |
| `host-desktop-preferences.json` | 经 `preferences` 分区逐项写回（`retiredDesktopPreferences.ts`） |
| `host-model-presentation-preferences.json` | 让窗口与文件一致（`retiredModelPresentation.ts`） |
| `host-personalization.json` | 写回窗口的 `userPromptStore`（`retiredPersonalization.ts`） |
| `host-new-task-defaults.json` | 经 `new-task-history` 以文件历史为底、叠加显式保存的字段，用新任务页自己的 setter 写入（`retiredNewTaskDefaults.ts`、`renderer/state/returnedNewTaskHistory.ts`） |

## 私有通道

同账号控制端的云设置页经 DeviceLink 私有通道读写本实例。通道只在云运行时注册（`main/instance-runtime/*Channel.ts`）；
普通桌面和旧运行时回 `CHANNEL_NOT_ALLOWED`。入口先校验实例主人与 owner generation，回执带 generation，
切换账号后的迟到回执被丢弃。CIS 网页版经 settingsWeb 的 `channel` 命令到达同一 handler（`host-settings/webHostCalls.ts`）。

- `cloud:personalization:v1`：个人指令 `read` / `save` / `reset`，过期写入返回 `REVISION_CONFLICT`，恢复默认即 clear。
  日志不记录正文，正文不进设置快照。
- `cloud:im-settings:v1`：一次转发一个本机 IM handler，封闭名单 `CLOUD_IM_SETTINGS_CALLS`（`shared/cloudImSettings.ts`）。
  覆盖官方 Slack / Telegram / X / 飞书的连接快照、工作目录映射、默认目录、目录偏好、上线播报、官方 Telegram 行为与群；
  个人 Telegram 人设 / 行为 / 群，个人微信工作目录，个人机器人连接状态（回执中名称含 secret / token / password / webhook
  的字符串置空）。发起绑定仍走云授权票据：`set-enabled` 只接受 `false`，`telegramBot:set-online` 只接受下线。
  微信目录写入走 `cloud:wechat:working-dir-set`，复用本机路径校验；provider 链接由实例校验后返回，在控制端打开。
  请求与回执上限 512 KiB，超限拒绝、不截断。
- `cloud:storage-usage:v1`：只读 `read`，返回数据卷总量与剩余，以及与本机存储页相同的数据库、媒体、旧图片缓存、
  聊天附件字节数；单项测量失败置 `null`。只回字节数，不回路径或文件名。
- `cloud:provider-settings:v1`：只对实例主人开放。覆盖供应商目录、模型显示 / 停用 / 排序 / 展示名、远程访问开关、
  模型面板（上下文、价格、图片输入、思考档、模型编辑）、本机 CLI 扫描、分享、自定义连接增删改、拉取模型、测试连接与识别。
  带密钥的步骤先用 `setup-stage` 暂存不含密钥的请求，再经 `setup:apply` 管理票据带密钥执行，DeviceLink 上不出现密钥。

## 保存、并发和回执

- 配置文件适配器在文件锁中重新读盘、检查作用域和 CAS 后原子发布。IM hook 的同步写入由 Host 主线程串行执行；
  官方 hook 偏好复用一次同步原子 rename；vault 中的企业微信开关复用原生串行 secret writer。不承诺跨进程或多文件事务。
- 查询只读：损坏文件返回 `unreadable`，不删除、不修复，不把默认值伪装成真实设置。
- 字段 validator 只在云端读取（`inspect`）和带版本比对的提交（`commitAtomic`）中执行；本机设置页与上游分区的普通写入保持上游语义。
  只在云实例使用的 Host 存储（`atomicOnly`）发布时用私有唯一临时文件。inspection 使用有字节上限、拒绝软链接的读取 helper，
  只有 `ENOENT` 按缺失解释。
- revision 是进程 HMAC 的不透明内容标记，包含 override、当前默认解释和作用域，不是单调编号。重启后旧 revision 失效；不保证发现 ABA。
- operationId 只作相关性和进程内幂等键，不是授权凭证。它绑定 owner / generation、调用方、领域、revision 和规范化请求；
  同 ID 同请求返回既有回执，不同请求拒绝。回执有界，不含正文。进程重启或过期返回未知，先回读，不自动重放。
- 发布前完成可失败的序列化、默认解释和回执构造；通知订阅者失败不改变写入结果。

| 回执 | 含义 |
| --- | --- |
| `saved: true` | 已原子保存到 Host |
| `application: next_task` | 后续新任务生效 |
| `application: next_agent_start` | 后续 Agent 启动生效 |
| `application: applied` | 当前应用回调已完成 |
| `application: failed` 且 `saved: true` | 已保存，但窗口 / 运行时应用失败；不能报告成未保存 |
| `status: unknown` 或 `OUTCOME_UNKNOWN` | 不掌握结果；回读或查询回执，不能自动再写 |

## settingsWeb 传输

`host-settings/webTransport.ts` / `webRuntime.ts` 只在 cloud `resource-v1` Host 启动，从实例端点清单读取 CIS 端点，
复用 `HostSettingsService` 与现有 writer，不开新窗口。Host 用已登录设备的 Access Token 轮询 CIS；
网页侧用 CIS 网页会话；两者不能互换。每次 read 发行的 operationId 绑定当前会话。

- 命令（`settingsWebCommandSchema`）：`read` / `readBatch` / `update` / `receipt`；`manage`（管理票据）；
  `channel`（私有通道和少量 Host 调用，封闭名单 `SETTINGS_WEB_CHANNELS`）；`desktop` / `desktopIce`（网页远程桌面信令）。
- 注册时按新到旧声明可选能力：`readBatch`、`managementV1`、`channels` 与 `desktopV1`。旧 CIS 的严格 schema 返回 400 时
  去掉最新的可选项重试；鉴权或网络错误不降级。先升级 CIS，再升级 Host。
- 每个请求带执行期限，过期不执行。结果确认失败只重送同一回执，不重执行 mutation。runtime 或 owner 变化中断旧请求。
  HTTP 禁止重定向、Cookie 与缓存。
- `readBatch`：1–64 个唯一的已支持领域，执行原有 reader。结果 `{ ok: true, entries: [{ domain, result }], remainingDomains }`
  保留每域原来的错误 / 值 / CAS，不含写回执或 prompt 正文。总响应 ≤ 64 KiB（预留 512 字节 envelope），按 UTF-8 字节在领域边界分页；
  单域超限显式报错。读取累计 5 秒也在领域边界分页。批量不是跨文件原子快照，保存时按每域 revision 校验。
- `channel` / `desktop` 结果上限 2 MiB + 64 KiB。单字段候选最多 512 项，超限明确失败，不截断。
- 工作区工具（`workspaceTools`）：先读取 Host 已知工作区，read / update 带 `workspaceId`。它不是路径，不能指定未知目录；
  revision 同时绑定工作区与继承的全局默认值。修改只影响后续使用该工作区的任务。
- IM 工作区模型与来源分别保存到各自的原生配置。重置偏好保留 native mirror 所需的代次、dirty 标记和删除墓碑。
- 插件 / 模型列表只用当前真实选择项；保留已保存但暂不可用的选择，改动时重新检查连接和模型能力。

### 管理操作（`managementV1`）

- 可选能力，独立于固定的设置 DTO。网页收到绑定会话的动作票据，覆盖机器人、模型供应商、自定义 MCP、通讯录和记忆内容
  （`managementSectionSchema`）。只有编译进 Main 的服务适配器能执行；浏览器输入不能指定 IPC 通道或读取已存凭据。
- OAuth 使用原生服务、PKCE / state 校验、变更队列和 owner 作用域存储，只把展示重定向到发起方浏览器。
  转发的回调 URL 必须匹配该次登录创建的回环监听与 state；取消只关闭该次调用占用的资源。
- 秘密只写，不进设置快照；原生原始错误不返回网页。响应丢失时查询操作，不自动重试变更；重启或取消的操作可能保持未知。
- 只在已认证的云实例传输上运行，不新增 Renderer API、DeviceLink 通道或通用远控端点。现有原生连接与内容服务保留存储归属。

## 只读快照

快照只做展示，不承担写入。合同、预算和版本协商见 [云实例设置快照](cloud-settings-snapshot.md)。

## 测试隔离

自动化测试使用临时 HOME / profile、无效测试身份、内存权限 fixture 或本地独立服务，不读开发者真实授权、Electron userData 或系统钥匙串。
Claude native 还须显式设置 `CLAUDE_CODE_TMPDIR`，不能只靠 `TMPDIR`。macOS Unix socket 路径长度有限，隔离临时根要足够短；
不能为此改回真实 HOME。
