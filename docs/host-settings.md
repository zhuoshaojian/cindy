# Host 设置与会话入口

## 边界

设置属于**运行任务的 Host**，不是控制端电脑，也不是 CIS 管理网页。Host 持有设置真值；CIS 接收脱敏快照；按实例开启网页编辑时，还短期加密转送用户明确提交的命令及回执。本文描述隔离云版本线中的实现合同，不代表已经部署到现有实例。

可写目录由原四个领域扩展为 58 个固定领域，由 `settingsEditableCatalog.ts` 定义并与服务端校验对齐。是否显示还取决于当前 Host 的平台、已连接能力及原生配置状态；未连接的插件或 IM 工作区没有伪造选项。当前任务的模型与运行参数继续使用 `get_session_runtime` / `set_session_runtime`，不能用新任务默认值去修改存活任务。资源、镜像、启停、更新属于 CIS/平台策略。

| 领域 | 字段 | 归属 | 保存后的生效边界 |
| --- | --- | --- | --- |
| `newTaskDefaults` | `harness`、`providerId`、`modelId`、`effort`、`fast`、`thinking`、`worktree`、`planMode` | 当前 owner | 后续新任务；不改变默认权限 |
| `personalization` | `userPrompt`，最多 8000 字符 | 当前 owner | 后续 Agent 启动；存活任务保持启动快照 |
| `databaseWarning` | `thresholdGiB`（1–1024）、`disabled` | 当前 Host profile | 立即更新提醒策略，不修改数据库内容 |
| `appearance` | `uiFamily`、`codeFamily`（最多 256 字符）；`uiSize`（整数 12–24）、`codeSize`（整数 10–24）、`windowZoom`（0.5–3，步长 0.1） | 当前 Host profile | 应用到该 Host 桌面，不改变控制端或网页 |

目录另外覆盖记忆与压缩、模型供应商与专用路由、语言与通知、主题与布局、浏览器/电脑使用、语音与媒体、隐私与诊断、存储维护、终端与 Git 偏好。其中普通持久偏好由原生存储适配到网页与会话工具；硬件、凭据和资源操作仍保留专用入口，不改变控制端配置。数据删除、日志上传和凭据授权不能因为出现在目录中就被视为已获授权。

模型与来源必须经过执行端实际目录验证。查询只读取本地已有目录，不为了查询刷新授权或修复配置；没有可用推荐时返回空模型/来源，不编造 Opus 等占位型号。IM/插件权限只能选择既有的固定权限档，不能授权通用工具本身；凭据、任意文件路径和原始配置 JSON 不属于此接口。

## 字段级只读目录

只读目录由 `apps/desktop/src/shared/settingsReadCatalog.ts` 定义，与扩展的认证写入合同分开。目录记录稳定 ID、实际控件与真源、作用域、适用平台、生效边界、读取域和隐私投影。`SETTINGS_READ_FIELD_IDS`、`SETTINGS_READ_COLLECTION_IDS` 是封闭集合，不接受任意设置键。

| 类别 | 本次覆盖 | 读取与展示含义 |
| --- | --- | --- |
| 设置分区 | 实际 18 个 tab | 与 `TAB_IDS`、真实设置组件连接校验；不是“18 个值均读取成功” |
| 固定字段 | 453 个独立叶子 | 每份 v2 都必须有值和来源，或明确的不可用/不可读/不适用/待迁移/隐私状态；预算不足不能删字段 |
| 动态配置 | 15 个封闭集合 | 只读已知持久项；逐类报告完整性、总量与省略量，未知总量不冒充完整 |
| 外部项目 | 26 个资源、动作、授权或外部入口 | 只登记真实归属和专用入口，不计入“已读取 Host 设置值” |

固定字段包括原四域、Agent/资源/Git/记忆/压缩/模型路由、语音、浏览器与电脑使用、IM、桌面交互和外设。独立覆盖锚点包含 IM global + 七渠道共 96 个默认叶子、27 个快捷键定义的适用项、WorkLouder 两型号的七组设置及完整布局叶子、gamepad 四类别的两组设置及全部按钮/摇杆、桌面 20 组展开的 25 个叶子。平台不适用的快捷键等仍有明确状态，不从报告删除。

动态集合为 `modelVisibility`、`modelEngines`、`modelFavorites`、`modelDisable`、`providerPresentation`、`modelContextBudget`、`modelPrices`、`modelParameterHistory`、`visionBridgeTargets`、`imWorkspacePrefs`、`telegramGroupActivation`、`builtinToolOverrides`、`pluginSidebar`、`pluginCindyPrefs`、`pluginErrandPrefs`。不为填满这些集合扫描所有工作区、刷新供应商目录或读取插件任意 KV/DOM/secrets。

账号/账单、内容库、插件 `settingsHtml`、官方远端 Telegram 行为、授权、安装、更新、清理与备份等维持专用入口。系统授权或驱动可用性不冒充保存的启用偏好；企业微信通知偏好与加密凭据同存，当前只读报告为 `private`，不能为展示它调用解密。

### 只读事实与公开投影

- `readSnapshot.ts` 聚合各领域无副作用 inspection，再由 `snapshotProjectionV2.ts` 逐字段新建公开报告；不能序列化完整 Native snapshot、prompt、history、revision、operationIds 或 owner stamp。
- 读取复用实际 store 的类型、枚举、范围和默认解释，不调用会 ensure、迁移、修复、删坏文件、读取凭据或探测权限的旧 getter；不请求网络、不启动设备。坏领域隔离失败，身份/profile 变化则整次采样失效，不承诺多文件全局事务。
- 保留入口原有差异：原生 UI 的 clamp/round、工具严格拒绝、历史空/null/退役型号都按所属领域解释；wire 校验不能反向放宽原生 mutation 或历史配置 grammar。
- 来源分别是 `default`、`override`、`unknown`。显式保存默认值仍是 override；历史完整快照没有逐字段意图证据时只能标未知，不能按值相等推断来源。
- 模型/来源只有属于随包 `BUNDLED_CATALOG` 的精确公共成员，且通过保守 wire 语法，才可上传公开 ID。活动目录、组织发现、用户连接、前缀、别名或 regex 命中都不是公开性证明；无法证明时只上传配置状态。正文、路径、自由文本、字体名、设备身份以及它们的摘要/hash 均不上传。
- `migrationPending` 表示尚未完成原生领域迁移，不是默认值，也不允许由快照读取自动认领或导入旧数据。网页的未上报、旧版未包含和过期状态另行区分，不能都归成“未配置”。

## 入口与身份

本服务只有两个写入口：CIS 设置会话（云设置页与网页）和 Host 本机设置页的可信 Renderer IPC。两者都按单领域白名单、revision 与 Host 发行的 `operationId` 提交，`set` 等于默认值也记录明确的自定义意图，`clear` 删除 override 后跟随版本默认值。一次请求不能跨领域，也不承诺多个配置文件的全局事务。

Agent 不使用本服务的独立工具。云实例上的 Agent 通过上游 `cindy_helper` 的 `settings` 类目（`list_app_settings` / `get_app_settings` / `update_app_settings` / `reset_app_settings`）读改设置，授权与确认沿用上游规则。上游没有的 Host 领域在云实例启动时登记为上游设置分区（`host-settings/appSettingsSections.ts`，分区 ID 与领域名相同），读写仍走本服务的单领域校验、CAS 与文件锁；普通桌面不登记。已有上游分区或模型工具的领域（外观、Git 安全、运行资源、记忆、子代理/辅助模型、视觉桥、语言主题等偏好、模型显示/上下文/准入/名称/价格）不重复登记；按工作区区分的工具设置、个性化正文和新任务默认值不进入这组工具。外观、Git 安全、运行资源、记忆、子代理模型、视觉桥、辅助模型这 7 个领域，以及桌面通用、聊天、通知 3 组偏好（上游 `preferences` 分区），网页/云设置页保存仍按本服务的 revision 比对与回执，但写入和生效统一调用上游对应分区（`host-settings/upstreamSections.ts` → `manageAppSettings`），保存后会触发上游的设置变更通知。单字段恢复默认写入该字段默认值（上游存储会删除等于默认值的覆盖）；视觉桥目标模型、Git 安全、辅助模型这类无法靠写值恢复默认的字段改用整组恢复，再写回其余仍自定义的字段。IM 渠道路由默认变化前沿用设置页的 `prepareImDefaultSettingsChange`，补录失败则不保存。早期版本投放的 `cindy-settings` Skill 已撤回；云实例和 Dev 包启动时只删除仍指向 profile 内 `host-settings-skills` 的链接及该目录（`host-settings/retiredSettingsSkill.ts`），用户自建的同名 Skill 保持不动。

- 读取和保存都从可信上下文核对当前 owner；参数不能自报 owner 或目标实例。保存前、等文件锁后、发布文件前重验身份与 revision。
- 个性化读取只返回是否自定义，不返回正文；正文只经 `cloud:personalization:v1` 提供给实例主人。
- 插件 OAuth、API Key/PAT 和其它秘密继续使用原有专用授权/保密输入卡片，不经通用设置接口传递。

## 保存、并发和回执

配置文件适配器在文件锁中重新读盘、检查作用域和 CAS 后原子发布；已改造的同文件原 UI writer 共用该边界。IM hook 原有同步写入仍由 Host 主线程串行执行；官方 hook 偏好复用一次同步原子 rename，vault 中的企业微信开关复用原生串行 secret writer，不承诺跨进程或多文件事务。查询只读：损坏文件返回不可读，不删除、不修复、不把默认值伪装成成功读取的真实设置。

revision 是进程 HMAC 的不透明内容比较标记，包含 override、当前默认解释和作用域；不是单调历史编号。重启后旧 revision 失效，不承诺发现外部修改后又恢复原状的 ABA。

操作 ID 只作相关性和进程内幂等键，不是授权凭证。它绑定 owner/generation、调用任务、领域、revision 和规范化请求；同 ID/同请求返回既有回执，不同请求拒绝。回执有界，正文不写入回执。进程重启或过期返回未知，先回读，不自动重放。

| 字段 | 含义 |
| --- | --- |
| `saved: true` | 已原子保存到 Host |
| `application: next_task` | 后续新任务生效 |
| `application: next_agent_start` | 后续 Agent 启动生效 |
| `application: applied` | 当前应用回调已完成 |
| `application: failed` 且 `saved: true` | 已保存，但窗口/运行时应用失败；不能报告成未保存 |
| `status: unknown` 或 `OUTCOME_UNKNOWN` | 不掌握操作结果；回读或查询回执，不能自动再写 |

发布前完成可失败的序列化、默认解释及回执构造；发布后不依赖再次读盘才能确认保存。通知订阅者失败不改变写入结果。初始化迁移发现已经初始化时不重写文件、不发布虚假的设置变化。

## Renderer 偏好迁移

托管云实例上，新任务偏好和个性化从 Renderer localStorage 迁入 owner-scoped Host 文件，不复制整个 localStorage。

普通桌面沿用上游：新任务偏好留在 Renderer 草稿（localStorage）与 Main 内存镜像，个性化留在 Renderer localStorage 并随新建任务请求带给 Main；不迁移、不写 `host-new-task-defaults.json` / `host-personalization.json`，设置读取对 `newTaskDefaults` 与 `personalization` 报告 `unavailable`，写入返回 `UNSUPPORTED_CAPABILITY`。个性化设置页与上游一样只有保存，云实例才有恢复默认。远程草稿选模、会话模型预设、工作树默认、思考开关回写与 Bot 默认模型仍按上游转发给本机 Renderer；只有云实例由 Main 直接写 Host。Renderer 通过 `hostSettings.hostOwned` 判断，preload 在启动时向 Main 同步查询一次；普通桌面上 Main 只回答这个探测，不注册其余 `host-settings:*` Renderer 通道。

- 导入受 owner/generation 和 revision 保护，仅初始化未迁移领域。Host 已经修改或恢复默认的领域不能被旧 Renderer 覆盖。
- 初始化标记不随 reset 删除；旧值保留用于人工处理冲突，但不再作为正常读写真值。
- 新任务偏好保留显式选模标记、各引擎/来源历史型号、per-model tuning、lastModel 与已有权限偏好；不迁草稿正文、附件、工作目录、临时设备或额外可写目录。
- 远程新任务默认值快照增加兼容可选字段 `hostAuthoritative` 与 `planMode`。新控制端看到 Host 权威标记时保留其显式型号与空态，不用控制端推荐替换；计划默认来自执行 Host，发送任务后不反写为关闭。旧 Host 不带标记时维持既有消费路径；旧控制端忽略新字段，不承诺获得新版显式型号保护。Mobile 原有消费范围不在本轮扩展。
- Worker 与远程草稿的 effort 优先级保持各自原合同。
- Renderer 只持有可重建缓存，等待 Host 保存回执后才显示成功。旧回读不能覆盖较新的通知；保存等待期间切换身份不把旧草稿写给新 owner。
- 个性化编辑保留未保存草稿；外部更新造成 revision 冲突时禁止覆盖，提示保留草稿并重新打开设置。恢复默认调用 `clear`，显式保存空串仍然是 override。
- 云实例的个性化由执行 Host 在原启动装配点读取，随后沿原顺序追加项目上下文；控制端发来的正文副本不被采用。公共 system prompt 与各引擎拼接顺序不变。

### 本次新增的 profile 与 owner 正本

- **桌面偏好（与上游一致）**：主题/主题族、语言、侧栏样式、桌面/飞书通知、点击/发送/链接行为、淡入、推荐、消息导航条与网络调试，在云实例上也由应用窗口按上游方式保存（localStorage），不另存 Host 正本。云设置页的 `desktopGeneral` / `desktopChat` / `desktopNotifications` 经上游 `preferences` 分区读写（`host-settings/desktopPreferenceDomains.ts`）：读取须应用窗口应答，未应答时该组为 `unreadable`；是否自定义按值与默认值比较，单字段恢复默认即写回默认值；`ghostPanelRestoreMode` 没有对应偏好，固定读默认值且不可写。上游 `preferences` 分区为此补齐侧栏样式、飞书提醒、切回防误触与网络诊断字段，Agent 与本机设置共用同一入口。早期云版本写下的 `host-desktop-preferences.json` 在启动后经同一分区逐项写回一次，随后改名为 `host-desktop-preferences.returned.json` 保留（`host-settings/retiredDesktopPreferences.ts`）。只读快照无法同步读取窗口里的偏好，这些叶子与普通桌面一样报告 `unavailable`。
- **模型显示、引擎与收藏（与上游一致）**：在云实例上也由应用窗口的上游 store 保存，不另存 Host 正本。`modelVisibility` 读上游 Main 镜像、经上游 `preferences` 的 `model-visibility` 操作逐个模型修改；`modelEngines` 经该分区新增的 `model-engine` 操作读写（上游可单独接受的小扩展）；`modelFavorites` 经上游收藏请求 `requestModelFavorites`（与其它设备读写收藏同一入口）逐条增删，保留原条目与速度档（`host-settings/modelPresentationDomains.ts`）。云设置页模型供应商页的显示开关同样读上游设备列表的 `modelVisibilityOverrides`、按上游镜像算 CAS。窗口未应答时这些组为 `unreadable`。早期云版本的 `host-model-presentation-preferences.json` 启动后让窗口与其一致一次，再改名为 `.returned.json` 保留（`host-settings/retiredModelPresentation.ts`）；只读快照的这三类集合与普通桌面一样报告 `unavailable`。
- **提交与缓存**：profile 写入受 profile stamp/revision 保护，owner 写入另受 owner/generation 保护；都在真实锁内 CAS 与原子提交。多窗口冲突只回读，不换 revision 重放旧整表。初始化标记不随恢复默认删除，旧 Renderer 数据不能重新覆盖；首次导入也尊重旧 owner 的 follow-catalog 墓碑和目标显式选择。兼容首帧缓存只能由成功 Host 提交单向更新，不是第二正本。remote viewer 不经过 Host 存储，沿用上游 localStorage hook。
- **待迁移**：未能证明全新且尚未完成导入的旧 profile/owner 数据返回 `migrationPending`；只有有依据的新 profile 才解释为默认。inspection 不执行导入、不删旧键；完成初始化后，即使没有 Renderer 窗口也能从 Host 读取。
- **运行态消费**：桌面通知、窗口创建期点击行为与 Agent Island 沿用上游：由应用窗口的偏好同步给 Main，云实例不另设读取路径。

### 云设置页的私有通道（仅托管云实例）

同账号控制端的云设置页经 DeviceLink 私有通道读写本实例，正文与设置不经过 CIS 中继或其数据库。通道只在云运行时注册；普通桌面和旧运行时回 `CHANNEL_NOT_ALLOWED`，云页保留旧卡片或只显示页标题。所有通道入口先校验实例主人与 owner generation，回执带 generation，切换账号后的迟到回执被丢弃。

- `cloud:personalization:v1`：个人指令正文 `read` / `save` / `reset`，与本地编辑器一样按 revision 拒绝过期写入（`REVISION_CONFLICT`），恢复默认即 `clear`。日志不记录正文。
- `cloud:im-settings:v1`：一次转发一个本地 IM 设置 handler，名单见 `shared/cloudImSettings.ts`，并编译进 cloud management 的封闭 call 集。覆盖官方 Slack/Telegram/X 的连接快照、工作目录映射、默认目录、目录偏好与上线播报、官方 Telegram 行为与群，个人 Telegram 人格/行为/群、智能通讯录开关、个人微信工作目录，以及个人机器人的连接状态（回执顶层的 secret/token/password/webhook 字符串置空）。
- `cloud:storage-usage:v1`：只读 `read`，返回实例数据卷总量与剩余，以及与本地存储页相同的数据库、媒体、旧图片缓存与聊天附件字节数；单项测量失败只把该项置 `null`。只回字节数，不回路径或文件名；清理仍在实例原生页。
- 发起绑定（开 Slack、添加/重新授权 workspace、关联 Telegram/X、Telegram 上线）仍走云授权票据，授权页在控制端打开；通道内 `set-enabled` 只接受 `false`，`telegramBot:set-online` 只接受下线。目录在实例的目录浏览器中选择，不在实例上弹窗，微信目录写入经私有 `cloud:wechat:working-dir-set` 复用本地路径校验。provider 链接（加群、bot 主页）由实例校验后返回，在控制端打开。

### 共用校验与纯读取边界

字段 validator 只在云端读取（`inspect`）与带版本比对的提交（`commitAtomic`）中执行；本机设置页与上游分区的普通写入（`writePatch` / `writePatchAtomic` / `updateAtomic` / `reset`）保持上游语义，不因云端校验失败或显式写默认值而改变。只在云实例使用的 Host 存储（`atomicOnly`）发布时使用私有唯一临时文件；普通存储仍用上游的临时文件写法。外观、数据库提醒、插件开关、LSP、终端等原生写入链恢复为上游实现，云端写入另走同文件的版本比对提交。inspection 使用有字节上限、拒绝文件软链接的读取 helper，仅 `ENOENT` 按缺失解释；坏文件、权限错误和超限不删除、不修复。新任务默认值与个性化文件通过已提交 owner 和当前 profile 纯定位，不经过会加载或迁移登录态的 getter。

## 跨端快照

只读快照传输保持有时效的白名单报告，不承担设置写入。能力 GET 确认后使用 v2，旧端明确 404 或明确仅支持 v1 时保留四域降级。v1 仍为 8 KiB，v2 为 128 KiB（固定 96 KiB / 动态 24 KiB / envelope 8 KiB），fresh TTL 仍为 180 秒；完整协商形状和版本兼容见 [云设置脱敏快照](./cloud-settings-snapshot.md)。

正常每 60 秒加最多 6 秒抖动采样。原四域已有即时变更通知，可触发 750ms 去抖重采样，但仍受最短 10 秒间隔限制。其它领域没有现成事件时由周期采样覆盖，不为只读展示新增文件 watcher，也不承诺所有设置实时刷新。

## 验证范围与发布边界

自动化测试必须使用临时 HOME/profile、无效测试身份、内存权限 fixture 或本地独立服务，不得读取开发者真实授权、Electron userData 或系统钥匙串。Claude native 还需显式设置 `CLAUDE_CODE_TMPDIR`，不能只靠 `TMPDIR` 隔离其临时缓存。macOS 的 Unix socket 路径长度有限，隔离临时根须足够短，避免地址截断碰撞；不能为解决路径问题改回真实 HOME。磁盘发现不等于三个 native runtime 均已加载。

### 首版门禁历史

以下保留首版已记录的事实，不代表本次全量只读扩展重新执行了这些门禁。

2026-09-19 本地门禁记录：`pnpm test:unit:related` 自动选择全量单测计划，29 个执行 workspace 全部通过，另有 6 个无可收集测试的 workspace 按原清单标记不适用；Desktop typecheck、maker-core 与 device-link build 通过。`@cindy/mcps` build 仍有 9 条、maker-shared 类型检查仍有 8 条错误，使用内存 CompilerHost 与所选 HEAD 对照确认诊断完全一致，本轮没有修这些存量问题或放宽门禁；不能据此声称所有包构建已通过。

- 真实云实例、Electron 双窗口、Windows native、真实模型缓存率与性能尚未验收；本地 fixture 和假模型结果不替代这些证据。

### 本次全量只读扩展的定向证据

- 收口后 Host 设置目录与三份 shared 目录/协议/coverage 测试合跑：**28 个文件、685 项通过**，另有一份 opt-in native 文件的两项按默认配置跳过。下列 92 项已包含在这 685 项中，不重复累计；此轮没有重新执行那两项 native 子代理来源验证。
- 客户端 `settingsSnapshotV2.test.ts`、`settingsReadCatalog.test.ts`、`settingsSnapshotCoverageRuntime.test.ts` 合跑 **92/92**：其中 wire/corpus/预算 78 项、独立目录锚点 9 项、生产 reader 接缝 5 项。5 项 coverage 已包含在 92 项中，不重复累计。
- coverage 在临时空 profile 上运行真实 core/interaction/collections 和显式注入的四域/profile preference 读取接口，经生产聚合、投影和 strict schema 验证三平台全部 453 固定字段、15 动态类接线；另用合法持久 fixture 验证每类动态明细与来源，禁止用恒定 unavailable 或默认值补缺口。它不等同真实 Electron 窗口或端到端验收。
- CIS 本地契约定向 **78/78** 通过，两仓 54 个逐值兼容 corpus 一致；最大合法结构报告均为 **93,853 bytes**（固定 69,133、动态 24,562、envelope 158），满足 128 KiB 分区预算且未丢固定叶子。Zod 3/4 的数组最大形状均实际展开验证。
- 这些定向测试使用任务隔离的短路径 HOME/profile 和专属测试数据库，不读开发者真实凭据；它们不改写上方首版曾发生真实 HOME 副作用的历史记录。定向项与下方完整单测有重叠，不相加为独立测试总数。

### 本次最终回归结果

2026-09-19 在两份任务隔离工作树完成以下检查：

| 检查 | 实际结果 |
| --- | --- |
| 客户端根 `pnpm test:unit:related` | 29 个执行 workspace 全部通过，测试调度器通过；另有 6 个 workspace 按既有清单标记无可收集测试，不计为已执行 |
| Desktop / Mobile `typecheck` | 两者均通过 |
| maker-core / device-link `build` | 两者均通过 |
| maker-shared / `@cindy/mcps` `build` | 分别仍有 8 / 9 条类型错误；与所选 HEAD 的基线一致，未扩修，不能宣称所有包构建全绿 |
| 多语言、术语、设计颜色与界面清单门禁 | 均通过；既有翻译与术语警告仍保留，不代表零警告 |
| CIS `typecheck` / `test` / `build` | 均通过；完整单测 1085 项通过，默认跳过的 17 项浏览器测试另行显式执行并通过 |
| 两端 `git diff --check` | 均通过 |

Mobile 测试使用与 Desktop 生产门面相同的纯 `createModelVisibilityMirror`，注入有类型的 Host 快照与通知；Desktop 静态薄适配器仍连接真实 Host store。测试不再导入完整 Main/owner claim 类型图，也不恢复旧 Renderer setter 的写权限。原超时、短重试、耗尽与恢复断言保留；此次发现的 Mobile 运行失败及类型污染已修复，不能混作上述 17 条基线错误。

CIS 浏览器证据是本地合成身份下的真实 TLS、专属 PostgreSQL 与独立 Chromium，覆盖四语、双主题和窄屏/桌面，不是原云实例或真人验收。32 张截图已保留，但工具通道无法回读图像，未完成视觉目检。两项 opt-in native 子代理测试此轮没有重跑；其他真实云、真人远控及跨平台原生验收边界仍按上文记录。

原六处 checkout 的分支、HEAD、index、完整工作区状态和 324 个既有改动路径摘要均与执行前一致。任务专属数据库容器及匿名卷已回收；日志、截图和隔离临时 HOME 保留，不能称全部临时资源均已清理。两份实现保留在任务工作树，没有提交、推送或部署。

本轮不更改真实 endpoint manifest、不升级现有云实例、不提交或部署。未来发布还必须核对旧 profile 摘要、真实运行时版本，以及 CIS 第七条 migration 的兼容旧业务基座；不能把本地演练当作线上发布批准。

## 网页直接编辑

网页复用 `HostSettingsService` 与现有文件 writer；新增的 `webTransport.ts` / `webRuntime.ts` 只负责 HTTPS 收发、当前身份与执行期限校验。只在 cloud resource-v1 Host 启动，从冻结 manifest 读取明确的 CIS 端点；不启动新窗口、不复制客户端设置布局引擎。

CIS 按实例 allowlist 开启，网页使用已有 HttpOnly 登录会话与 Origin 校验。Host 使用已登录设备 Access Token；两者不能互换。每次 read 发行的 operationId 绑定当前浏览器会话，真实保存与本机设置页共用身份、单领域校验、CAS 和文件锁。网页明确点击保存是独立可信入口；`confirmed` 不是 wire 字段。

只开放上文四个领域，模型选项来自 Host 已缓存的实际目录，不刷新授权。`effort:null` 是显式自动；clear 是跟随默认。prompt 普通查询只返回自定义状态，不能借网页读出旧正文。网页 UI 只发送脏字段，收到 saved 回执后重新读取值与 override 核对；恢复默认用 clear。保存但应用失败单独报告，冲突/结果未知保留草稿，不自动重写。

传输使用 read/readBatch/update/receipt 封闭命令；两仓 `settings-web` 本地实现同步检查。runtime 与 owner 变化中断旧请求，命令 30 秒到期且每个请求只执行一次；只重送同一回执，不重执行 mutation。HTTP 禁止重定向、Cookie 与缓存；命令/响应各有字节上限。CIS 中命令/回执加密且保留不超过 10 分钟，不记录正文。

批量初始化是既有网页通道的兼容扩展。Host 注册声明 `readBatch:true`，仅对已声明的 runtime 下发 `readBatch`；旧 CIS 严格 schema 返回 400 时重试一次不带可选字段的注册，其它错误不降级。应先升级 CIS，再升级指定 Host；旧 Host 与旧网页继续单领域读取，新网页在旧 Host 上也先缓冲后整体显示。

一次批量只接受 1–64 个唯一、已支持领域，执行原有本地 reader。结果 `{ok:true,entries:[{domain,result}],remainingDomains}` 保留每个领域原来的错误/值/CAS；不包含写回执或原 prompt 正文。CIS 验证结果前缀与剩余后缀恰好覆盖原请求。总回执仍受 64 KiB（预留 512 字节 envelope）限制，按实际 UTF-8 字节在完整领域边界分包；单领域已超限显式报错，不截断列表。局部读取耗时达 5 秒也在领域边界分页，让剩余领域获得新请求期限。

每次读取前后仍核对身份、runtime 和期限；批量是减少传输往返，不是跨文件原子快照，保存时按每项独立 revision 再校验。CIS 复用原租约/加密队列，无新增数据迁移。前端先固定完整导航，再收齐所有分页后同步展示表单；单项失败仍可独立重新读取。关闭、身份失效或整批失败丢弃暂存数据，不恢复迟到表单。单领域保存、清除 override、会话确认与远程授权 v3 都不变。

这些网页适配文件无需客户端页面重写。分支里先前为全量只读目录引入的额外 profile/owner 偏好迁移属于另一组改动，不能据此将整个分支称为“客户端小改动”；发布范围需分别审查。

### 客户端完整目录到云端可用配置

新增配置覆盖协作与命令资源、Git 快照、记忆与压缩、辅助/子代理/视觉/伙伴模型、模型显示/收藏/上下文/准入/名称/参考价格、八类 IM 默认值、Telegram 人设和群参与、官方 IM 默认工作目录与通知、IM 工作区模型及来源、插件能力与 Agent 偏好、工具开关、快捷键、桌面布局/语言/通知、浏览器后端、隐私与诊断。每域使用原生 store，保留未修改的配置和未知扩展字段。

- 工作区工具支持原六个普通工具以及浏览器。先读取 `workspaceTools` 取得 Host 已知的工作区列表，再在 read/update 中携带 `workspaceId`。该标识不是路径，不能指定未知目录；revision 同时绑定工作区与当前继承的全局默认值。修改只影响后续使用该工作区的任务。
- IM 工作区模型和来源分开保存到它们各自的原生配置文件；每次只编辑一个领域。重置偏好保留 native mirror 所需的代次、dirty 标记和删除墓碑，不直接删除同步状态。
- 插件/模型列表只使用当前真实选择项；保留已保存但暂不可用的选择，改动时重新检查连接和模型能力。单字段目录选项超过 512 项或响应总量超过 64 KiB 上限时明确失败，不把截断结果称为完整目录。
- 网页保持 en、zh-CN、zh-TW、ja、ko 五语与双主题。未升级 Host 仍使用原四领域布局；新 Host 按客户端设置分类展示扩展领域，未知或不适用的能力不显示编辑控件。
- 远程授权 v3 的身份绑定、签名和专用 IPC 保持原实现；普通配置不会接收 Token。

目标云环境的硬件与连接可用性须在部署/验收时重新检查。桌面语音、物理控制器、iOS/Agent Island、桌面更新器不等同于云实例配置；个人浏览器资料复制、ADB 设置、远程控制同意、IM 绑定与账号凭据保留原生专用流程。

模型目录容量修正只扩充只读 choices，每字段最多 512 项，已保存 override 数量上限不变；总响应仍受 64 KiB 预算约束。CIS 先升级 validator，再升级目标 Host；旧 Host 的不超过 256 项响应仍兼容，新 Host 不向旧 CIS 发送扩大后的目录。远程授权 v3 与确认语义不变。
