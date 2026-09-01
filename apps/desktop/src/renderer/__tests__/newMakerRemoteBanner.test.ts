import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import en from '../i18n/locales/en/common.json';
import ja from '../i18n/locales/ja/common.json';
import ko from '../i18n/locales/ko/common.json';
import zhCN from '../i18n/locales/zh-CN/common.json';
import zhTW from '../i18n/locales/zh-TW/common.json';

const source = readFileSync(
  resolve(__dirname, '..', 'features', 'cc-agent', 'NewMakerDraftRoute.tsx'),
  'utf8',
).replace(/\r\n?/g, '\n');

const banners = {
  en: en.ccAgent.draft,
  ja: ja.ccAgent.draft,
  ko: ko.ccAgent.draft,
  'zh-CN': zhCN.ccAgent.draft,
  'zh-TW': zhTW.ccAgent.draft,
};

function renderCopy(template: string, values: Record<string, string>): string {
  return template.replace(/{{(\w+)}}/g, (_match, key: string) => values[key] ?? '');
}

describe('New Maker remote draft banner', () => {
  it('renders one banner below the input with the resolved device name', () => {
    expect(source).toContain('const effectiveProjectNameCandidate = effectiveWorkingDir');
    expect(source).toContain('const effectiveProjectName = effectiveProjectNameCandidate?.trim()');
    expect(
      source.match(/effectiveProjectName\s+\? t\('ccAgent\.draft\.remoteProjectBanner'/g),
    ).toHaveLength(1);
    expect(source.match(/effectiveDeviceLinkDisplayName \?\? effectiveDeviceLinkDeviceId/g))
      .toHaveLength(2);
    expect(source).not.toMatch(
      /device:\s*effectiveDeviceLinkDeviceName \?\? effectiveDeviceLinkDeviceId/,
    );

    expect(renderCopy(banners.en.remoteProjectBanner, { device: 'Cloud', project: 'Repo' })).toBe(
      'New session in Repo on Cloud',
    );
    expect(renderCopy(banners.ja.remoteProjectBanner, { device: 'Cloud', project: 'Repo' })).toBe(
      'Cloud の Repo で新しいセッションを作成',
    );
    expect(renderCopy(banners.ko.remoteProjectBanner, { device: 'Cloud', project: 'Repo' })).toBe(
      'Cloud의 Repo에서 새 세션 만들기',
    );
    expect(
      renderCopy(banners['zh-CN'].remoteProjectBanner, { device: '云端', project: 'Repo' }),
    ).toBe('在 云端 的 Repo 中新建任务');
    expect(
      renderCopy(banners['zh-TW'].remoteProjectBanner, { device: '雲端', project: 'Repo' }),
    ).toBe('在 雲端 的 Repo 中新建任務');
  });

  it('uses the no-project copy in the single placement when the path is absent or parses empty', () => {
    expect(source.match(/: t\('ccAgent\.draft\.remoteDialogueBanner'/g)).toHaveLength(1);

    expect(renderCopy(banners.en.remoteDialogueBanner, { device: 'Cloud' })).toBe(
      'New chat on Cloud (no project)',
    );
    expect(renderCopy(banners.ja.remoteDialogueBanner, { device: 'Cloud' })).toBe(
      'Cloud で新しい対話（プロジェクトなし）',
    );
    expect(renderCopy(banners.ko.remoteDialogueBanner, { device: 'Cloud' })).toBe(
      'Cloud에서 새 대화(프로젝트 없음)',
    );
    expect(renderCopy(banners['zh-CN'].remoteDialogueBanner, { device: '云端' })).toBe(
      '在 云端 上新建对话（不绑定项目）',
    );
    expect(renderCopy(banners['zh-TW'].remoteDialogueBanner, { device: '雲端' })).toBe(
      '在 雲端 上新建對話（不繫結專案）',
    );
  });
});
