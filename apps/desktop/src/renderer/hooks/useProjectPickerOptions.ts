import { useMemo } from 'react';

import type { FolderPickerOption } from '@/components/new-chat/FolderPickerPopover';
import { extractDisplayName } from '@/features/cc-agent/lib/projectGrouping';
import { useRecentWorkdirs } from '@/hooks/useRecentWorkdirs';
import type { Session } from '@/lib/ccAgent.types';

export type ProjectPickerEmptyLabelMode = 'generic' | 'dialogue';

function toPosixPath(p: string): string {
  return p.replace(/\\/g, '/');
}

/**
 * Shared project picker source for creation surfaces.
 *
 * The persistent recent_workdirs table is independent of live sessions, so a
 * project remains selectable after all sessions under it are archived/deleted.
 */
export function useProjectPickerOptions(): FolderPickerOption[] {
  const { entries } = useRecentWorkdirs();

  return useMemo<FolderPickerOption[]>(() => {
    const posixAll = entries.map((entry) => toPosixPath(entry.path));
    return entries.map((entry, idx) => {
      const posix = posixAll[idx];
      const { name } = extractDisplayName(posix, posixAll);
      return {
        path: entry.path,
        name,
        description: posix,
        missing: entry.exists === false,
      };
    });
  }, [entries]);
}

/**
 * 从某台 device-link 设备的镜像会话反推最近项目。
 *
 * 与手机 buildRecentWorkspaceOptions 同口径：只看未删除的 project 会话、按目录去重，
 * 以最近活动时间倒序；控制端不把远端目录写进本机 recent_workdirs。
 */
export function buildRemoteProjectPickerOptions(
  sessions: readonly Session[],
  deviceId: string,
  limit = 6,
): FolderPickerOption[] {
  const latestByPath = new Map<string, string>();
  for (const session of sessions) {
    if (session.deviceLinkDeviceId !== deviceId) continue;
    if (session.status === 'deleted' || session.workspaceKind !== 'project') continue;
    const path = session.workingDir?.trim();
    if (!path) continue;
    const activityAt = session.userSendAt ?? session.updatedAt ?? session.createdAt ?? '';
    const current = latestByPath.get(path);
    if (current == null || activityAt.localeCompare(current) > 0) {
      latestByPath.set(path, activityAt);
    }
  }

  const paths = [...latestByPath.keys()];
  return paths
    .sort(
      (a, b) =>
        (latestByPath.get(b) ?? '').localeCompare(latestByPath.get(a) ?? '') ||
        a.localeCompare(b),
    )
    .slice(0, Math.max(0, limit))
    .map((path) => {
      const posix = toPosixPath(path);
      const { name } = extractDisplayName(posix, paths.map(toPosixPath));
      return { path, name, description: posix };
    });
}

export function getProjectPickerDisplayName(
  cwd: string | null | undefined,
  projectOptions: readonly FolderPickerOption[] | undefined,
  deviceLinkDeviceId?: string | null,
): string | null {
  if (!cwd) return null;
  const normalizedCwd = toPosixPath(cwd);
  const selectedProject = projectOptions?.find((project) => {
    const pathMatches = project.path === cwd || toPosixPath(project.path) === normalizedCwd;
    if (!pathMatches) return false;
    return deviceLinkDeviceId
      ? project.remoteDevice?.deviceId === deviceLinkDeviceId
      : project.remoteDevice === undefined;
  });
  if (selectedProject) return selectedProject.name;
  const parts = normalizedCwd.split('/').filter(Boolean);
  return parts[parts.length - 1] || cwd;
}

export function getProjectPickerEmptyLabelKey(mode: ProjectPickerEmptyLabelMode): string {
  return mode === 'generic'
    ? 'newChat.folderPicker.dialogueOrSelectProject'
    : 'newChat.folderPicker.dialogue';
}
