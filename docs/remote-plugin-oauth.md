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
5. Device Flow 使用已审查的 Host/CLI 适配器；本机打开经校验的 provider 页面，云端继续
   等待或轮询。GitHub 用户码仅在本机卡片临时显示、可重复复制和重开页面。
6. 凭据提交与 readiness 复验成功才完成卡片并继续原请求；浏览器打开或回调到达都不算登录成功。

Host 管理的 `network.secrets[].source=oauth` 沿用插件现有 scopes、PKCE、clientId、
broker 资格、账号合并和刷新机制，不要求改插件。支持原有直接 loopback 和公网 HTTPS
bounce；bounce 保留注册地址用于 authorize/exchange，只将最终回调送回控制端。

GitHub `gh-cli`、TapTap Maker 的设备授权通过专用适配器接入。不能从任意插件报错可靠推断
授权，也不提供任意 Node/CLI 命令的授权代理。API Key/Secret 输入、网站 Cookie、账号保险库、
外部 MCP 自管 OAuth 不因此获得通用同步能力。SSH 工作区也不获得本机凭据。
Mobile 可展示或取消现有卡片，没有 Desktop loopback 接口；需在连接该云实例的 Desktop 完成。

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
{ deviceId: string, requestId: string, actionId: string, expectedRevision: number }
// 成功响应：{ accepted: true }
```

签名握手建立后，加密的内层请求才允许：

```ts
type InnerRequest =
  | { op: 'capabilities' }
  | ({ op: 'start'; publicKey: string; deviceUserCode?: true } & Action)
  | { op: 'status'; id: string }
  | { op: 'callback'; id: string; box: string }
  | { op: 'cancel'; id: string };
```

内层 capabilities 的 `version: 1` 是保留的事务版本，不是无签名外层协议。
`deviceUserCode: true` 必须经双方能力协商。内层 offer/callback 继续加密；state、PKCE、URL
和回调不经模型或普通卡片事件。所有解析器拒绝未知字段、任意命令和明文 callback code。
通用 Renderer `device-link:invoke` 拒绝私有通道，普通远程 setup 写入限制保持有效。

授权目标由已批准的插件声明约束。设备授权只接受 HTTPS 默认端口；GitHub 精确匹配
`https://github.com/login/device` 且无 query/hash，TapTap Maker 精确匹配已审查路径及 code
参数。通用适配器按声明的 OAuth origin 或 network hosts 校验，并绑定 manifest 版本快照；
不能把 CLI 输出、插件文本或额外确认窗口当成信任来源。

loopback 仅监听 `127.0.0.1`，校验 Host、路径、GET、唯一 state 与 code/error；CORS/PNA
限声明来源，不反射 provider 内容。不提供端口转发、任意 HTTP fetch 或凭据同步。

## 设备码的临时展示

GitHub 保留官方插件的 `gh-cli` 凭据源。Linux 镜像需包含固定 root-owned
`/usr/local/lib/cindy/github-device-login.py --device-login-v1` 与固定版本 GitHub CLI。
helper 使用私有 tmpfs HOME、DBus 和加密 Keyring；提交前重取 owner mutation lease，
复核配置与当前凭据，写入既有 Keyring；不回退明文。取消、任务结束、换账号、超时和
Host 退出会终止 helper 及所属子进程。新 `gh auth token` 读取确认提交后才宣告成功。

加密 device offer 可包含 `AAAA-BBBB` 用户码。Main 解密后复制到本地剪贴板并打开已校验页面。
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
这类测试的 provider、relay 身份或 vault 可使用虚构 fixture，不能记作真实云端验收。

每次交付报告应另列源码基线、镜像/客户端产物、测试环境、真实 provider 结果与线上部署状态。
本次上游对齐不以历史版本验收代替新版本验收，也不自动部署云实例或升级用户数据。
