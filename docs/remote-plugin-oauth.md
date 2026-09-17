# 云实例插件授权回调桥

本文描述当前客户端的 v2 签名握手与远程授权事务。代码正本为
`packages/device-link/src/pluginOauthAuthentication.ts`、`pluginOauth.ts` 和
`apps/desktop/src/main/plugin-oauth/`。它适用于 Linux 云 Host 与支持此协议的 Desktop
控制端；代码、打包、真实 provider 验收与线上部署是不同结论，不能相互替代。

## 用户流程与支持范围

1. 云端先查询已装插件。确实缺少当前请求所需的插件时，通过统一的
   `ghost_market_search` / `ghost_market_install` 安装市场返回的精确版本；保留用户停用、
   卸载偏好和来源边界，装完重新 `ghost_info`。安装不等于授权。
2. Host setup 检查发现账号缺失，或任务调用 `connect_account(kind=plugin, id)`，生成
   绑定本任务与云实例的授权卡片。普通任务继续使用原阻塞调用与取消机制。
3. 用户在已连接的 Desktop 点卡片。Renderer 只提交目标设备、卡片、action 与 revision；
   Main 独立核验云 Host 身份和授权目标，不增加第二个原生确认窗口。
4. loopback OAuth 由本机 Main 监听精确本地端口与路径，再打开浏览器。重定向落到本机后，
   回调加密转交原云端事务；云 Host 校验 state，在原 provider/broker 交换 code、提交账号。
   本机不接收插件的 access/refresh token。
5. Device Flow 或浏览器确认页使用统一适配器；本机打开经校验的 provider 页面，云端继续
   等待或轮询。用户码仅在本机卡片临时显示、可重复复制和重开页面。
6. 凭据提交与 readiness 复验成功才完成卡片并继续原请求；浏览器打开或回调到达都不算登录成功。

Host 管理的 `network.secrets[].source=oauth` 沿用插件现有 scopes、PKCE、clientId、
broker 资格、账号合并和刷新机制，不要求改插件。支持原有直接 loopback 和公网 HTTPS
bounce；bounce 保留注册地址用于 authorize/exchange，只将最终回调送回控制端。

GitHub `gh-cli` 与 TapTap Maker 保留必要的凭据源/CLI 处理，卡片、传输和生命周期复用通用层。
不能从任意插件报错可靠推断授权，也不提供任意 Node/CLI 命令的授权代理。网站 Cookie、账号
保险库、外部 MCP 自管 OAuth 不因此获得通用同步能力。SSH 工作区也不获得本机凭据。
Mobile 可展示或取消现有卡片，没有 Desktop loopback 接口；需在连接该云实例的 Desktop 完成。

## 可扩展登录方式

| 方式 | 接入点 | 谁判定完成 |
| --- | --- | --- |
| 标准插件 OAuth / 企业 SSO / MFA | 既有 `source:oauth`、provider/broker 配置，无需改插件 | 云 Host 交换、保存并复验 |
| 设备码授权 | `bindAuthorization()({kind:'device', url, userCode?, expiresAt?})` | 原 CLI/Node 领取、保存并实际校验 |
| 浏览器确认、提供 HTTPS 确认页的扫码登录 | `kind:'browser'`；页面由上游提供 | 原 CLI/Node 轮询并校验；打开页面不算成功 |
| CLI 的 OAuth PKCE loopback | `kind:'loopback'`，精确绑定原 redirect URI、state、S256 challenge | 原可信 Node/CLI 用自己保管的 verifier 交换并校验 |
| 用户填写的 API Key/PAT | 既有声明式 `inline_form`，专用加密输入桥 | 原 Host executor 写指定 Secret；只表示配置保存，不保证上游权限有效 |

手动创建 Token 的 CLI 插件可以只给登录 RPC 声明 `node.secretBindings`，普通
`setup.requires` 保持空数组，以继续复用已存在的 CLI 登录。携带当前 `callId` 的
Node 请求缺少对应凭证时，`nodeSecretSetup.ts` 按精确方法/入口生成临时配置卡；
`promptSecrets: true` 用于用户明确要求手动登录或替换 Token，即使已有值也展示输入框。
这个标记只属于插件到运行它的 Host 的本地请求；跨 Host 卡片、密钥协商、加密提交协议不变。
Host 只有在本次卡片实际提交后才在 Worker 私有 envelope 写入
`cindy.secretInputCompleted=true`；需要本次人工输入的登录方法检查此标记，旧 Host
缺标记时拒绝导入，不能因其忽略 `promptSecrets` 而静默使用旧值。插件自报标记无效。
没有在途任务、声明不匹配、账号或包已变化、用户取消时不启动 Node 请求，不清除旧凭证。

卡片中的 Token 只交给目标 Host 的既有 vault executor，再从私有
`request.cindy.secrets` 注入声明的 Node RPC；不经工具参数、聊天消息、普通远控或插件
`main.js`。真正需要向官方 CLI 交付时仅使用 stdin，固定参数中不包含 Token，返回值仅报告
状态。TapTap Maker 手动适配的流程为：网页创建 Token → 本地保密卡输入 → 目标 Host 保存 →
官方 CLI 验证 Token 并保存登录 → 最小只读权限核验。平台验证失败不算登录成功。

这不是针对恶意 Node 插件的系统隔离；可信插件/CLI 最终会使用凭证，既有 CLI 凭证目录仍属于
该插件的存储边界。新适配仅在支持上述 Node 接线的受控镜像中交付；旧 Host 不作为手动卡片
验收环境，也不通过聊天收取 Token 降级。更换存量登录前的取消保留原值；提交新 Token 后，
Host vault 可保存待验证的值，CLI 仅在平台验证成功后替换自己的登录材料。

新增 provider 若使用已支持方式，只接入同一类型化接口及安装声明中的目标域名；无需为其添加
卡片组件、IPC、Agent 工具或新的 relay/API 路由。已有 `bindDeviceAuthorization(url)` 和原
OAuth 路径继续可用。新方式不自动解释任意 CLI 输出：CLI 包需调用一次通用接口，或由受审查
的 Host 凭据源适配器接入；不能宣称所有既有 CLI 都无需改动。

代码扩展点：`authorizationAdapters.ts` 按方式登记；`hostLoginAdapters.ts` 注册原生凭据源，
匹配冲突、失效和失败都拒绝，不试探下一种权限更宽的来源；`builtinAuthorizationTargets.ts`
集中保存已审查的 GitHub/TapTap 目标约束。新增传输方式须同时增加协议解析、协商与安全测试。
插件包不能注册任意 Host 回调或进程命令。

代码按以下职责维护，新增方式复用同一事务与卡片生命周期：

| 位置 | 职责 |
| --- | --- |
| `packages/device-link/src/pluginAuthorization.ts`、`pluginSecretSubmission.ts` | 跨 Host 的类型与严格解析；新增字段须明确协商与兼容性 |
| `apps/desktop/src/shared/pluginOauth.ts` | Desktop 本地 IPC 类型、输入卡片展示字段；不增加远程可调用通道 |
| `main/plugin-oauth/transactions.ts` | 各方式共用的单次交换、有效期、取消与终态清理 |
| `main/plugin-oauth/controller.ts`、`localIpc.ts` | 本机目标认证、协商、加密回传与结果观测 |
| `main/plugin-oauth/cards.ts`、`deviceCard.ts` | 绑定既有卡片；只有原 Host/CLI 确认完成才更新为成功 |
| `main/plugin-oauth/authorizationAdapters.ts`、`hostLoginAdapters.ts` | 浏览器交互方式与受审查的 Host 凭据源适配 |

表中 `main/` 相对 `apps/desktop/src/`。本地输入与加密消息复用同一值校验，输入前不构造
虚假事务 state；卡片字段在 Renderer 和 Main 复用同一投影，接收时仍独立校验云 Host 的完整展示。
模式协商、回调类型及 state 校验保留在事务边界，不能由新适配器绕过。

CLI loopback 只接受 `http://127.0.0.1:<port>`、`http://[::1]:<port>` 或 localhost，
显式非特权端口、固定路径，无 query/hash。authorize URL 必须含唯一且一致的 state、
redirect_uri、response_type=code、client_id、43 字符 S256 challenge。私有回调只回到发起的
可信 Node RPC（不经 stdout、沙箱 main.js 或 Agent），交换后只向业务层返回固定状态。
本机运行时原 CLI 已占用回调端口，桥只打开页面；远程运行时由控制端监听该端口。端口冲突
明确失败，不抢端口、不改注册地址、不转发任意 HTTP。Node 拥有系统用户权限，不能把这条
API 描述成针对恶意 Node 的系统隔离。

设备码和原生应用回调分别参考 [RFC 8628](https://www.rfc-editor.org/rfc/rfc8628) 与
[RFC 8252](https://www.rfc-editor.org/rfc/rfc8252)。上游未提供这类授权契约时不猜测适配。

## 身份来源与签名握手

云 Host 在进程内生成 Ed25519 签名身份，由 CIS 的可信状态读取链路公布公钥与 bootId。
控制端使用发行包内的 `plugin-oauth-authority.json` 固定 CIS HTTPS origin，并核对当前
realm/authOrigin；不接受卡片、relay 或 Renderer 指定该地址。缺少或不匹配时拒绝授权。

Main 用当前 Resource Access Token 请求 CIS 的
`GET /instances/oauth-identity/:deviceId`。CIS 必须校验实例归属，响应结构为：

```ts
type TrustedIdentity = {
  version: 1;
  publicKey: string; // Ed25519 SPKI, base64url
  bootId: string;
  instanceId: string;
  deviceId: string;
  membershipId: string;
  observedAtMs: number;
  expiresAtMs: number;
};
```

控制端校验 membership/device、最长 60 秒新鲜度、过期时间与精确字段；响应有大小限制，
禁止 HTTP 重定向。随后通过私有 `device-link:plugin-oauth:v2` 发起：

```ts
type Action = { requestId: string; actionId: string; expectedRevision: number };
type Hello = {
  op: 'hello'; version: 2; nonce: string;
  publicKey: string; // ephemeral X25519 SPKI
  action: Action;
};
type HelloReply = {
  version: 2; id: string; publicKey: string; bootId: string;
  ghostId: string; expiresAtMs: number; signature: string;
};
type Exchange = { op: 'exchange'; id: string; box: string };
// box 解密后：{ nonce, request: InnerRequest }
// 响应 box 解密后：{ nonce, ok: true, result } | { nonce, ok: false }
```

签名绑定 membership、目标 device、控制端 device、可信签名公钥、bootId、双方临时公钥、
随机 nonce、事务 ID/期限、卡片/action/revision 和插件。先验签，再发 start 或打开授权页。
签名私钥不离开云 Host；握手不回退无签名 v1。X25519、HKDF-SHA256、AES-256-GCM 保护
后续交换，方向与事务纳入密钥派生/AAD；回包必须匹配本次 nonce。

## 内层事务与本机接口

`plugin-oauth:assist` 仅接受可信顶层 Renderer 提交：

```ts
{ deviceId: string, ghostId: string, requestId: string, actionId: string, expectedRevision: number }
// 成功响应：{ accepted: true }
```

签名握手建立后，加密的内层请求才允许：

```ts
type InnerRequest =
  | { op: 'capabilities' }
  | ({ op: 'start'; publicKey: string; deviceUserCode?: true;
       authorizationV1?: true; secretSubmission?: true } & Action)
  | { op: 'status'; id: string }
  | { op: 'callback'; id: string; box: string }
  | { op: 'cancel'; id: string };
```

内层 capabilities 的 `version: 1` 是保留的事务版本，不是无签名外层协议。
`deviceUserCode`、`authorizationV1`、`secretSubmission` 必须经双方能力协商，缺失按不支持处理。
新 offer 不降级成旧 URL 或普通远程 setup。内层 offer/callback 继续加密；state、PKCE、URL
和回调不经模型或普通卡片事件。所有解析器拒绝未知字段、任意命令和明文 callback code。
通用 Renderer `device-link:invoke` 拒绝私有通道，普通远程 setup 写入限制保持有效。

授权目标由已批准的插件声明约束。设备授权只接受 HTTPS 默认端口；GitHub 精确匹配
`https://github.com/login/device` 且无 query/hash，TapTap Maker 精确匹配已审查路径及 code
参数。通用适配器按声明的 OAuth origin 或 network hosts 校验，并绑定 manifest 版本快照；
不能把 CLI 输出、插件文本或额外确认窗口当成信任来源。

原 Host OAuth loopback 仅监听 `127.0.0.1`；新 CLI 模式还支持上述 IPv6/localhost。
两者都校验 Host、路径、GET、唯一 state 与 code/error；CORS/PNA
限声明来源，不反射 provider 内容。不提供端口转发、任意 HTTP fetch 或凭据同步。

## 设备码的临时展示

GitHub 保留官方插件的 `gh-cli` 凭据源。Linux 镜像需包含固定 root-owned
`/usr/local/lib/cindy/github-device-login.py --device-login-v1` 与固定版本 GitHub CLI。
helper 使用私有 tmpfs HOME、DBus 和加密 Keyring；提交前重取 owner mutation lease，
复核配置与当前凭据，写入既有 Keyring；不回退明文。取消、任务结束、换账号、超时和
Host 退出会终止 helper 及所属子进程。新 `gh auth token` 读取确认提交后才宣告成功。

旧 device offer 保留 `AAAA-BBBB` 用户码；新 device 模式可包含 1–32 位字母、数字、空格或连字符，
保留上游大小写与格式，不作 GitHub 八位码转换。Main 解密后复制到本地剪贴板并打开已校验页面。
发起卡片可临时查询倒计时、再次复制或重开；不会为重开另建事务。接口为：

```ts
// plugin-oauth:device-code
{ deviceId, ghostId, requestId, actionId, operation: 'read' | 'copy' | 'reopen' }
// ready：{ phase: 'ready', userCode, verificationHost, expiresAt, copiedAt }
// 结束：仅 phase
```

Main 绑定原 owner、窗口、顶层 frame、peer 与卡片生命周期；Renderer 不提供 URL 或用户码。
用户码不广播、不镜像、不落聊天历史、不进模型或日志。结束/超时清理内存，且只有剪贴板仍
等于该码时才清除；过期须重新发起，不能复活已消费用户码。旧控制端无用户码能力时 GitHub
拒绝启动；没有独立用户码的设备授权和 loopback 不受该可选字段影响。

## API Key/PAT 的专用输入桥

仅普通 Host setup coordinator 的 user Secret 卡片声明 `remoteSecret:true`。Bot 的授权卡、
旧 Host 或只有 `remoteOauth:true` 的卡片不能借此输入。用户在原密码输入卡填写；值仅存在
组件和一次性 Main 调用中，提交/取消/换卡/卸载即清除，不进入 Renderer store 或聊天记录。

本机 `plugin-oauth:submit-secret` 接受设备、插件、卡片/action/revision、`value` 和用户看到的
`presentation`（插件名、标题、说明、intro、字段名/说明、长度上限）。Main 只接受自有可信
顶层 frame，独立从 CIS 取目标身份，验签握手后比较云 Host 的完整字段展示；不一致时不发值。
内层 offer 为 `{kind:'secret-entry',state,presentation}`，callback 为加密的
`{kind:'secret-value',state,value}`，只有明确协商 `secretSubmission:true` 才能发送。

源 Host 再核对原卡片/action/revision、owner/peer/期限，复用现有 `submitInline` 和
`executeGhostSetupInlineSubmission`。写入 key 仅从最新 assessment 的 `secret:` ref 与当前
user/显式 Node Secret 声明推导；请求不能自选路径或 storage key，OAuth/gh-cli/oidc-token
凭据不能从此写入。提交前再验当前事务，在同步 vault 写入成功后、change event 之前封存回执。
失败、取消、换账号、声明变化后的晚到结果不写入。

这是一条已显示字段的单次加密写入，不提供保险库读取、导出、批量同步或 token 回显。
两个专用本机 IPC 均不加入通用远控 allowlist；传输仍走原签名私有授权通道。API Key 的业务
可用性须由原插件后续调用验证，不能把“已保存”报告成“平台已授权”。

## 取消、重试和信任边界

- 事务为 starting → authorizing → exchanging → succeeded，任一步可 failed/cancelled。
  最长五分钟，Main 内存保存，重启后重新发起；每 Host 最多 16 个握手、每 peer 最多 4 个。
- 归属/代际、控制权限、卡片有效性在异步边界复验，包括交换后与凭据写入锁内；撤权、断链、
  换账号、取消或超时后的晚到结果不得写入新身份。
- callback 单次消费；相同 nonce 与密文重试复用结果，不重复交换；不同密文重用 nonce 拒绝。
  同卡片并发启动、错 peer/state、换账号均拒绝。
- 本机端口冲突时失败，不杀其它进程、不换注册地址、不索要用户将 code 粘进对话。
  取消阻止后续本地处理，不能保证撤销上游已经完成的 consent 或已签发 token。
- 两端 Main、CIS 的身份发布与 HTTPS 来源仍在可信基座内。独立身份查询与签名握手防止
  relay 替换目标公钥，但 relay 仍可拒绝服务、观察设备和时序元数据；不抵抗 Host、CIS 或
  集群管理员被攻陷。该桥不扩大原插件或实例的业务权限。
- provider/broker 仍按原契约处理 code/PKCE；两台机器的 IP、MFA、企业策略和重定向限制
  必须逐 provider 实测，单测或模拟 Auth 不能证明真实平台放行。

## 云端提示词与发布条件

`plugin-oauth/prompt.ts` 在 instance-runtime 已配置时由 Claude/Codex/Pi Host 追加固定段：
发现插件、按请求安装、发起现有卡片、等待真实状态、继续原任务。保留 system 原前缀，
不注入凭据或每轮随机状态，不改变批准策略；普通本机不追加。此段会影响云任务输入长度
与缓存，真实模型行为与 usage/延时需在发布验收单独记录。

双方 Host/Desktop 必须支持签名 v2；CIS 必须已提供归属校验后的新鲜公钥查询，发行包必须
包含正确 authority 文件，Linux 镜像须带适配器与安全 Keyring 运行环境。缺任一条件拒绝，
不回退账号级凭据、普通远程 setup 或再次 Cindy SSO。relay 仍只路由现有 invoke 信封，
不需解析 OAuth 载荷；插件包及生产 Auth/Model Access 无此桥的新接口需求。

## 验证口径

单测覆盖签名身份、过期/错目标/重放、真实本地 WebSocket 与 loopback、setup/卡片、
取消/换账号/提交边界、目标 URL 校验、设备码展示/复制/清理、Node 子进程回收和提示词注入。
通用模式测试包含真实本地 TCP 回调、不同设备码、CLI state/PKCE、provider 拒绝与取消；
输入桥测试从签名握手经过真实 coordinator/executor 到测试 vault，并验证展示篡改、串插件/
设备/action、过长值、迟到提交、失败与密文重放。provider 与存储替身不等于逐平台真实登录。
这类测试的 provider、relay 身份或 vault 可使用虚构 fixture，不能记作真实云端验收。

每次交付报告应另列源码基线、镜像/客户端产物、测试环境、真实 provider 结果与线上部署状态。
本次上游对齐不以历史版本验收代替新版本验收，也不自动部署云实例或升级用户数据。

## 受保护的实例连接表单

支持 `network.connections` 的插件通过原 `manage_connection:connection:<key>` setup action
接入，不要求插件新增 OAuth 或更改凭据格式。新版云 Host 的卡片投影声明
`remoteConnection:true`；新版 Desktop 显示地址和遮罩令牌输入，旧端保持不支持此动作。

专用本机 IPC `plugin-oauth:submit-connection` 不进入通用远控 allowlist。它沿签名 v2
握手明确协商 `connectionSubmission:true`，比较用户看到的完整 presentation
（ghostName/title/description/intro/connectionKey），再发送加密 callback：
`{kind:'connection-value',state,value:{host,token}}`。对应加密 offer 为
`{kind:'connection-entry',state,presentation}`。未协商的端拒绝，不转用 secret-entry 或
普通 remote setup；原 OAuth、设备码、API Key 契约不变。

地址仅接受一个 HTTPS 默认端口 DNS 主机，可填裸域名或根 URL；路径、查询、通配符、IP、
自定义端口、userinfo 与重定向输入不接受。控制端和云 Host 都校验，云 Host 从当前
assessment 的 connection ref 和当前 manifest 取连接声明，不能由调用者指定 vault key、
注入头或额外权限。发 offer 时冻结 manifest，提交时任何声明变化都拒绝。

用户在可信卡片中填写的精确地址构成本次连接目标。插件 iframe 不能调用此入口；其原有
设置页新增主机确认保留。云 Host 复用 GhostConnectionManager 的同步保存、条数限制和
失败补偿；owner/peer/card/revision/期限在写入前复验，成功回执先于 change event。
输入在提交、取消、换卡、换设备时清空，不落对话、镜像缓存、通知或日志。
此回执只证明连接配置保存，真实平台登录和权限必须随后用插件最小只读调用验收。

已保存连接可通过 `connect_account(..., reauthorize: true)` 再次配置；Host 重新展示当前
声明的连接卡，不因旧 Token 存在就报告本次完成，也不预先删除旧连接。只有该卡片、action
和 revision 对应的真实保存回执能完成重配，普通 change event、其他卡片或 Renderer 命令
不能伪造回执。同地址沿用原连接 ID 和默认选择，只替换提交的 Token；取消保留旧凭据。
Desktop 的保存按钮与取消按钮同处正文滚动区外；输入仍只留在原组件的临时内存。
