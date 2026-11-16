# 运行健康观测

`profile-supervisor.mjs` 安装为 `/usr/local/lib/cindy/profile-supervisor.mjs`，由 PID 1
包装脚本启动。它以 UID 10001 运行 Cindy，校验 Cindy 发出的遥测，测量沙箱后发布运行证据。
它导入的 `profile-runtime-wire.mjs` 由 `apps/desktop/src/main/instance-runtime/profile-runtime-wire.ts`
在同一次镜像构建中打包。两者须一起更新：只更新 ASAR 不会替换镜像里的 supervisor。

Cindy 退出时 supervisor 随之退出；Cindy 消失而 supervisor 仍在时由 `application-watch`
停止容器。见 [桌面运行时说明](runtime-desktop-xfce/README.md#runtime-composition)。

## 共享内存

云实例、维护和预检模式的 Electron 主进程都追加 `disable-dev-shm-usage`，supervisor 启动
Cindy 时也传入该参数。Chromium 共享图像改用现有临时卷中私有、已取消链接的文件，避免多个
软件渲染窗口耗尽容器默认 64 MiB 的 `/dev/shm` 后 renderer 退出。普通 Desktop 不受影响；
不改变内存配额、Keyring、PVC、seccomp、NoNewPrivs 或能力集。临时卷仍可能写满，应按实际
临时存储容量监测。

## 观测与证据

- 运行观测接受通过 CDP SystemInfo 发现的最多 64 个 renderer，逐个从 `/proc` 测量 PID、
  启动时间、Seccomp 与 filter 数、NoNewPrivs 和 capabilities，不截取部分进程。
- 预检最多 8 个 renderer，保证 Kubernetes 4 KiB termination message 有界。
- 运行证据上限 16 KiB，私有文件权限，并校验身份、代际和心跳。超过上限或任何一项测量失败，
  证据即被撤下。
- 失败输出固定的 `PROFILE_OBSERVATION_UNAVAILABLE` 事件及 stage/code，不含遥测内容、原始
  异常、URL 或凭据；同一连续故障只输出一次。启动和停止期间没有证据属于正常生命周期。

CIS 读取这份证据，必须接受最多 64 个 renderer。修改上限或证据字段时，先发布兼容的 CIS
读取端，再发布 runtime。不能用基本的 `status.ready` 代替完整的安全观测。

## 验收

单元测试中的 CDP 与 `/proc` 替身只证明边界。发布验收须在实际安全上下文中运行多 renderer、
反复打开关闭菜单和共享内存压力，并确认凭据续期后 CIS 能实际读取证据。
