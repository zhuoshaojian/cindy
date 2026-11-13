# 云实例配置指引

本目录归客户端云镜像构建维护，不属于普通客户端默认行为。`settings.md` 是云专属正文；
`overlay.mjs` 只在云镜像打包时作为 Vite 插件加入 Desktop main 入口。
普通客户端构建不引用此目录，也不需要新增上游源文件、环境变量或远程协议。

在现有 `appendCloudPluginOauthPrompt` 之后追加同一静态段，覆盖 Claude、Codex、Pi；
仍以 `getInstanceConfig() !== null` 判断云实例。既有前缀逐字节保留，非云实例不追加。
插件检查三个实际装配点，缺失、重复或源码接线变化即停止构建，禁止悄悄遗漏一个引擎。
构建仅在内存转换源码，不回写客户端工作区；构建记录须包含指引摘要及客户端构建前后摘要。

用法：云镜像构建器显式导入 `cloudSettingsGuidancePlugin`，以绝对 `sourceRoot` 指定
客户端源码目录，**仅对 main 入口**添加插件；不要对 preload、renderer 或远程 manager 添加。
这不是自动部署入口。上线仍使用单实例镜像许可与现有 operator 流程，保存原镜像可回滚。
操作记录、真实实例身份、构建产物、凭证和线上验收报告继续在仓库外私有归档。

取消、冲突和未知回执的说明只约束模型解释，不提供写权限或代替确认。
v3 wire 与设置 writer 仍由原模块维护；Agent 使用上游 `cindy_helper` 的 `settings` 工具。
测试必须分别证明构建接线、非云不变，以及真实模型的取消/冲突解释；静态文本检查不能代替线上 E2E。

接线回归命令（读取真实客户端 getter，执行转换后正文；不会启动客户端或修改源码）：

```sh
CINDY_TEST_CLIENT_SOURCE=/absolute/path/to/client node --test deploy/linux-desktop/runtime-guidance/overlay.test.mjs
```

## 对话结果解释

早期云打包对 fork 自有的 `host-settings/helper.ts` 加过结果包装器（`result-guidance.mjs`）。Agent 改用上游设置工具后，
该工具与包装器一并撤回；静态指引只说明上游工具的返回含义，不改写工具结果，也不提供写权限。

```sh
CINDY_TEST_CLIENT_SOURCE=/absolute/path/to/client node --test deploy/linux-desktop/runtime-guidance/*.test.mjs
```
