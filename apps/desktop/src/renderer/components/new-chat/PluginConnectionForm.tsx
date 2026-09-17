import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { normalizePluginConnectionHost, parsePluginConnectionInput } from '@cindy/device-link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FormField } from '@/components/ui/form-field';

/** Input is ephemeral and local to the current target/card/revision. Never a chat draft. */
export function PluginConnectionForm({ busy, disabled, onSubmit }: {
  busy: boolean; disabled: boolean; onSubmit(host: string, token: string): void;
}) {
  const { t } = useTranslation();
  const [host, setHost] = useState(''), [token, setToken] = useState('');
  const [error, setError] = useState<'host' | 'token' | null>(null);
  const hostRef = useRef<HTMLInputElement>(null), tokenRef = useRef<HTMLInputElement>(null);
  const submitted = useRef(false);
  useEffect(() => { if (!busy) submitted.current = false; }, [busy]);
  const submit = () => {
    if (disabled || busy || submitted.current) return;
    try { normalizePluginConnectionHost(host); }
    catch { setError('host'); hostRef.current?.focus(); return; }
    try { parsePluginConnectionInput({ host, token }); }
    catch { setError('token'); tokenRef.current?.focus(); return; }
    submitted.current = true;
    onSubmit(host, token);
    setToken(''); setHost(''); setError(null);
  };
  return <form className="mt-3 flex min-w-0 flex-col gap-3" autoComplete="off" onSubmit={e => { e.preventDefault(); submit(); }}>
    <FormField label={t('newChat.pluginSetup.connection.host')} required reserveFeedback
      hint={t('newChat.pluginSetup.connection.hostHint')}
      error={error === 'host' ? t('newChat.pluginSetup.connection.hostInvalid') : undefined}>
      {control => <Input {...control} size="md" inputRef={hostRef} value={host} onChange={setHost}
        disabled={disabled || busy} maxLength={512} autoCapitalize="none" spellCheck={false} autoComplete="off" />}
    </FormField>
    <FormField label={t('newChat.pluginSetup.connection.token')} required reserveFeedback
      error={error === 'token' ? t('newChat.pluginSetup.connection.tokenInvalid') : undefined}>
      {control => <Input {...control} size="md" inputRef={tokenRef} secret value={token} onChange={setToken}
        disabled={disabled || busy} maxLength={4096} autoCapitalize="none" spellCheck={false} autoComplete="new-password" />}
    </FormField>
    <p className="text-12 leading-5 text-[var(--text-secondary)]">{t('newChat.pluginSetup.connection.hint')}</p>
    <div><Button type="submit" size="lg" loading={busy} disabled={disabled || !host.trim() || !token.trim()}>
      {t('newChat.pluginSetup.saveConfiguration')}
    </Button></div>
  </form>;
}
