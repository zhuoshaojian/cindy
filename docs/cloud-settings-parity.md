# 原生云设置与本地设置对照

**结论：尚未对齐。** 之前按分类统计接入情况，遗漏了卡片内的配置与交互，也没有把
源码、安装包、CIS 和云运行时分开验收。机器人授权成功、设置页可打开、两项偏好保存通过，
都不能代表整页配置完成。

本表以 `SettingsView.tsx`、各设置组件及子组件、搜索侧表、原生云页面和 Host 读写适配器为准。
核对日期：2026-10-30；源码基线 `7d5016b64a`，安装包 `0.1.119-dev.cloud.20261030.3`，
本人目标运行时 `0.1.119-cloud.3-cn-amd64`。本轮只读核对，不改机器人、云端配置或部署。
以下是配置项与入口审查，不是所有分支的交互验收；未实测的保存、重开、落盘、恢复仍待验收。

- **已接入**：原生云页面调用目标实例的既有协议，复用本地展示组件；仍须单独验收线上版本。
- **源码接入**：展示/读写代码存在，必须再核对真实入口、远端合同与运行版本；不表示线上可用。
- **待接入**：本地有该能力，云页面尚未完整接通；不能解释为云实例不支持。
- **有意不同**：必须说明平台、账号或托管约束，不能单凭缺少适配器隐藏。

入口正本：[`SettingsView.tsx`](../apps/desktop/src/renderer/components/settings/SettingsView.tsx)。
远端可编辑合同：[`settingsEditableCatalog.ts`](../apps/desktop/src/shared/settingsEditableCatalog.ts)。
原生已接入域：[`cloudSettings.ts`](../apps/desktop/src/shared/cloudSettings.ts)。
完整只读目录：[`settingsReadCatalog.ts`](../apps/desktop/src/shared/settingsReadCatalog.ts)。
只读目录包含大量硬件按键映射及退役兼容字段；字段数不是独立界面选项数，也不能据此宣称全部可写。
本文的“未接入”是实现缺口，只有明确的平台/托管限制才可归为“有意不同”。

## 当前个人微信缺项的直接原因

2026-10-30 11:19（北京时间）通过已安装 Dev 的真实 Main → CIS → 本人云实例读取：
`imWechat` 已在能力列表中，但结果为 `ok:false / SETTINGS_REQUEST_FAILED`。
`imFeishu/imDiscord/imTelegram/imDingtalk/imWecom` 同样失败；`telegramBehavior` 返回 ready，
`telegramGroups` 返回 unavailable。这不是“云端不支持个人微信”，也不是机器人数量限制。

1. 本地 [`WechatBotSection`](../apps/desktop/src/renderer/components/settings/WechatBotSection.tsx)
   在普通个人渠道卡内呈现 `ImDefaultSettingsSection` 和 `WechatWorkingDirectory`；绑定伙伴时另走伙伴配置。
2. 云端 [`CloudImSettings`](../apps/desktop/src/renderer/features/cloud-settings/CloudImSettings.tsx)
   已复用 `ImDefaultSettingsSectionView`，但仅在域 ready、值通过 schema、活动模型路线存在时显示。
   原实现读取失败只显示通用错误。现已抽取本地共用 section frame：加载、失败、未提供与 ready 都保留标题和渠道说明；失败原位呈现 ErrorNotice 和重新加载。
3. `client.ts` 把域级读取错误映射成 unreadable，并保留受限错误码供折叠详情显示；身份和归属错误仍整体终止。错误码仅是本地视图数据，不进入远端写入协议。
   微信工作目录则根本没有原生云适配，不能通过修复模型域读取自动补上。
4. 已知合同缺陷：旧 `imRoute` 要求 `modelId` 非空，而本地“自动”及默认值允许空模型。
   读取结果也会校验 defaults，即使当前固定模型非空仍可能失败；`webBatch.ts` 把校验异常转换成上述错误。
   客户端 `6c7395b9c0` 与 CIS 配套分支已有空模型修正，但本轮真实链路仍失败。
   11:42 只读检查确认：本人实际运行的 cloud.3 ASAR 和 CIS 已部署校验器都未包含空模型兼容修正。
   已有本地 Host 读取/重置测试扩展到六渠道，验证默认路线不被固定、另一渠道配置不被覆盖；正式链路须等 runtime 与 CIS 都交付后复验。

因此须先让三端兼容合同交付并重验这六个域，再完成字段和 UI 交互对齐；只重打控制端不会修复远端读失败。

11:25 再从同一安装包读取当前开放的全部 25 个域，结果如下。这是读取结果，**不是配置完成率**：

| 真实结果 | 域 |
| --- | --- |
| 17 个 ready | `databaseWarning`、`collaboration`、`agentResource`、`memory`、`contacts`、`contactsSync`、`computerTools`、`silentEncryptedRetry`、`lsp`、`diagnostics`、`desktopGeneral`、`desktopChat`、`desktopNotifications`、`telegramBehavior`、`terminal`、`builtinTools`、`browserTools` |
| 6 个 `SETTINGS_REQUEST_FAILED` | 上述六类个人 IM 默认配置域 |
| 2 个 unavailable | `telegramGroups`、`chatEmbedding`；仅确认当前返回，不由此推断平台永久不支持 |

例如 `desktopGeneral` 可读不代表外观控件已经接入；`desktopNotifications` 可读不代表
飞书通知已经接入。另有只读目录、管理动作和未投影到 native 的域，不包含在这 25 个域里。

## 页面与交互差异

| 项目 | 当前事实 | 应达到的结果 |
| --- | --- | --- |
| 菜单 | 本地 `TAB_IDS` 有 20 类入口（部分按平台/身份显示）；真实云页面只投影其中部分 | 每个缺失入口登记原因；不能把投影白名单当成完整本地目录 |
| IM 卡片内容顺序 | 云端先授权/连接，末尾才追加默认模型；本地个人渠道先“新对话配置” | 同一渠道复用同一内容顺序和布局 |
| IM 折叠摘要 | 云端 `routeSummary=null`，本地显示 Agent/模型或伙伴归属 | 摘要来自目标云端配置，不能拿本机模型填充 |
| IM 状态 | 云端简化成文字，微信还使用通用连接开关；本地有渠道状态、等待/重连/解绑卡片 | 使用对应渠道的展示与操作状态，不用通用 OAuth 卡替代整个设置页 |
| IM 读取失败 | 源码已保留与本地共用的标题、渠道说明；加载提示、域级错误、折叠错误码及重试原位呈现 | 等新版 Dev 和云端交付后复核真实链路；失败不撤销能力、不回填本机值 |
| IM 搜索 | 本地搜索条目 ID 是 `imBot`；云过滤写成 `im-bot`，且未接各渠道深链 | 修正 ID，按实际支持项定位并展开相应卡片 |
| 插件入口 | `CloudPluginAuthorization` 有组件，但真实 `client.ts` 不返回 `pluginAuthorization`，也未提供 `plugins()` | 目前应记“真实入口未接”，不能记“插件授权已完整接入” |
| 模型选择 | 云 IM 复用选择器，但禁用配置入口、不提供跨设备路线和自动模型实值预览 | 保留本地交互和远端有效模型语义；确实尚未适配的项明确提示 |
| 保存/恢复 | 已接域有 revision、回执和 clear；未接域不能借用本机 IPC | 每项验证保存→关闭重开→云端落盘→恢复；两字段通过不扩展为整页通过 |

代码依据：[`CloudSettingsView`](../apps/desktop/src/renderer/features/cloud-settings/CloudSettingsView.tsx)、
[`CloudBotAuthorization`](../apps/desktop/src/renderer/features/cloud-settings/CloudBotAuthorization.tsx)、
[`client.ts`](../apps/desktop/src/renderer/features/cloud-settings/client.ts)、
[`ImBotSection.settings-search.ts`](../apps/desktop/src/renderer/components/settings/ImBotSection.settings-search.ts)。

## 通用与运行设置

| 本地项目及配置 | 云页面状态 | 对齐结论与剩余工作 |
| --- | --- | --- |
| 账号资料、头像、账户中心 | 有意不同/待接入 | 显示目标身份；不能用控制端账号资料冒充执行端。资料管理入口未接入 |
| 增加/切换账号、退出登录 | 有意不同 | 托管实例由 CIS 绑定身份；隐藏并由 Main 拦截。第三方供应商授权不属于 Cindy 账号切换 |
| 语言 `locale` | 已接入 | 目标云端值；保留 system 与五语；不改变控制端语言 |
| 任务完成通知 `notificationsEnabled` | 源码接入 | 复用 NotificationSection；保存仅改该字段，不重置飞书通知等其他字段 |
| 激活点击 `swallowActivationClick` | 待接入/按平台 | 合同有字段，云页面未接；云 Linux 上需核对实际消费，不照搬 macOS 行为 |
| 关闭窗口行为、托盘、登录时启动 | 有意不同/待接入 | Cindy 关闭保护由托管运行时控制；系统登录项不属于容器启动方式。不能暴露会终止主进程的普通关闭选项 |
| 发送快捷键 `composerSendShortcut` | 已接入 | 按目标 Linux 显示 Ctrl+Enter；恢复默认只清此项 |
| 伙伴默认模型链 `botModelChain` | 待接入 | 不能用个人 IM 默认模型代替；保留链顺序、空值自动模式与目标模型准入 |
| 伙伴回复去向显示 | 待接入 | `BotsGlobalSettingsSection` 的独立开关，不能随模型链遗漏 |
| 协作 `workerSoftLimit/workerHardLimit/workerIdleReleaseMinutes` | 已接入 | 复用数值框、边界和整域恢复；不是改现有在途任务 |
| 资源 `maxConcurrentCommands/processPriority/capToolchainThreads` | 已接入 | 预设根据目标 CPU，数值框 blur 保存；只清目标域 override |
| Git 自动快照三档 `mode` | 待接入 | 旧远端布尔字段不能区分“已有 Git”与“所有项目”。生产页不猜值；试用数据中的三档不是线上已支持 |
| Pi 扩展包安装/更新/卸载 | 待接入 | 独立操作，不能以普通 boolean 取代包管理；复用原 Pi 能力 |
| 实验功能 LSP | 已接入 | 目标 Host 开关；不以读取设置触发安装或启动 |
| 新任务模型、思考、权限、工作树等默认值 | 待接入（设置页外入口） | 属于新任务/草稿模型组件，不冒充 Settings 中已存在同名面板；不得覆盖运行中的任务 |
| 保持唤醒 | 待适配目标行为 | 本地位于 WindowBehaviorSection；CIS 唤醒/休眠与系统阻止睡眠不是同一项 |

## 外观与个性化

| 本地项目及配置 | 云页面状态 | 对齐结论与剩余工作 |
| --- | --- | --- |
| 主题系列、深浅色、跟随系统 | 待接入 | `desktopGeneral` 已有部分字段；需显示云端可用主题，不能用本机主题列表或直接切本机主题 |
| UI 字体、字号 | 待接入 | 复用本地 FontFamilyControl/字号控件，字体候选必须来自目标系统 |
| 代码字体、字号 | 待接入 | 与 UI 字体分别保存/恢复 |
| 终端字体、字号 | 待接入 | 本地 AppearanceSection 有独立设置，旧读目录未完整覆盖 |
| 壁纸、本地主题文件、布局恢复 | 待接入 | 涉及目标文件/资源，不能发送控制端绝对路径。字体与壁纸不能冒充普通字符串配置已打通 |
| 侧栏固定项样式 | 待接入 | `sidebarPinnedMode` 已有远端字段，本地三档分段控件未接 |
| 侧栏主列表样式 | 待接入 | `sidebarMainMode` 已有远端字段，本地两档分段控件未接 |
| 插件面板恢复位置 | 待核对实际入口 | `ghostPanelRestoreMode` 已有远端字段，不由字段存在推断当前本地外观页有控件 |
| 回复动效 `streamFadePreference` | 已接入并通过两项之一的真实闭环 | 复用 StreamFadeSection，实际放“外观”；保留系统 reduced-motion 优先级，恢复只清该项 |
| 个人指令正文 | 待接入 | 当前真实协议只开放元数据；正文有独立披露/确认边界。试用编辑器不算真实可读写 |
| 记忆 `maker/claudeCode/codex/pi` 开关 | 已接入 | 复用四项开关及恢复默认，仍需逐项写入验收 |
| 记忆清除/内容操作 | 待接入 | 云端传入的 `handleMakerReset/handleReset` 为空；不能把“恢复开关默认”当成记忆内容清除 |
| Subagent：Claude 路由、Codex 智能路由 | 待接入 | 结构化远端字段已有；供应商+模型须一并保存，不能只传模型名 |
| 辅助模型：自动/自定义、首选和两级后备 | 待接入 | 必须复用有序三槽 UI，保留未保存草稿、禁用原因、清空回自动；不能用任意文本框代替 |
| 视觉桥接：启用、主/备用模型、目标模型列表 | 待接入 | `targetModels=[]` 是显式空集，clear 才是跟随默认；不能混为一谈 |
| 智能通讯录开关、跨端同步 | 已接入 | 同步能力不可用时只禁用同步项，不隐藏仍可编辑的主开关 |
| 通讯录内容、同步状态/立即同步 | 待接入 | 属于资源/操作；不能将开关接通等同于管理能力完成 |
| 终端默认 Shell | 已接入 | 候选来自云端；已保存但当前缺失的 Shell 保留显示，不静默换为 auto |
| 网页与本地链接打开方式 | 已接入 | 两项分别保存/清除；“本地”指执行端文件 |
| 问题推荐、消息导航、加密重试 | 已接入 | 分别保留 override；不能恢复一个开关时清整个 desktopChat 域 |
| 聊天检索 | 源码接入、当前域 unavailable | 控件受目标返回状态限制，本轮不能记为可用 |
| 自动压缩比例 | 待接入；旧目录项退役 | 当前本地入口在供应商模型高级设置，不能按旧 CompactionSection 目录重新增加全局比例控件 |

## 模型供应商、插件与工具

| 本地项目及配置 | 云页面状态 | 对齐结论与剩余工作 |
| --- | --- | --- |
| 供应商 OAuth/设备码/取消与断开 | 部分接入 | 使用目标管理 ticket 与独立授权窗口；供应商真实验收结果须按具体方式单列 |
| API Key、自定义供应商、地址及协议 | 待接入 | `supportedActions` 只保留无字段 authorize/disconnect，无这类动作的供应商还会从列表过滤。浏览器授权通过不代表这类表单完成 |
| 模型显示/隐藏、引擎偏好、收藏、停用 | 待接入 | 远端集合合同已有；系统默认与用户 override 分离，旧保存选择不可丢弃 |
| 模型窗口、压缩、思考/Fast、接口和价格 | 待接入 | 按目标连接/模型/引擎定义范围；保留新版本字段，不将旧布尔 Fast 覆盖更细速度档位 |
| 供应商命名、排序、模型参数历史 | 待接入 | 不使用本机排序/最近使用覆盖云端；参数历史只读不代表允许任意写回 |
| 插件启停、授权、自定义设置/专用 CLI | 真实入口未接 | 授权组件及试用场景存在，但当前真实 client 不暴露插件 capability/command；此前写“部分接入”不准确 |
| 插件安装/更新、设置页、资源、侧栏、默认项、并发、Errands | 待接入 | 存量授权/凭证必须保留；不得重新引入上游已退役的逐能力模型钉选 |
| MCP Bearer Token 设置/移除 | 源码接入 | `CloudMcpAuthorization` 有专用凭据表单，不回显已保存的 secret；本轮未写入验收 |
| MCP HTTP Header 增加/移除 | 源码接入 | 仅已下发的管理 ticket；本轮未写入验收 |
| MCP 新增、编辑名称/URL/transport、删除 | 待接入 | 当前只有列表和凭据按钮，没有复用本地 `McpServerDialog` 与 CRUD；不能把凭据管理称为完整 MCP 管理 |
| 内置工具全局开关 | 已接入 | 复用原生分组；关闭不等于卸载 |
| 内置工具/供应商工作目录级覆盖 | 待接入 | 必须使用云端工作目录与该目录的 scope，不能转调控制端工作区 IPC |
| 浏览器自动化、电脑自动化主开关 | 已接入 | 目标 Host 全局范围 |
| 浏览器后端选择 | 待接入 | `browserBackend` 有合同但原生投影未接 |
| 浏览器真实 profile、扩展、驱动及连接检查 | 待接入 | 保留目标浏览器身份和授权，不把控制端 Chrome 配置用于云端 |
| macOS 辅助功能/录屏、iOS 模拟器面板 | 有意不同 | 目标 Linux 无对应平台能力；本机权限仍在本机设置中操作 |
| Android/ADB、其他电脑驱动及权限 | 待核对目标能力 | 只有目标实际未安装/不支持才禁用；不能统一当作“云端没有电脑功能” |

## IM：连接数量、个人渠道、官方 Hook 分开核对

| 本地项目及配置 | 云页面状态 | 对齐结论与剩余工作 |
| --- | --- | --- |
| 个人微信、企业微信、飞书/Lark、钉钉、Discord、Telegram | 已接入连接表单 | 6 类；使用目标列表，不因尚未连接或有必填凭据字段而隐藏 |
| 官方 Slack、Telegram、X 及工作区绑定 | 已接入授权列表 | 3 类不等于 3 条记录，Slack 工作区逐条展示；只读行也保留 |
| 六类个人渠道：默认引擎 | 源码接入，当前真实读取失败 | `imFeishu/imDiscord/imWechat/imTelegram/imDingtalk/imWecom.agentKind`；不能报告已可用 |
| 六类个人渠道：默认模型和供应商来源 | 源码接入，当前真实读取失败 | 每个 Agent 独立 route；目标 DeviceLink 目录加 CIS 校验，不用本机目录 |
| 六类个人渠道：思考档位 | 源码接入，当前真实读取失败 | 保存选中 route 的 effort，不能更换其他 Agent 的选择 |
| 六类个人渠道：使用自动模型 | 源码接入，当前真实读取失败 | 空模型+空来源；不能当作固定推荐模型，也不能以空值判损坏 |
| 六类个人渠道：恢复默认/自定义标记 | 源码接入，当前真实读取失败 | clear 本渠道 override，不清其他渠道；仍未做真实写入闭环 |
| 自动模式当前有效模型预览 | 待接入 | 旧远端结果只给保存配置，不能凭控制端目录猜当前模型，也不能将未返回预览报成“没有可用模型” |
| 跨设备 Agent 默认路由 | 待接入，保护现有配置 | 旧合同没有 `agentDeviceId`；检测到已保存跨设备路由时不开放该域编辑，防止保存时丢失设备绑定 |
| 个人微信：默认模型在卡片中的位置 | 不一致 | 本地在连接区上方；云端统一追加在授权区下方 |
| 个人微信：工作目录选择/显示/恢复 | 待接入 | 本地 `WechatWorkingDirectory`，云端没有对应控制器和远端目录选择 |
| 个人微信：渠道与伙伴绑定/解除 | 待接入 | 本地 `companionBotId` 会切换卡片内容；云管理条目不能表达此状态，不应仍展示普通个人默认模型 |
| 个人微信：权限能力提示 | 不一致 | 本地按 Agent `turnPermissionPolicy` 判提示，云 View 未传 warning；远端适配还硬编码排除 Pi。不能把这一差异宣称为沿用本地能力判断 |
| 个人微信：授权中、待确认、已绑定、需重授权 | 部分接入 | management ticket 能执行授权，但状态卡与取消/重新绑定交互未逐态复用 |
| 企业微信：Bot ID、Secret、连接/重连/断开 | 源码接入 | 通用连接表单；状态卡、错误恢复与本地仍需对齐，本轮不填写凭据 |
| 企业微信：群通知开关 | 待接入 | `wecomNotifications` 有合同，未投影到原生云页 |
| 企业微信：群通知 Webhook 设置/清除/测试发送 | 待接入 | 本地独立凭据和操作，不等于前一行的 enabled；测试会发送消息，不能隐式执行 |
| 飞书/Lark：服务选择、App ID/Secret、主人绑定、重连/清除 | 部分接入 | 通用连接表单已有；本地的已保存凭据恢复、主人状态、说明与错误展示未完整复用 |
| 飞书：群组权限模式 | 源码接入，当前真实读取失败 | `imFeishu.groupPermissionMode`，复用 PermissionSelector |
| 飞书：任务生命周期播报 | 待接入 | `FeishuBotNotificationSection` 的第一个独立开关 |
| 飞书：任务完成通知 | 待接入 | 第二个独立开关，并受主人绑定状态约束，不能用系统通知替代 |
| 钉钉：Client ID/Secret、连接/重连/断开 | 部分接入 | 表单已有，渠道状态/错误恢复/操作指引未完整复用 |
| Discord：Token、Owner User ID、连接/恢复/断开 | 部分接入 | 表单已有，凭据恢复卡和错误展开交互仍不同 |
| Discord：任务生命周期播报 | 待接入 | `ImLifecycleAnnouncementSection` 未进入云页；不是官方 Hook 的同名开关 |
| 个人 Telegram：Token、Owner User ID、连接/断开 | 部分接入 | 表单已有；仍需区分保留绑定与删除凭据 |
| 个人 Telegram：上线/下线、恢复已保存连接 | 待完整接入 | 本地 `ConnectedCard`/`setOnline`，云端通用断开不能替代下线 |
| 个人 Telegram：同一机器人远端设备列表及控制 | 待接入 | 本地 `TelegramRemoteDevices`，不是顶层云实例列表 |
| 个人 Telegram：机器人名称 | 待接入 | `telegramPersona.botName` 有合同但无原生云控件 |
| 个人 Telegram：Soul | 待接入 | `telegramPersona.soul` 有合同但无原生云控件 |
| 个人 Telegram：表情回应 | 源码接入、真实域可读 | `telegramBehavior.emojiReactions`；本轮未保存 |
| 个人 Telegram：群聊引用策略 | 源码接入、真实域可读 | `telegramBehavior.replyQuoteGroup`；不修改官方 Telegram |
| 个人 Telegram：私聊引用策略 | 源码接入、真实域可读 | `telegramBehavior.replyQuoteDm`；本轮未保存 |
| 个人 Telegram：群激活模式 | 源码接入、当前域 unavailable | 显式 always 与发现列表合并；未验收群实际触发，不丢未列出的已保存群 |
| 官方 Slack：多工作区绑定列表、逐条授权 | 部分接入 | 列表分页不能截断；连接操作不等于目录/模型设置 |
| 官方 Hook：目录别名新增/修改/删除、选择实际路径 | 待接入 | 本地 `HookConnectionsSection` 的工作目录编辑；不得传入控制端路径 |
| 官方 Hook：默认工作目录 | 待接入 | Slack/Telegram/X 按各自作用域处理，不同渠道不能相互覆盖 |
| 官方 Hook：每目录 Agent/模型/来源/思考/权限 | 待接入 | `WorkspacePrefsEditor`；不复用个人渠道默认域 |
| 官方 Hook：任务生命周期播报 | 待接入 | `officialHooks.lifecycleAnnouncement` 有合同但无原生云控件 |
| 官方 Telegram 群/引用/表情策略 | 待接入 | 官方与个人为两套架构；不以个人群组表修改官方连接 |
| 官方 X：伙伴归属/绑定解除 | 待接入 | 本地已有独立确认及身份归属，不能用一般断开操作替代 |
| 官方地址覆盖及其他高级字段 | 待接入/按本地可见范围 | 凭据/内部地址不公开在验收记录，不能将只读 configured 标记当成字段值 |

本地对照文件：[`WechatBotSection`](../apps/desktop/src/renderer/components/settings/WechatBotSection.tsx)、
[`ImDefaultSettingsSection`](../apps/desktop/src/renderer/components/settings/ImDefaultSettingsSection.tsx)、
[`WecomBotSection`](../apps/desktop/src/renderer/components/settings/WecomBotSection.tsx)、
[`FeishuBotSection`](../apps/desktop/src/renderer/components/settings/FeishuBotSection.tsx)、
[`FeishuBotNotificationSection`](../apps/desktop/src/renderer/components/settings/FeishuBotNotificationSection.tsx)、
[`DingtalkBotSection`](../apps/desktop/src/renderer/components/settings/DingtalkBotSection.tsx)、
[`DiscordBotSection`](../apps/desktop/src/renderer/components/settings/DiscordBotSection.tsx)、
[`TelegramBotSection`](../apps/desktop/src/renderer/components/settings/TelegramBotSection.tsx)、
[`HookConnectionsSection`](../apps/desktop/src/renderer/components/settings/HookConnectionsSection.tsx)。

以上核对的是这些组件当前可见的配置与动作，不根据旧 DTO 加回已移除的个人私聊权限选择器或
官方 Hook 平级“新对话配置”。当前本地只在个人飞书的默认区显式呈现群权限选择器。

本人实例上一次真实分页读取为 10 条：6 类个人、3 类官方，另加一个 Slack 工作区。
这是该时点的实际连接数量，不是硬编码上限；本轮没有创建/断开机器人或修改凭据。

## 存储、设备、账号与独立操作

| 本地项目及配置 | 云页面状态 | 对齐结论与剩余工作 |
| --- | --- | --- |
| 数据库占用预警阈值/关闭预警 | 已接入 | 阈值校验及自定义标记；只修改目标预警配置 |
| 默认对话目录：查看、复制、打开、选择、恢复 | 待接入 | 本地 `DialogueDirectorySection`；目标目录与控制端目录必须隔离 |
| 存储：数据库/媒体/远端媒体占用统计 | 待接入 | 不能用数据库预警设置代替存储概览 |
| 存储：媒体清理、引用核对、数据库瘦身/取消 | 待接入 | 本地独立操作；本轮未执行任何清理，不能拿合成结果记为通过 |
| 数据备份/导出 | 待核对入口与目标 | CIS 升级前 OSS 备份不等于原生客户端设置中已接入用户数据导出 |
| 工作树查看、回收及恢复 | 待接入 | 需目标工作树和任务占用检查；不拿控制端仓库代替 |
| 快捷键 27 类映射 | 待接入 | 属于目标应用快捷键；与远控客户端向目标发送什么组合键分开 |
| WorkLouder / Xbox 各按键、灯光、布局 | 有意不同/按硬件 | 目录展开共 214 个硬件字段；本机 USB 设备不会因云设置而搬到容器；目标无硬件时不提供虚假控件 |
| 语音输入语言 | 待接入 | 语音页未接入，不能全部归因于云端无麦克风 |
| 语音识别服务/协议/地址/模型/API Key | 待接入 | 云端凭据必须经专用路径处理，不从本机 profile 取值 |
| 语音润色启用、润色规则、服务/模型来源 | 待接入 | 均为本地独立配置，不能用辅助模型选择代替所有项 |
| 语音词典：增删改、别名、CSV 导入、自动学习 | 待接入 | 资源编辑和导入需要目标归属 |
| 语音词典：设备同步 | 待接入 | 与智能通讯录同步不是一份设置 |
| 语音历史、用量查看/重置 | 待接入 | 云端语音历史和控制端历史分开 |
| 麦克风、系统音频、快捷键激活 | 有意不同/按目标 | 明确录音发生端；不能将本机麦克风 ID 存入云端 |
| Agent Island 外观/声音/屏幕 | 有意不同 | 本地入口仅 macOS；云端 Linux 不显示 |
| 语音交互声音、快速激活、说话人过滤/严格度 | 待适配目标能力 | 部分有平台限制；不能将控制端输入监听/声纹状态存到云端 |
| 远程桌面被控开关/控制授权 | 待接入 | 电脑自动化工具开关不是 DeviceLink 远控授权 |
| 设备列表、重命名、移除、逐设备控制权限 | 待接入目标管理 | 本机远控页存在不等于云设置页已适配；本轮未调用移除或修改权限 |
| SSH 主机添加/编辑/连接/断开 | 待接入 | RemoteSection 要操作云端保存的连接和密钥 |
| Local Agent 开发连接码、已授权连接、撤销 | 待接入 | 目标本地 API 的连接凭据不能借用控制端的开发连接码 |
| 供应商远程分享/组、共享任务成员管理 | 待接入 | 独立资源/授权，不是普通标量偏好 |
| 会话导入 | 待接入 | 文件传输、导入路径和目标数据归属未适配，不调用本机文件导入到错误实例 |
| 崩溃自动上传 | 已接入 | `diagnostics.crashAutoUploadEnabled`，未做本轮保存验收 |
| 手动日志上传、打开日志目录、调试日志/网络调试 | 待接入 | 应作用于目标云端日志和诊断；本轮不执行日志追查 |
| 帮助/帮助助手 | 待接入目标上下文 | 不能让“帮我配置”默认改控制端 |
| 版本、升级、维护、唤醒/休眠 | 已接入实例页 | 属于 CIS 管理；保留上游+cloud 双版本。托管镜像不用应用内客户端自更新替换二进制 |
| Beta/闲时重启等本机更新选项 | 有意不同 | 由 CIS 目标镜像、准入及维护策略承接，不能开放成容器内自更新 |
| 账单/账户余额 | 账号面/待明确复用 | 查看云端绑定身份；不能将控制端另一个账号的账单当作云端结果 |
| 用量历史 | 待接入 | 本地 UsageHistorySection 是该设备产生的用量，不能由账户总账单代替 |
| 隐私统计开关 | 待接入 | `privacy.analyticsEnabled` 有合同；现有日志上传开关不能代替 |
| 云实例领取/初始化/登录 | 已有独立入口 | 仍放“设置→云实例”；不是在云端配置中递归领取实例 |

## 默认值、保存与验证边界

1. 每个可编辑域使用目标返回的 `value/defaults/customizedKeys/revision/operationId`。
   不用本机默认值补云端缺字段，不在首次打开时写入一份完整配置。
2. 单项重置只 clear 该项；有整域恢复按钮的组件仅清该域已定义字段，不动其他渠道或作用域。
3. 保存失败、冲突、未知回执与保存后应用失败分开处理；未知结果查询原操作，不自动重放写入。
4. 单域读取失败不隐藏同页已成功的设置。鉴权/身份变化仍使请求整体失败，不降级绕过权限。
5. 结构化模型路由、群组列表复用既有有界 wire schema；不引入任意 JSON 编辑器。
6. 主题 token 与原生共享组件覆盖 Light/Dark；五语标签复用本地。UI 场景、协议测试、真实云端保存三类证据分开记录。

## 补齐顺序与完成口径

1. **先修当前可见功能的断链**：六类个人 IM 默认配置读失败、错误时整个区块消失、搜索 ID/深链，
   以及插件有组件却没有真实入口的问题。区分旧 runtime、旧 CIS 校验和 native 投影，不靠放宽所有 schema 解决。
2. **按本地整张卡复用展示**：首先个人微信的“新对话配置”、工作目录、状态与归属；
   同步覆盖其余个人渠道、官方工作区及各自独有配置，不再只复用外层卡片/基础输入框。
3. **逐类补配置**：外观 → 个性化模型/指令/通讯录 → 供应商/插件/MCP → 语音/快捷键/存储/远控。
   每一类先确定目标读写适配，保留本地分组、条件显示、默认值和恢复语义；不能直接把调用本机 IPC 的组件搬进云页。
4. **每行单独验收**：在有权限的本人实例，用可逆值走 UI 保存、关闭重开、独立远端回读/落盘、
   恢复原值；同时确认本机偏好和另一个实例不变。机器人连接、通知发送、删除/清理不作为隐式测试动作。
5. **有明确理由才能标“不支持”**：如 Linux 不具备 macOS 系统授权、托管实例禁止账号切换和应用自更新。
   已有合同但没画控件、协议未交付、读取失败、缺少真实验收，都属于待完成，不是平台限制。

本地入口复核范围包括 `SettingsView` 的所有分类和其子组件；上表列出的模型、语音、硬件和动态插件
仍需各自的完整交互验收。没有把所有第三方插件的任意动态表单或所有设备条件组合逐个操作一遍，
不宣称已完成穷举。后续随上游升级应对比本地组件/搜索入口差异，新增控件必须登记，不以旧 wire 目录代替 UI 审查。

### 本次变更的交付顺序

IM 空模型表示自动是对既有合同的兼容扩展：先交付 CIS 校验，再交付云运行时，最后启用新客户端控件。
旧 CIS 仍可能拒绝包含空模型的结果，旧 runtime 也可能将整域读成失败；原生页面保留错误状态，
不将其解释为用户没有机器人。结构化 IPC 投影只是控制端修改，不能替代云端更新。

当前 IM 配套修正尚未通过本人实例的真实链路验收。本轮审查不合主干，不触发 CIS 部署或镜像发布。
最新包已在本人实例完成发送快捷键和回复动效的真实保存、关闭重开回读、持久化比对与恢复原值；
其他条目不能据此记为真实验收通过，其他实例不参与。
后续逐项验收以最小可逆变更为原则，不试填假密钥、不新建机器人、不执行存储清理、不覆盖定时任务。

### 前序实现证据与本轮只读复核（2026-10-30）

- Desktop 类型检查通过；原生云设置与 Host 配置定向测试 884 通过、2 跳过。
  本地 IM 默认模型与 Telegram 原控制器回归 31 通过（其中 Telegram 用例与前项有重合）。
- 新增 IM/动效的五语 × 深浅色 20 组 UI 场景通过，另有原页面 10 组通过；
  已目检简中浅色模型区域、深色 Telegram 群组区域。其他语言依赖布局检查与截图，
  不记为逐字人工校对。场景只用内存数据及只读合成模型目录，无真实 OAuth 或连接写入。
- CIS 类型检查通过；独立临时 PostgreSQL 下 1,791 通过、395 按原门禁跳过（含可选浏览器场景）。
  一次高并发执行出现既有 HTTP admission 用例 404；限制为 2 workers 重跑全套通过，
  未修改该路由/测试或降低断言，不将这次测试称为并发生产验收。
- 旧隔离源码客户端对本人实例做了只读检查：其 Main 开放的 16 个域中 15 个 ready、
  `chatEmbedding` unavailable。该版本还包含两项已退役压缩域，因此不能用它证明新版目录完整。
- `20261030.2` Dev 已安装；两项完整保存/重开/云文件/恢复闭环通过，云偏好文件哈希恢复到基线、
  本机偏好未变、云 Pod 未重启。见[实际验收与固定签名边界](cloud-settings-native-trial.md#安装包与真实保存验收2026-10-30)。
  后续 `20261030.3` 已安装，CIS 补充入口和恢复 relay 后的原设备分组都已实际点通，
  云配置入口不会重复；真实 Dev 的 `4410` 设备移除状态通过正常重新登录恢复，端点未变。
  详见[入口与设备连接验收](cloud-settings-native-trial.md#侧边栏入口与设备连接验收2026-10-30)。
  不能将入口及两项保存通过写成全配置对齐。
- 本轮 `.3` 全部开放域的只读检查为 17 ready / 6 失败 / 2 unavailable，详见上表；
  通过真实 Main/CIS 调用，仅保留域名、状态、字段名，不记录凭据或配置正文。
  IM 页的本轮自动点击未完成，不能记为真实 UI 验收通过；本轮没有保存、连接/断开机器人或修改云资源。

### 六类 IM 读取修复回归（2026-10-30）

- 客户端：208 项定向测试通过；类型检查通过。六渠道逐项覆盖加载→读取失败→重试→恢复；只读和重试不保存配置。
- 本地 Host：六渠道空模型默认值及恢复自动模型通过真实配置 store / wire 校验；保存的跨设备路线继续返回不可远程编辑，不丢弃目标设备字段。
- CIS `b427a3c3`：类型检查及隔离 PostgreSQL 下 1791 项通过（395 项平台条件跳过）；原子错误语义、权限与既有字段保持不变，无数据库变更。
- UI fixture：深浅色 × 五语 × 错误恢复/正常配置共 20 项通过，已查看 overview 与个人微信深浅色截图。10 条 sr-only 裁切告警来自无障碍保存提示，无可见文字裁切。该证据是隔离模拟，不是实际云端保存验收。
- 这轮不将其它缺项标成已对齐；个人微信工作目录、授权卡顺序等仍按上表单独跟踪。
