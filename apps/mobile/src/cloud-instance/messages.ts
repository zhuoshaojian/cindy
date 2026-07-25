import { getLocales } from 'expo-localization';

import {
  CLOUD_DEVICE_NAMES,
  resolveMobileLanguageBucket,
  type MobileLanguageBucket,
} from '@/device-link/devicePresentation';

export interface CloudInstanceMessages {
  cloud: string;
  wake: string;
  waking: string;
  wakeFailed: string;
  manageTitle(name: string): string;
  manageDescription: string;
  stop: string;
  stopping: string;
  stopped: string;
  stopFailed: string;
  delete: string;
  deleting: string;
  deleted: string;
  deleteFailed: string;
  deleteConfirmTitle: string;
  deleteConfirmDescription: string;
  deleteConfirm: string;
  cancel: string;
}

// `cloud` 兜底名与设备列表共用同一份译文(CLOUD_DEVICE_NAMES),避免两处漂移。
const CLOUD_INSTANCE_MESSAGES: Record<MobileLanguageBucket, CloudInstanceMessages> = {
  en: {
    cloud: CLOUD_DEVICE_NAMES.en,
    wake: 'Wake Cloud',
    waking: 'Waking…',
    wakeFailed: 'Failed to wake the cloud instance. Try again.',
    manageTitle: (name) => `Manage ${name}`,
    manageDescription: 'Choose an action for this cloud instance.',
    stop: 'Sleep Instance',
    stopping: 'Sleeping…',
    stopped: 'Cloud instance is sleeping.',
    stopFailed: 'Failed to sleep the cloud instance. Try again.',
    delete: 'Delete Instance',
    deleting: 'Deleting…',
    deleted: 'Cloud instance deleted.',
    deleteFailed: 'Failed to delete the cloud instance. Try again.',
    deleteConfirmTitle: 'Delete Cloud Instance?',
    deleteConfirmDescription: 'The cloud data will be deleted and cannot be recovered. The corresponding device will also be removed.',
    deleteConfirm: 'Delete Instance',
    cancel: 'Cancel',
  },
  ja: {
    cloud: CLOUD_DEVICE_NAMES.ja,
    wake: 'クラウドを起動',
    waking: '起動中…',
    wakeFailed: 'クラウドの起動に失敗しました。しばらくしてからもう一度お試しください。',
    manageTitle: (name) => `${name} を管理`,
    manageDescription: 'このクラウドインスタンスの操作を選択してください。',
    stop: 'インスタンスをスリープ',
    stopping: 'スリープ中…',
    stopped: 'クラウドインスタンスをスリープしました。',
    stopFailed: 'クラウドインスタンスのスリープに失敗しました。しばらくしてからもう一度お試しください。',
    delete: 'インスタンスを削除',
    deleting: '削除中…',
    deleted: 'クラウドインスタンスを削除しました。',
    deleteFailed: 'クラウドインスタンスの削除に失敗しました。しばらくしてからもう一度お試しください。',
    deleteConfirmTitle: 'クラウドインスタンスを削除しますか？',
    deleteConfirmDescription: 'クラウド上のデータは削除され、元に戻せません。対応するデバイスも削除されます。',
    deleteConfirm: 'インスタンスを削除',
    cancel: 'キャンセル',
  },
  ko: {
    cloud: CLOUD_DEVICE_NAMES.ko,
    wake: '클라우드 깨우기',
    waking: '깨우는 중…',
    wakeFailed: '클라우드 깨우기에 실패했습니다. 잠시 후 다시 시도해 주세요.',
    manageTitle: (name) => `${name} 관리`,
    manageDescription: '이 클라우드 인스턴스의 작업을 선택하세요.',
    stop: '인스턴스 절전',
    stopping: '절전 중…',
    stopped: '클라우드 인스턴스가 절전 상태입니다.',
    stopFailed: '클라우드 인스턴스를 절전 상태로 전환하지 못했습니다. 잠시 후 다시 시도해 주세요.',
    delete: '인스턴스 삭제',
    deleting: '삭제 중…',
    deleted: '클라우드 인스턴스를 삭제했습니다.',
    deleteFailed: '클라우드 인스턴스를 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.',
    deleteConfirmTitle: '클라우드 인스턴스를 삭제할까요?',
    deleteConfirmDescription: '클라우드 데이터가 삭제되며 복구할 수 없습니다. 해당 기기도 함께 제거됩니다.',
    deleteConfirm: '인스턴스 삭제',
    cancel: '취소',
  },
  zh: {
    cloud: CLOUD_DEVICE_NAMES.zh,
    wake: '唤醒云端',
    waking: '唤醒中…',
    wakeFailed: '唤醒云端失败，请稍后重试',
    manageTitle: (name) => `管理云端实例「${name}」`,
    manageDescription: '请选择要对这个云端实例执行的操作。',
    stop: '休眠实例',
    stopping: '休眠中…',
    stopped: '云端实例已休眠',
    stopFailed: '休眠云端实例失败，请稍后重试',
    delete: '删除实例',
    deleting: '删除中…',
    deleted: '云端实例已删除',
    deleteFailed: '删除云端实例失败，请稍后重试',
    deleteConfirmTitle: '删除云端实例？',
    deleteConfirmDescription: '删除后，云端数据将被删除且无法恢复，同时会移除对应设备。',
    deleteConfirm: '删除实例',
    cancel: '取消',
  },
};

/** Select the mobile cloud-instance copy from the viewer's current system language. */
export function getCloudInstanceMessages(
  languageCode = getLocales()[0]?.languageCode,
): CloudInstanceMessages {
  return CLOUD_INSTANCE_MESSAGES[resolveMobileLanguageBucket(languageCode)];
}
