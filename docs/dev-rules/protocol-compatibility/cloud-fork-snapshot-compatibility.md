# Cloud fork snapshot compatibility

> 通用规则与 Review 清单见[跨端协议兼容](../protocol-compatibility.md)；本文件只记录这一项能力的协议约定。

The cloud fork keeps the deployed CIS v2 snapshot field IDs and collection enums
unchanged. The v0.1.120 task-history and region-screenshot shortcuts are
classified for local settings only; they are not added to the frozen CIS report. Local speaker filtering is classified as a local-only setting; it is
not added to the negotiated snapshot. Removed desktop restoration controls are
not offered for editing. Plugin model selection uses the upstream task model
preferences through the existing pluginErrand routes; the pluginCindy route only
edits concurrency. Attempts to set or clear retired per-capability model pins
return UNSUPPORTED_CAPABILITY and leave stored preferences intact. Existing
oneshot preferences remain available for the upstream migration. No CIS deployment
or remote authentication change is required for these adaptations.

The Host-owned new-task history and model favorites retain upstream's three speed
values (`false`, `true`, `ultrafast`); account boundaries, CAS and one-time legacy
imports remain authoritative. DeviceLink uses the upstream speed-aware protocol.
The deployed CIS v1/v2 read-only boolean `fast`/`fastMode` fields continue to mean
“Fast enabled”: both enabled tiers project to `true`, without rewriting the local
value. The legacy cloud favorites editor preserves an existing ultrafast tier
when its enabled switch is returned unchanged; it cannot select that tier itself.
Remote existing-task model changes carry `taskProviderId` through the Host writer:
a different or unresolved default source cannot be replaced by the task's source.
