# 云实例设置指引

云镜像打包覆盖层，普通客户端构建不引用此目录。`settings.md` 是追加到 Agent 系统提示的
云专属正文（运行时内容）；`overlay.mjs` 负责接线。

## 接线

在 `maker-host/runtime-configs.ts`（Claude、Codex）与 `maker-host/pi-host.ts`（Pi）中，
于现有 `appendCloudPluginOauthPrompt(...)` 之后追加同一段静态正文。仍以
`getInstanceConfig() !== null` 判断云实例：既有前缀逐字节保留，非云实例不追加。
三个装配点任一缺失、重复或源码接线变化都会使构建失败，不允许悄悄遗漏某个引擎。

`stage-cloud-overlays.mjs` 在打包前对构建用的源码导出应用转换，并用
`cloudSettingsGuidancePlugin({ sourceRoot })` 生成虚拟模块
`virtual:cindy-cloud-settings-guidance`。改写前后的文件摘要记录在 `overlay-application.json`。
不新增上游源文件、环境变量或远程协议。

## 范围

正文只约束模型如何使用和解释上游 `cindy_helper` 的 `settings` 工具结果，不改写工具结果、
不提供写权限，也不代替用户确认。设置协议与 writer 不受此目录影响。

## 测试

读取真实客户端 getter 并执行转换后的正文，不启动客户端，不修改源码：

```sh
CINDY_TEST_CLIENT_SOURCE=/absolute/path/to/client node --test deploy/linux-desktop/runtime-guidance/overlay.test.mjs
```

测试证明构建接线与非云不变；正文对真实模型行为的效果须另行验证，静态文本检查不能代替。
