// No imports: main.tsx loads this before the bridge exists and shared modules may read it.

/**
 * What a crash report from the browser needs: there is no main-process log here, so the
 * screen itself carries the error, its frames and the browser. Safari's stack omits the
 * message, so both are kept.
 */
export function crashReport(error: unknown): { message: string; details: string } {
  const message =
    error instanceof Error ? `${error.name}: ${error.message}` : String(error ?? 'Unknown error');
  const stack = error instanceof Error ? (error.stack ?? '') : '';
  const frames = stack.startsWith(message)
    ? stack.slice(message.length).replace(/^\n/u, '')
    : stack;
  return { message, details: [message, frames, navigator.userAgent].filter(Boolean).join('\n\n') };
}

/**
 * Failures before the pages mount (a script that cannot load, a browser without a needed
 * feature) have no React tree to show them; write the report into the page directly.
 */
export function showStartFailure(error: unknown, root: HTMLElement) {
  if (root.childElementCount) return;
  const zh = navigator.language.startsWith('zh');
  const { details } = crashReport(error);
  const box = document.createElement('div');
  box.style.cssText =
    'max-width:560px;margin:15vh auto;padding:0 24px;font:14px/1.6 system-ui,-apple-system,sans-serif;color:#333';
  const title = document.createElement('p');
  title.style.cssText = 'font-size:16px;font-weight:600;margin:0 0 8px';
  title.textContent = zh ? '页面加载失败' : 'The page failed to load';
  const hint = document.createElement('p');
  hint.style.cssText = 'margin:0 0 12px;color:#666';
  hint.textContent = zh
    ? '请刷新重试；仍然失败时，把下面的信息发给管理员。'
    : 'Reload to try again. If it still fails, send the details below to your administrator.';
  const pre = document.createElement('pre');
  pre.style.cssText =
    'white-space:pre-wrap;word-break:break-word;max-height:40vh;overflow:auto;padding:12px;border-radius:8px;background:#f4f4f4;font:12px/1.5 ui-monospace,monospace;margin:0 0 12px';
  pre.textContent = details;
  const reload = document.createElement('button');
  reload.type = 'button';
  reload.style.cssText =
    'padding:6px 14px;border-radius:8px;border:1px solid #ccc;background:#fff;font:inherit;cursor:pointer';
  reload.textContent = zh ? '重新加载' : 'Reload';
  reload.addEventListener('click', () => location.reload());
  box.append(title, hint, pre, reload);
  root.replaceChildren(box);
}
