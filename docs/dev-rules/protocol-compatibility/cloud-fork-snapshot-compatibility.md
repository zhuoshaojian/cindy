# Cloud fork snapshot compatibility

> 通用规则与 Review 清单见[跨端协议兼容](../protocol-compatibility.md)；本文件只记录这一项能力的协议约定。
> Snapshot contract: [云实例设置快照](../../cloud-settings-snapshot.md).

The CIS v2 snapshot field IDs (`shared/settingsSnapshotV2FieldIds.ts`) and collection enums are frozen.
Settings that upstream adds later, such as the task-history and region-screenshot shortcuts, iMessage IM
defaults and the three-mode Git setting, are read locally but not added to the report. Speaker filtering
is a local-only item. Uploading a new field requires a separately negotiated snapshot version.

Plugin model selection uses upstream's task model preferences through the existing `pluginErrand`
routes; the `pluginCindy` route edits only concurrency (`inflightLimits`). Setting or clearing a retired
per-capability model pin returns `UNSUPPORTED_CAPABILITY` and leaves stored preferences intact.
Existing oneshot preferences remain available for upstream's migration. The retired global teammate
model chain (`botModelChain`) reads as `unavailable` and rejects writes the same way.

Model favorites and new-task history keep upstream's three speed values (`false`, `true`, `ultrafast`).
The v1/v2 read-only boolean `fast` / `fastMode` fields mean "Fast enabled": both enabled tiers project
to `true` without rewriting the stored value. The cloud favorites editor keeps an existing `ultrafast`
favorite when its switch comes back unchanged; it cannot select that tier itself. DeviceLink uses
upstream's speed-aware protocol. Remote existing-task model changes carry `taskProviderId` through the
Host writer: a different or unresolved default source is not replaced by the task's source.
