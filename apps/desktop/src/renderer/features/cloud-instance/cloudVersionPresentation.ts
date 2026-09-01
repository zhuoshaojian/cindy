import { parseCloudInstanceImageTag } from '@cindy/maker-shared/cloud-instance';

export interface CloudVersionPresentation {
  currentVersion: string | null;
  upToDate: boolean;
}

/** 将共享 image-tag 解析结果收敛为桌面云端卡片的展示状态。 */
export function resolveCloudVersionPresentation(input: {
  image: string | null | undefined;
  updateAvailable: boolean;
  updating: boolean;
}): CloudVersionPresentation {
  const currentVersion = parseCloudInstanceImageTag(input.image);
  return {
    currentVersion,
    upToDate: currentVersion !== null && !input.updateAvailable && !input.updating,
  };
}
