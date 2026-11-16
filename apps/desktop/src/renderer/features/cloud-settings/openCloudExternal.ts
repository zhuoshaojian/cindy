/** Keep a browser click's popup permission while the instance resolves its current link. */
export async function openCloudExternal(resolveUrl: () => Promise<string>): Promise<void> {
  if ((window.electronAPI.platform as string) !== 'web') {
    const result = await window.electronAPI.openExternal(await resolveUrl());
    if (!result.success) throw new Error('OPEN_FAILED');
    return;
  }
  // Reserve only from the explicit click, before any network wait. The remote Host still
  // validates the provider-specific URL; no query or authorization material is cached here.
  const opened = window.open('about:blank', '_blank');
  if (!opened) throw new Error('OPEN_FAILED');
  opened.opener = null;
  try {
    const url = new URL(await resolveUrl());
    if (url.protocol !== 'https:' || url.username || url.password || opened.closed)
      throw new Error('OPEN_FAILED');
    opened.location.replace(url.href);
  } catch (error) {
    opened.close();
    throw error;
  }
}
