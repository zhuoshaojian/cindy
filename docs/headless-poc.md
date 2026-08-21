# Headless 启动 PoC（T2）

当前 PoC 只验证 macOS 原生 dev 进程的无窗启动：主进程不创建 BrowserWindow，
但会完成 agent 二进制准备、Maker 构造和 main IPC 注册。Linux/Docker、keyring 和
relay 登录验证不属于本阶段。

## 本地查看（human-only）

前置条件：

- 已在仓库根目录执行过 `pnpm install`，并初始化协议/内置插件 submodule：
  `git submodule update --init`。
- 至少在 GUI 模式完成过一次 Cindy 登录，使 macOS Keychain/safeStorage 中已有
  可复用的登录态；本阶段不会验证 relay 或手机对话。

在自己的交互式终端中运行以下 human-only 命令（agent 不代跑 Electron）：

```bash
pnpm dev:desktop:headless:remote
```

该入口会复用与 `dev:desktop:remote` 相同的 remote endpoint/region 注入链
（`scripts/dev-remote-env.mjs`），并向 Electron 透传 `--headless`。启动成功时
不会出现 Cindy 窗口或 splash；进程会继续
驻留等待后续 headless 能力接入。

日志写入 `apps/desktop/logs/main-<YYYY-MM-DD>.log`，可按当天日期查看以下关键行：

```text
[headless-startup] headless startup entered
[headless-startup] headless agent binaries ready
[headless-startup] headless Maker ready
```

看到上面三行依次出现即可确认「无窗主进程自我拉起 Maker」成功。第一行
`headless mode enabled; window creation will be skipped` 也会在启动早期出现，
用于确认 flag 已命中。若二进制准备或 Maker 就绪失败，会记录同一 scope 下的
`ERROR` 行并以退出码 `1` 结束；此时优先检查该日志中的错误上下文。

本阶段只验证「无窗 + Maker 就绪」；relay 连接、设备配对与手机对话属于后续
T3/T4。
