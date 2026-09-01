import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { Text, TextInput } from '@/components/AppText';
import { MainWindowActionGroup, ScreenHeader, StatusDot } from '@/components/MobilePrimitives';
import { useAuth } from '@/auth/AuthContext';
import { DEVICE_LINK_API_BASE_URL } from '@/config/env';
import { useDeviceLink } from '@/device-link/DeviceLinkContext';
import { resolveMobileDeviceDisplayName } from '@/device-link/devicePresentation';
import { devicePlatformLabel } from '@/device-link/deviceManagement';
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
  cpuLabel?: string;
  memoryGb?: number;
  modelLabel?: string;
  platform?: string;
}

/** Account device management surface for ordinary remote devices. */
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

  useEffect(() => {
    setDeviceName(displayName);
    setRenameDraft(displayName);
  }, [displayName]);

  useEffect(() => {
    if (lastPresenceSnapshot?.deviceId === props.deviceId) setOnline(lastPresenceSnapshot.online);
  }, [lastPresenceSnapshot, props.deviceId]);

  const metadata = useMemo(() => [
    devicePlatformLabel(props.platform),
    props.modelLabel?.trim() || null,
    props.cpuLabel?.trim() || null,
    typeof props.memoryGb === 'number' ? t('devices.management.memory', { count: props.memoryGb }) : null,
    online ? t('devices.management.online') : t('devices.management.offline'),
  ].filter((value): value is string => Boolean(value)).join(' · '),
  [online, props.cpuLabel, props.memoryGb, props.modelLabel, props.platform, t]);

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
        { baseUrl: DEVICE_LINK_API_BASE_URL, body: { name }, method: 'PATCH', timeoutMs: DEVICE_LIST_TIMEOUT_MS },
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
        <View style={styles.card} testID="deviceManagement.renameSection">
          <Text style={styles.sectionTitle}>{t('devices.management.rename')}</Text>
          <Text style={styles.sectionDescription}>{t('devices.management.renameHint')}</Text>
          {renameEditing ? (
            <>
              <TextInput autoFocus editable={!renameSaving} maxLength={64} onChangeText={setRenameDraft} onSubmitEditing={() => void saveRename()} placeholder={t('devices.list.renameDevice.placeholder')} placeholderTextColor={colors.textTertiary} returnKeyType="done" selectTextOnFocus style={styles.input} testID="deviceManagement.renameInput" value={renameDraft} />
              <MainWindowActionGroup
                cancelAction={{ disabled: renameSaving, label: t('devices.common.cancel'), onPress: () => { setRenameDraft(deviceName); setRenameEditing(false); }, testID: 'deviceManagement.renameCancel' }}
                primaryActions={[{ busy: renameSaving, disabled: !renameDraft.trim(), label: renameSaving ? t('devices.common.saving') : t('devices.common.save'), onPress: () => void saveRename(), testID: 'deviceManagement.renameSave', tone: 'primary' }]}
                testID="deviceManagement.renameActions"
              />
            </>
          ) : (
            <MainWindowActionGroup primaryActions={[{ label: t('devices.list.renameDevice.title'), onPress: () => setRenameEditing(true), testID: 'deviceManagement.renameStart' }]} />
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  safeArea: { backgroundColor: colors.surface, flex: 1 },
  content: { gap: spacing.md, paddingBottom: spacing.xxl, paddingHorizontal: spacing.lg },
  card: { backgroundColor: colors.surfaceElevated, borderColor: colors.border, borderRadius: radius.container, borderWidth: StyleSheet.hairlineWidth, gap: spacing.md, padding: spacing.lg },
  summaryHeader: { alignItems: 'center', flexDirection: 'row', gap: spacing.md },
  summaryText: { flex: 1, gap: spacing.xs, minWidth: 0 },
  deviceName: { color: colors.textPrimary, fontSize: typeScale.subtitle, fontWeight: fontWeight.medium, lineHeight: lineHeight.subtitle },
  metadata: { color: colors.textTertiary, fontSize: typeScale.caption, lineHeight: lineHeight.caption },
  sectionTitle: { color: colors.textPrimary, fontSize: typeScale.body, fontWeight: fontWeight.medium, lineHeight: lineHeight.body },
  sectionDescription: { color: colors.textSecondary, flex: 1, fontSize: typeScale.caption, lineHeight: lineHeight.caption },
  input: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.control, borderWidth: StyleSheet.hairlineWidth, color: colors.textPrimary, fontSize: typeScale.body, minHeight: 44, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
});
