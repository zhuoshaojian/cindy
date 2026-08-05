import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { parseCloudInstanceImageTag } from '@cindy/maker-shared/cloud-instance';

import { Text, TextInput } from '@/components/AppText';
import {
  InfoPill,
  MainWindowActionGroup,
  ScreenHeader,
  StatusDot,
} from '@/components/MobilePrimitives';
import { useAuth } from '@/auth/AuthContext';
import { useCloudInstances } from '@/cloud-instance/useCloudInstances';
import { CLOUD_WAKE_WATCH_TIMEOUT_MS } from '@/cloud-instance/cloudInstanceWake';
import { DEVICE_LINK_API_BASE_URL } from '@/config/env';
import { useDeviceLink } from '@/device-link/DeviceLinkContext';
import { resolveMobileDeviceDisplayName } from '@/device-link/devicePresentation';
import {
  cloudInstanceDetailActionState,
  devicePlatformLabel,
} from '@/device-link/deviceManagement';
import { formatRemoteError } from '@/device-link/remoteStatus';
import { remoteSessionStore } from '@/session/remoteSessionStore';
import { goBackGuarded } from '@/utils/backGuard';
import { useTheme, useThemedStyles, type ThemeColors } from '@/theme';
import { fontWeight, lineHeight, radius, spacing, typeScale } from '@/theme/tokens';

const DEVICE_LIST_TIMEOUT_MS = 12_000;

export interface DeviceManagementScreenProps {
  deviceId: string;
  name: string;
  online: boolean;
  cloudInstanceId?: string;
  cpuLabel?: string;
  image?: string;
  kind?: string;
  latestReleaseTag?: string;
  lastFailedUpgradeImage?: string;
  memoryGb?: number;
  modelLabel?: string;
  platform?: string;
  updateAvailable?: boolean;
  upgradeState?: 'idle' | 'rolled-back' | 'verifying';
}

/** Account device management surface hosted by the dedicated management route. */
export function DeviceManagementScreen(props: DeviceManagementScreenProps) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const router = useRouter();
  const { t } = useTranslation();
  const { apiFetch } = useAuth();
  const { lastPresenceSnapshot } = useDeviceLink();
  const displayName = resolveMobileDeviceDisplayName(props.name);
  const [deviceName, setDeviceName] = useState(displayName);
  const [renameDraft, setRenameDraft] = useState(displayName);
  const [renameEditing, setRenameEditing] = useState(false);
  const [renameSaving, setRenameSaving] = useState(false);
  const [online, setOnline] = useState(props.online);
  const isCloud = props.kind === 'cloud' || Boolean(props.cloudInstanceId);

  useEffect(() => {
    setDeviceName(displayName);
    setRenameDraft(displayName);
  }, [displayName]);

  useEffect(() => {
    if (lastPresenceSnapshot?.deviceId === props.deviceId) {
      setOnline(lastPresenceSnapshot.online);
    }
  }, [lastPresenceSnapshot, props.deviceId]);
  const metadata = useMemo(() => {
    const values = [
      devicePlatformLabel(props.platform),
      props.modelLabel?.trim() || null,
      props.cpuLabel?.trim() || null,
      typeof props.memoryGb === 'number'
        ? t('devices.management.memory', { count: props.memoryGb })
        : null,
      online ? t('devices.management.online') : t('devices.management.offline'),
    ];
    return values.filter((value): value is string => Boolean(value)).join(' · ');
  }, [online, props.cpuLabel, props.memoryGb, props.modelLabel, props.platform, t]);

  const saveRename = useCallback(async () => {
    const name = renameDraft.trim();
    if (!name || renameSaving) return;
    if (name === deviceName.trim()) {
      setRenameEditing(false);
      return;
    }
    setRenameSaving(true);
    try {
      const result = await apiFetch<{ deviceId: string; name: string }>(
        `/api/device-link/devices/${encodeURIComponent(props.deviceId)}`,
        {
          baseUrl: DEVICE_LINK_API_BASE_URL,
          body: { name },
          method: 'PATCH',
          timeoutMs: DEVICE_LIST_TIMEOUT_MS,
        },
      );
      setDeviceName(result.name);
      setRenameDraft(result.name);
      setRenameEditing(false);
      remoteSessionStore.renameDevice(props.deviceId, result.name);
      Alert.alert(t('devices.management.renameSaved'));
    } catch (error) {
      Alert.alert(t('devices.list.alert.renameFailed'), formatRemoteError(error));
    } finally {
      setRenameSaving(false);
    }
  }, [apiFetch, deviceName, props.deviceId, renameDraft, renameSaving, t]);

  return (
    <SafeAreaView style={styles.safeArea} testID="deviceManagement.screen">
      <ScreenHeader
        backTestID="deviceManagement.backButton"
        eyebrow={t('devices.management.eyebrow')}
        onBack={() => goBackGuarded(router)}
        title={deviceName}
        titleTestID="deviceManagement.title"
      />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.card} testID="deviceManagement.summary">
          <View style={styles.summaryHeader}>
            <StatusDot tone={online ? 'ready' : 'off'} />
            <View style={styles.summaryText}>
              <Text style={styles.deviceName}>{deviceName}</Text>
              <Text style={styles.metadata}>{metadata || t('devices.management.unknown')}</Text>
            </View>
          </View>
        </View>

        {isCloud ? (
          <CloudInstanceManagement
            {...props}
            initialInstanceId={props.cloudInstanceId}
            online={online}
            onOnlineOverride={setOnline}
            onDeleted={() => goBackGuarded(router)}
          />
        ) : (
          <View style={styles.card} testID="deviceManagement.renameSection">
            <Text style={styles.sectionTitle}>{t('devices.management.rename')}</Text>
            <Text style={styles.sectionDescription}>{t('devices.management.renameHint')}</Text>
            {renameEditing ? (
              <>
                <TextInput
                  autoFocus
                  editable={!renameSaving}
                  maxLength={64}
                  onChangeText={setRenameDraft}
                  onSubmitEditing={() => void saveRename()}
                  placeholder={t('devices.list.renameDevice.placeholder')}
                  placeholderTextColor={colors.textTertiary}
                  returnKeyType="done"
                  selectTextOnFocus
                  style={styles.input}
                  testID="deviceManagement.renameInput"
                  value={renameDraft}
                />
                <MainWindowActionGroup
                  cancelAction={{
                    disabled: renameSaving,
                    label: t('devices.common.cancel'),
                    onPress: () => {
                      setRenameDraft(deviceName);
                      setRenameEditing(false);
                    },
                    testID: 'deviceManagement.renameCancel',
                  }}
                  primaryActions={[{
                    busy: renameSaving,
                    disabled: !renameDraft.trim(),
                    label: renameSaving ? t('devices.common.saving') : t('devices.common.save'),
                    onPress: () => void saveRename(),
                    testID: 'deviceManagement.renameSave',
                    tone: 'primary',
                  }]}
                  testID="deviceManagement.renameActions"
                />
              </>
            ) : (
              <MainWindowActionGroup
                primaryActions={[{
                  label: t('devices.list.renameDevice.title'),
                  onPress: () => setRenameEditing(true),
                  testID: 'deviceManagement.renameStart',
                }]}
              />
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function CloudInstanceManagement({
  deviceId,
  image: fallbackImage,
  initialInstanceId,
  latestReleaseTag: fallbackLatestReleaseTag,
  lastFailedUpgradeImage: fallbackLastFailedUpgradeImage,
  onDeleted,
  online,
  onOnlineOverride,
  updateAvailable: fallbackUpdateAvailable = false,
  upgradeState: fallbackUpgradeState = 'idle',
}: DeviceManagementScreenProps & {
  initialInstanceId?: string;
  onDeleted(): void;
  onOnlineOverride(value: boolean): void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation();
  const { apiFetch } = useAuth();
  const cloud = useCloudInstances(apiFetch);
  const refreshCloudInstances = cloud.refresh;
  const instance = cloud.instances.find((item) => item.instanceId === initialInstanceId)
    ?? cloud.instances.find((item) => item.deviceId === deviceId);
  const instanceId = instance?.instanceId ?? initialInstanceId ?? null;
  const status = instance?.status;
  const currentVersion = parseCloudInstanceImageTag(status?.image ?? fallbackImage);
  const updateAvailable = status?.updateAvailable ?? fallbackUpdateAvailable;
  const latestReleaseTag = instance
    ? status?.latestReleaseTag ?? null
    : fallbackLatestReleaseTag ?? null;
  const upgradeState = status?.upgrade.state ?? fallbackUpgradeState;
  const failedUpgradeImage = instance
    ? status?.lastFailedUpgradeImage
      ?? (upgradeState === 'rolled-back' ? status?.upgrade.targetImage ?? null : null)
    : fallbackLastFailedUpgradeImage ?? null;
  const [wakeWatching, setWakeWatching] = useState(false);

  useFocusEffect(useCallback(() => {
    void refreshCloudInstances();
  }, [refreshCloudInstances]));

  useEffect(() => {
    if (!wakeWatching || online) {
      if (online) setWakeWatching(false);
      return undefined;
    }
    const timer = setTimeout(() => setWakeWatching(false), CLOUD_WAKE_WATCH_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [online, wakeWatching]);

  const actionState = cloudInstanceDetailActionState({
    instanceId: instanceId ?? `unresolved:${deviceId}`,
    online,
    pending: cloud.pending,
    updateAvailable,
    upgradeState,
    wakeWatching,
  });
  const recordUnavailable = cloud.loadState !== 'ready' || !instance || instanceId === null;

  const runWake = useCallback(async () => {
    if (!instanceId) return;
    const result = await cloud.wake(instanceId);
    if (!result) return;
    setWakeWatching(true);
    Alert.alert(t('deviceLink.cloudInstance.woke'));
  }, [cloud, instanceId, t]);

  const runStop = useCallback(async () => {
    if (!instanceId) return;
    const result = await cloud.stopInstance(instanceId);
    if (!result) return;
    onOnlineOverride(false);
    Alert.alert(t('deviceLink.cloudInstance.stopped'));
  }, [cloud, instanceId, onOnlineOverride, t]);

  const confirmUpgrade = useCallback(() => {
    if (!instanceId) return;
    Alert.alert(
      t('deviceLink.cloudInstance.updateConfirmTitle'),
      t('deviceLink.cloudInstance.updateConfirmDescription'),
      [
        { style: 'cancel', text: t('devices.common.cancel') },
        {
          onPress: () => {
            void cloud.upgradeInstance(instanceId).then((result) => {
              if (result) Alert.alert(t('deviceLink.cloudInstance.updateStarted'));
            });
          },
          text: t('deviceLink.cloudInstance.updateConfirm'),
        },
      ],
    );
  }, [cloud, instanceId, t]);

  const confirmDelete = useCallback(() => {
    if (!instanceId) return;
    Alert.alert(
      t('deviceLink.cloudInstance.deleteConfirmTitle'),
      t('deviceLink.cloudInstance.deleteConfirmDescription'),
      [
        { style: 'cancel', text: t('devices.common.cancel') },
        {
          onPress: () => {
            void cloud.deleteInstance(instanceId).then((result) => {
              if (!result) return;
              Alert.alert(t('deviceLink.cloudInstance.deleted'));
              onDeleted();
            });
          },
          style: 'destructive',
          text: t('deviceLink.cloudInstance.deleteConfirm'),
        },
      ],
    );
  }, [cloud, instanceId, onDeleted, t]);

  const lifecycleLabel = actionState.lifecycleBusy
    ? actionState.lifecycleAction === 'wake'
      ? t('deviceLink.cloudInstance.waking')
      : t('deviceLink.cloudInstance.stopping')
    : actionState.lifecycleAction === 'wake'
      ? t('deviceLink.cloudInstance.wake')
      : t('deviceLink.cloudInstance.stop');

  return (
    <>
      <View style={styles.card} testID="deviceManagement.cloudUpdateSection">
        <Text style={styles.sectionTitle}>{t('deviceLink.cloudInstance.updateSectionTitle')}</Text>
        {currentVersion && (updateAvailable || actionState.updateBusy) ? (
          <Text style={styles.sectionDescription} testID="deviceManagement.cloudCurrentVersion">
            {t('deviceLink.cloudInstance.currentVersion', { version: currentVersion })}
          </Text>
        ) : null}
        <View style={styles.updateStatusRow}>
          <Text style={styles.sectionDescription}>
            {actionState.updateBusy
              ? t('deviceLink.cloudInstance.updating')
              : updateAvailable
                ? latestReleaseTag
                  ? t('deviceLink.cloudInstance.updateAvailableTag', { tag: latestReleaseTag })
                  : t('deviceLink.cloudInstance.updateAvailable')
                : currentVersion
                  ? t('deviceLink.cloudInstance.currentVersionUpToDate', { version: currentVersion })
                  : t('deviceLink.cloudInstance.upToDate')}
          </Text>
          {updateAvailable && !actionState.updateBusy ? (
            <InfoPill label={t('deviceLink.cloudInstance.updateAvailable')} />
          ) : null}
        </View>
        {failedUpgradeImage ? (
          <Text style={styles.warningText} testID="deviceManagement.cloudRollbackWarning">
            {t('deviceLink.cloudInstance.updateRolledBack')}
          </Text>
        ) : null}
        {(updateAvailable || actionState.updateBusy) ? (
          <MainWindowActionGroup
            primaryActions={[{
              busy: actionState.updateBusy,
              disabled: actionState.updateDisabled || recordUnavailable,
              label: actionState.updateBusy
                ? t('deviceLink.cloudInstance.updating')
                : t('deviceLink.cloudInstance.update'),
              onPress: confirmUpgrade,
              testID: 'deviceManagement.cloudUpdate',
              tone: 'primary',
            }]}
          />
        ) : null}
      </View>

      <View style={styles.card} testID="deviceManagement.cloudActionsSection">
        <Text style={styles.sectionTitle}>{t('devices.management.actions')}</Text>
        <MainWindowActionGroup
          primaryActions={[{
            busy: actionState.lifecycleBusy,
            disabled: actionState.lifecycleDisabled || recordUnavailable,
            label: lifecycleLabel,
            onPress: actionState.lifecycleAction === 'wake' ? () => void runWake() : () => void runStop(),
            testID: `deviceManagement.cloud${actionState.lifecycleAction === 'wake' ? 'Wake' : 'Stop'}`,
          }]}
        />
      </View>

      <View style={styles.card} testID="deviceManagement.cloudDeleteSection">
        <Text style={styles.sectionTitle}>{t('devices.management.dangerZone')}</Text>
        <Text style={styles.sectionDescription}>
          {t('deviceLink.cloudInstance.deleteConfirmDescription')}
        </Text>
        <MainWindowActionGroup
          dangerActions={[{
            busy: cloud.pending?.target === instanceId && cloud.pending.action === 'delete',
            disabled: actionState.deleteDisabled || recordUnavailable,
            label: cloud.pending?.target === instanceId && cloud.pending.action === 'delete'
              ? t('deviceLink.cloudInstance.deleting')
              : t('deviceLink.cloudInstance.delete'),
            onPress: confirmDelete,
            testID: 'deviceManagement.cloudDelete',
            tone: 'danger',
          }]}
        />
      </View>
    </>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  safeArea: {
    backgroundColor: colors.surface,
    flex: 1,
  },
  content: {
    gap: spacing.md,
    paddingBottom: spacing.xxl,
    paddingHorizontal: spacing.lg,
  },
  card: {
    backgroundColor: colors.surfaceElevated,
    borderColor: colors.border,
    borderRadius: radius.container,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing.md,
    padding: spacing.lg,
  },
  summaryHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  summaryText: {
    flex: 1,
    gap: spacing.xs,
    minWidth: 0,
  },
  deviceName: {
    color: colors.textPrimary,
    fontSize: typeScale.subtitle,
    fontWeight: fontWeight.medium,
    lineHeight: lineHeight.subtitle,
  },
  metadata: {
    color: colors.textTertiary,
    fontSize: typeScale.caption,
    lineHeight: lineHeight.caption,
  },
  sectionTitle: {
    color: colors.textPrimary,
    fontSize: typeScale.body,
    fontWeight: fontWeight.medium,
    lineHeight: lineHeight.body,
  },
  sectionDescription: {
    color: colors.textSecondary,
    flex: 1,
    fontSize: typeScale.caption,
    lineHeight: lineHeight.caption,
  },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.control,
    borderWidth: StyleSheet.hairlineWidth,
    color: colors.textPrimary,
    fontSize: typeScale.body,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  updateStatusRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  warningText: {
    color: colors.statusAccent,
    fontSize: typeScale.caption,
    lineHeight: lineHeight.caption,
  },
});
