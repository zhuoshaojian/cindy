# 云实例设置快照

云实例 Host 定期向 CIS 上报一份脱敏的只读设置快照，供 CIS 网页展示。本文是客户端侧的读取、投影、上报与兼容合同。
可写设置见 [Host 设置与会话入口](host-settings.md)。

## 能力与边界

- Host 是设置唯一权威。网页只读 CIS 保存的最近一份快照：不连 Host 实时查询，不下发设置，不输入凭据，不建离线修改队列。
- 设置保存成功不依赖上报成功；CIS 保存了快照也不代表任务或窗口已应用配置。快照不扩大任何写权限。

## 字段目录

客户端 `shared/settingsReadCatalog.ts` 登记固定字段、动态集合和外部项目；CIS 维护同值的本地目录，不跨仓 import。
静态标题、翻译、范围、单位、源路径和控件元数据不随报告上传。

| 类别 | 展示边界 |
| --- | --- |
| 固定叶子 | v2 报文恰好包含 `shared/settingsSnapshotV2FieldIds.ts` 的 453 个稳定 ID。每个都要有值和来源，或明确状态；不能按容量丢弃，不适用的平台也要报告状态 |
| 动态集合 | 15 个封闭类，明细有界，逐类报告读取范围、完整性、总量与省略量；未知总量明确标未知 |
| 外部项目 | 资源、动作、授权或外部入口的归属登记，不算已读取的设置值 |

- v2 字段集合冻结。本地目录在此之外的叶子（`gitSafety.mode`、`gitSafety.autoInitProjectGit`、`voice.composerLongPressEnabled`、
  iMessage 的 IM 默认值、任务历史前进 / 后退与框选截图快捷键）仍须有真实 reader，但不进 v2 报文。上传新字段须单独协商新版本，
  不能只改 corpus 摘要或放宽旧端校验。fork 侧约定见
  [云端快照兼容](dev-rules/protocol-compatibility/cloud-fork-snapshot-compatibility.md)。
- 动态集合：`modelVisibility`、`modelEngines`、`modelFavorites`、`modelDisable`、`providerPresentation`、`modelContextBudget`、
  `modelPrices`、`modelParameterHistory`、`visionBridgeTargets`、`imWorkspacePrefs`、`telegramGroupActivation`、
  `builtinToolOverrides`、`pluginSidebar`、`pluginCindyPrefs`、`pluginErrandPrefs`。
  只读已知持久项，不扫描所有工作区，不刷新供应商目录或授权。已知工作区只取已存在 Maker 的内存活跃本机会话，过滤远端和非法路径并去重；
  不构造 Maker、不枚举磁盘会话，因此该范围始终是部分范围。`imWorkspacePrefs.dirty` 表示本地写入尚未镜像同步，不是编辑器未保存。
- 账号资料、账单、内容库、安装资源、插件 `settingsHtml`、官方远端 Telegram 行为、授权，以及更新 / 清理 / 备份动作保留专用入口；
  不导出插件 KV / DOM / secrets，不为展示执行动作。
- 三档 Git 模式只在本地目录；云端设置写入仍只有 `autoSnapshotEnabled`（映射为 `all-projects` / `off`），`autoInitProjectGit` 是派生值。

## 读取规则

- **应用窗口持有的值**：桌面偏好、模型显示 / 引擎 / 收藏、新任务默认值、个人指令与上游一样存于应用窗口，快照的同步读取拿不到。
  这些叶子和集合（含 v1 `newTaskDefaults`、`personalization` 与 `modelParameterHistory`）报告 `unavailable`。
- **无副作用 inspection**：`host-settings/readSnapshot.ts` 调用窄的纯 inspection，复用领域真实类型、枚举、范围和默认解释；
  不调用会 ensure、修复、删除坏文件、执行迁移 / claim、读凭据或探测权限的 getter，不联网、不启动设备。读取保存事实不套用当前
  模型写入准入，也不把退役型号换成推荐值。
- **迁移状态**：`migrationPending` 表示尚未完成原生迁移，不是默认值；读取不认领、不导入旧数据。
- **隔离**：单域错误不影响其他领域；身份、代次或 profile 变化使整次采样失效，不拼接不同 owner 的数据，不承诺多文件全局事务。
  原生 UI 的 clamp / round、工具严格拒绝和历史空值 / null 语法不因只读 wire 放宽。
- **投影**：`snapshotProjectionV2.ts` 逐字段新建公开报告，不序列化完整原生快照、prompt、history、revision、operationId 或 owner 标记。

### 公开性与隐私

- 公开 model / provider ID 必须同时满足：属于随包 `BUNDLED_CATALOG` 的**精确成员**，且通过保守的 wire 字符与长度校验。
  活动目录、组织发现、用户连接、前缀、别名和 regex 命中都不算公开证明；读取不会为证明公开性刷新网络目录或授权。
- v2 引用只能是 `{ configured: false }`、`{ configured: true }`，或有证据时的 `{ configured: true, publicId }`。ID 最长 96 字符，
  只允许受限 ASCII 与有限层级的目录标识，拒绝 URL、路径和秘密前缀。动态私有条目只用快照内序号，不传内部 key、名称或稳定身份。
  v1 沿用更窄的旧 ID 语法，没有公开证明时省略 ID。
- **不上传**：个性化 / 提示词正文及其摘要或 hash、Host revision、owner 标记、凭据、URL、文件路径、自由字体名、自定义命令文本、
  设备身份、Provider / MCP 配置、任务消息、操作正文、原始错误。企业微信通知偏好与加密凭据同存，只报告 `private`，不为读取解密秘密。

## 启用条件

上报器只在云实例（实例配置的认证协议为 `resource-v1`）注册（`host-settings/snapshotRuntime.ts`）。每次采样读取已提交的内存 owner，要求：

- 不处于账号切换边界；mode 为 `cloud`。
- owner、当前认证 membership 与实例固定 membership 一致；当前 device 与实例固定 device 一致。
- `authManager.getAccessToken()` 返回现成 AT。上报器不读取、持有或刷新 RT。
- 当前认证 realm 的端点清单提供 `cloudInstanceApiBaseUrl`。

`cloudInstanceApiBaseUrl` 可缺省或为空：此时不上报、不采样、不猜 CIS 地址，也不影响启动。非空值必须是 HTTPS，不能含用户名、密码、
query 或 fragment；dev 的 `allowHttp` 也不放宽。非空非法值按现有清单规则阻断启动。客户端在其后追加固定路径
`/instances/self/settings-snapshot`，例如 `https://cloud.example.invalid/cis` → `https://cloud.example.invalid/cis/instances/self/settings-snapshot`。

## 能力协商

采样前用现成 AT 调用 Bearer-only `GET /instances/self/settings-snapshot/capabilities`。该入口无副作用，不接受网页 Cookie 或 Platform 凭证，
响应不得进共享缓存。支持 v1 与 v2 的响应必须严格等于：

```json
{
  "schemaVersion": 1,
  "supportedVersions": [1, 2],
  "limits": {
    "v1": { "maxBytes": 8192 },
    "v2": {
      "maxBytes": 131072,
      "fixedBytes": 98304,
      "collectionsBytes": 24576,
      "envelopeBytes": 8192,
      "collectionMaxBytes": 4096,
      "collectionMaxEntries": 32
    }
  }
}
```

另一种合法形状是 `{"schemaVersion":1,"supportedVersions":[1],"limits":{"v1":{"maxBytes":8192}}}`。这里的 `schemaVersion: 1`
是能力文档版本，不是报告版本。对象全层 strict，不接受重复 / 未知版本、猜测字段或不匹配的上限。

- 合法 200 且含 v2 时发 v2；只支持 v1 时发 v1。
- **明确 404** 表示旧端没有能力入口，降为 v1。401 / 403、超时、网络或服务失败、非法正文都不算协商成功，不能随后猜测发送另一版本。
- 协商结果最多缓存 5 分钟，绑定身份 / 代次、realm、实例 device 与端点；任一变化立即废弃。
- 新旧报告整份替换，不把旧报告缺失的叶子与上一份 v2 拼接。

## Wire v1

`POST /instances/self/settings-snapshot`，仅普通 Bearer。原始 body 与序列化报告最大 **8 KiB**；原 parser、四域 fixture、取值范围不变，
不能把 v2 叶子塞进 v1。

| 领域 | 可展示内容 | 作用范围及生效边界 |
| --- | --- | --- |
| `newTaskDefaults` | 引擎、有公开证据的来源 / 模型 ID、effort、fast、thinking、worktree、Plan（存于应用窗口时报告 `unavailable`） | 当前 owner；后续新任务 |
| `personalization` | 是否自定义（存于应用窗口时报告 `unavailable`） | 当前 owner；后续 Agent 启动 |
| `databaseWarning` | 提醒阈值、是否关闭 | 云 Host profile；即时 |
| `appearance` | UI / 代码字号、窗口缩放、字体是否自定义 | 云实例自身桌面 |

Envelope 是 `schemaVersion: 1`、UUID `reportId`、CIS 独立水位 `baseRevision`、采样时间 `capturedAtMs` 和四域 `domains`，所有对象拒绝未知字段。
来源只有 `default` / `override`；显式设置为默认值仍是 override。不可读领域报告 `unavailable`，不伪造默认值。ID 无公开证据、
不满足旧语法、为空或未确定时省略；旧协议不支持的 effort 也省略。v2 的细分状态不反向改变 v1 语法。

## Wire v2

Envelope 为 `schemaVersion: 2`、UUID `reportId`、非负安全整数 `baseRevision` / `capturedAtMs`、必需的 `fields` 和 `collections`。
`fields` 恰好 453 个稳定 ID，`collections` 恰好 15 个封闭类；没有任意 `record<string, unknown>` 或自由字符串扩展口。

每个固定字段是以下两类之一，全层拒绝多余键：

- `{ status: 'value', value, source: 'default' | 'override' | 'unknown' }`：`value` 用该 ID 对应的安全类型，不是通用 JSON。
- `{ status: 'unavailable' | 'unreadable' | 'unsupported' | 'migrationPending' | 'private' }`：不附带 value 或来源。

`unavailable` 是暂时取不到；`unreadable` 是读取 / 校验失败；`unsupported` 是平台等不适用；`migrationPending` 是尚未完成原生迁移；
`private` 是不应公开。没有来源证据用 `unknown`，不能按值是否等于默认推断。原四域数值与 Host 对齐：数据库阈值 1–1024 GiB、
UI 字号整数 12–24、代码字号整数 10–24、缩放 0.5–3。

### 动态集合

每类包含 `status`、`total`、`omitted`、`entries`。条目按类使用固定的 typed leaves，另有正整数 `ordinal` 和来源；序号严格递增，只在本份快照内有意义。

- `complete`：`total === entries.length`，`omitted === 0`。
- 已知总量的 `partial`：`omitted === total - entries.length` 且大于 0。
- 未知总量的 `partial`：`total: null`、`omitted: null`，已读取条目照常展示。
- 不可读 / 不可用 / 不适用 / 待迁移 / 隐私：`total: null`、`omitted: null`、`entries: []`，不把失败显示成零条配置。

模型显示集合只展示已保存的显式 override，未覆盖的历史默认 / follow-catalog 路由计入省略量，不宣称遍历了全部可用模型。
参数历史中 provider memory 与 lastByVendor 是独立槽；合法空 effort 按未指定省略该叶子，不丢其他调档或整个集合。

预算分配先保留每类摘要，再按稳定目录顺序轮转加入第 1、2、… 条明细；被容量挡住的集合不跳过中间项。
非法条目、虚假完整性、重复序号或非法尾项直接拒绝，不能靠裁掉错误项「修复」报告。

### UTF-8 预算

| 层级 | 上限 |
| --- | --- |
| v1 原始 body / 报告 | 8 KiB（8192 bytes） |
| v2 原始 body / 报告 | 128 KiB（131072 bytes） |
| v2 全部固定字段 | 96 KiB（98304 bytes） |
| v2 全部动态集合（含摘要） | 24 KiB（24576 bytes） |
| v2 envelope 与余量 | 8 KiB（8192 bytes） |
| 每类动态集合 | 最多 32 条、4 KiB（4096 bytes，含摘要） |

按 `JSON.stringify` 后的实际 UTF-8 字节计算，不用 JS 字符数；原始 HTTP body 另按版本限额，空白不能绕过。不得截断字符串或删除固定叶子腾空间。
入口为 `settingsSnapshotMaxBytesForVersion`、`settingsSnapshotUtf8Bytes`、`validateSettingsSnapshotBudget`、`boundSettingsSnapshotCollections`；
两仓各自的 `settingsSnapshotAnyReportSchema` 校验 `v1 | v2`，共享同值的有效 / 无效 corpus，不共用跨仓运行时。

## 回执与上报节奏

成功返回 `{ revision, receivedAtMs, expiresAtMs }`，有效期不超过 180 秒；revision 独立于实例生命周期版本。

- 409 `SETTINGS_SNAPSHOT_REVISION_CONFLICT`：读取 `error.currentRevision`，下次重新采样并用新 reportId 提交，不复用旧正文。
- 429：尊重 `Retry-After`，退避至少 10 秒、最多 600 秒。
- 其他错误：不输出原始响应、URL、token 或设置正文；不影响设置保存与任务运行。

传输与节奏（`host-settings/snapshotPublisher.ts`）：

- transport 只允许能力 GET 和快照 POST，均设 `redirect: 'error'`、`credentials: 'omit'`、`referrerPolicy: 'no-referrer'`、`cache: 'no-store'`；
  单次请求 8 秒超时，响应最多读 4 KiB；不自动刷新身份。
- 就绪并完成协商后采样，之后每 **60 秒加最多 6 秒抖动**重读。原四域有变更通知，触发 750 ms 去抖；身份变化也请求新一轮。
  其他领域靠周期采样，**不新增文件 watcher，不承诺即时同步**。两次写入至少间隔 10 秒；同一时刻只有一个请求，变化只留「再采样」意图。
- owner generation、owner、realm、device 或端点变化时丢弃旧水位和能力缓存并取消旧请求；旧身份迟到的回执不能更新新状态。
  退出时取消请求、计时器和订阅。

## 网页展示约束

CIS 从静态目录和已验证快照生成展示模型。消费方须区分未上报、旧版未包含、过期、待迁移、不可读、不适用和隐私不公开，
动态类展示 partial / omitted / 未知总量；外部项目不能装成已读取的配置。不渲染未知键、原始 JSON 或原始错误。
云 Host 的外观与语言只作为数据展示，不改变访问者浏览器。只认 v1 的服务端不能解释 v2，降级时应隐藏，不改旧报告凑兼容。
