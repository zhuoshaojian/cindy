import type { ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { isAgentSelectableModel } from '@cindy/model-providers';

import { Button } from '@/components/ui/button';
import type { ModelAdvancedDrawer } from '@/components/settings/ModelAdvancedDrawer';
import { modelBrand } from '@/components/settings/modelManagementPresentation';
import { localizedBrandName, localizedModelName } from '@/lib/modelDisplayNames';
import { localizedModelDescription } from '@/lib/modelDescriptions';
import { modelPriceDetailRows } from '@/lib/modelPriceFormat';
import { providerDisplayName } from '@/lib/providerDisplayName';

type Props = Parameters<typeof ModelAdvancedDrawer>[0];

function tokens(value: number, locale: string): string {
  const approx =
    value >= 1_000_000
      ? `${Number((value / 1_000_000).toFixed(2))}M`
      : value >= 1000
        ? `${Math.round(value / 1000)}K`
        : String(value);
  return `${new Intl.NumberFormat(locale).format(value)} · ${approx}`;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="pt-5 first:pt-1">
      <h4 className="text-12 font-medium text-[var(--text-secondary)]">{title}</h4>
      <div className="mt-1.5">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-[34px] items-center justify-between gap-4 border-b border-[var(--settings-theme-card-border)] py-2 last:border-b-0">
      <span className="shrink-0 text-13 text-[var(--text-secondary)]">{label}</span>
      <span className="min-w-0 break-words text-right text-13 text-[var(--text-primary)]">
        {children}
      </span>
    </div>
  );
}

/**
 * The cloud instance's model panel: the local drawer's shell, catalog facts and the disable
 * action. Effort, context limit and price overrides are stored per device and are not yet
 * served by the instance, so they are not shown here.
 */
export function CloudModelDrawer({
  provider,
  row,
  open,
  onOpenChange,
  pricePresentationOf,
  onDisable,
  disabled,
  paymentRequired,
}: Props) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en';
  const userProvider = provider.source === 'user';
  const agent =
    row?.avail.find((candidate) => {
      const model = row.byAgent[candidate];
      return model && isAgentSelectableModel(model, { userProvider });
    }) ?? row?.avail[0];
  const model = row && agent ? row.byAgent[agent] : undefined;
  if (!row || !agent || !model) return null;
  const price = pricePresentationOf(agent, model);
  const description = localizedModelDescription(model, t);
  const brand = modelBrand(model);
  const selectionAvailable = provider.connected && !provider.suspended;
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-scrim fixed inset-0 z-[10001]" />
        <Dialog.Content
          onPointerDownOutside={(event) => event.preventDefault()}
          className="modal-panel fixed inset-0 z-[10001] m-auto flex h-fit max-h-[calc(100dvh-48px)] w-[800px] max-w-[calc(100vw-32px)] flex-col overflow-hidden"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          aria-describedby={undefined}
        >
          <header className="flex shrink-0 items-start gap-3 border-b border-[var(--settings-theme-card-border)] px-5 pb-3 pt-4">
            <div className="min-w-0 flex-1">
              <Dialog.Title className="break-words text-15 font-medium text-[var(--text-primary)] outline-none">
                {localizedModelName(model.name, t)}
              </Dialog.Title>
              <p className="mt-0.5 truncate text-12 text-[var(--text-tertiary)]">
                {providerDisplayName(provider, t)}
              </p>
            </div>
            <Dialog.Close
              className="-mr-1 -mt-1 shrink-0 rounded-full p-1.5 text-[var(--text-secondary)] transition-colors hover:bg-[var(--settings-menu-bg-hover)] hover:text-[var(--text-primary)]"
              aria-label={t('settings.providers.models.advanced.close')}
            >
              <X size={16} aria-hidden />
            </Dialog.Close>
          </header>
          <div className="min-h-0 overflow-y-auto px-5 pb-5 pt-3">
            <div className="grid gap-5 min-[760px]:grid-cols-2 min-[760px]:gap-6">
              <div className="min-w-0">
                <Section title={t('settings.providers.models.advanced.spec')}>
                  <Row label={t('settings.providers.models.advanced.contextWindow')}>
                    {model.contextWindow > 0 ? (
                      tokens(model.contextWindow, locale)
                    ) : (
                      <span className="text-[var(--text-tertiary)]">
                        {t('settings.providers.models.advanced.catalogMissing')}
                      </span>
                    )}
                  </Row>
                  {model.maxOutput !== undefined && (
                    <Row label={t('settings.providers.models.advanced.maxOutput')}>
                      {new Intl.NumberFormat(locale).format(model.maxOutput)}
                    </Row>
                  )}
                </Section>
              </div>
              <div className="min-w-0">
                <Section title={t('settings.providers.models.advanced.pricing')}>
                  {price === null ? (
                    <Row label={t('settings.providers.models.advanced.pricingLabel')}>
                      <span className="text-[var(--text-tertiary)]">
                        {t(
                          provider.access?.kind === 'subscription'
                            ? 'settings.providers.models.subscription'
                            : 'settings.providers.models.advanced.noPricing',
                        )}
                      </span>
                    </Row>
                  ) : price.kind === 'free' ? (
                    <Row label={t('settings.providers.models.advanced.pricingLabel')}>
                      {t('newChat.modelSelector.pricing.free')}
                    </Row>
                  ) : (
                    modelPriceDetailRows(price.current, price.original).map((detail) => (
                      <Row
                        key={detail.kind}
                        label={t(`settings.providers.models.advanced.price.${detail.kind}`)}
                      >
                        {detail.value}
                        {detail.originalValue && (
                          <span className="ml-1.5 text-11 text-[var(--text-tertiary)] line-through">
                            {detail.originalValue}
                          </span>
                        )}
                        <span className="ml-1 text-11 text-[var(--text-tertiary)]">
                          {t('settings.providers.models.advanced.perMtok')}
                        </span>
                      </Row>
                    ))
                  )}
                </Section>
                <Section title={t('settings.providers.models.advanced.identity')}>
                  {description && (
                    <p className="mb-2 text-12 leading-relaxed text-[var(--text-secondary)]">
                      {description}
                    </p>
                  )}
                  <Row label={t('settings.providers.models.advanced.modelId')}>
                    <code className="select-text break-all text-12">{model.id}</code>
                  </Row>
                  {brand && (
                    <Row label={t('settings.providers.models.management.brand')}>
                      {localizedBrandName(brand, t)}
                    </Row>
                  )}
                </Section>
              </div>
            </div>
          </div>
          {!paymentRequired && (
            <div className="flex shrink-0 flex-col gap-2 border-t border-[var(--settings-theme-card-border)] px-5 py-3">
              <Button
                variant="secondary"
                size="md"
                compact
                type="button"
                disabled={disabled && !selectionAvailable}
                onClick={() => onDisable(row)}
              >
                {disabled
                  ? t('settings.providers.models.enableModel')
                  : t('settings.providers.models.disableModel')}
              </Button>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
