import {
  TAB_IDS as SHARED_TAB_IDS,
  TAB_LABEL_KEY as SHARED_TAB_LABEL_KEY,
  type SettingsTab as SharedSettingsTab,
} from '@cindy/maker-shared/settings-tabs';

export * from '@cindy/maker-shared/settings-tabs';

/**
 * 「云实例」的落点是「远程连接」的「云实例」分组,但 id 仍留在本端 TAB_IDS:
 * TAB_IDS 与 settingsReadCatalog 的 SETTINGS_READ_TABS 必须一致(后者供 Host 投影与 CIS 排版),
 * 所以只在可见层隐藏:不进菜单、不进搜索,旧深链改写到落点。共享包(Agent 的设置入口)不含它。
 */
export type SettingsTab = SharedSettingsTab | 'cloud-instances';

const CLOUD_INSTANCES_AFTER = SHARED_TAB_IDS.indexOf('remote-control') + 1;
export const TAB_IDS: ReadonlyArray<(typeof SHARED_TAB_IDS)[number] | 'cloud-instances'> = [
  ...SHARED_TAB_IDS.slice(0, CLOUD_INSTANCES_AFTER),
  'cloud-instances',
  ...SHARED_TAB_IDS.slice(CLOUD_INSTANCES_AFTER),
];

export type VisibleSettingsTab = (typeof TAB_IDS)[number];

/** 已并入其它分区、但 id 仍留在 TAB_IDS 的 tab → 现在的落点。 */
export const MERGED_SETTINGS_TABS: Partial<Record<VisibleSettingsTab, VisibleSettingsTab>> = {
  'cloud-instances': 'remote-control',
};

export const TAB_LABEL_KEY: Record<SettingsTab, string> = {
  ...SHARED_TAB_LABEL_KEY,
  'cloud-instances': 'cloudSettings.instance.title',
};

export function isSettingsTab(value: string | null): value is SettingsTab {
  return value !== null && (TAB_IDS as ReadonlyArray<string>).includes(value);
}
