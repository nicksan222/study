import type { TierSetup } from '@study/contracts/settings/types';
import { LlmModel } from '@study/contracts/settings/types';
import { RetryButton } from '@study/ui/action-button';
import { Button } from '@study/ui/button';
import { Loading } from '@study/ui/loading';
import { Settings } from '@study/ui/settings';
import { SignInActions } from '@study/ui/sign-in-actions';
import { Spinner } from '@study/ui/spinner';

import { useI18n } from '#web/lib/i18n.tsx';

import { ProviderKeyRow } from './provider-settings';
import type { AiSettingsModel } from './use-ai-settings';

const tiers = [
  { tier: 'tiny', title: 'AiSettingsTiny', description: 'AiSettingsTinyDescription' },
  { tier: 'medium', title: 'AiSettingsMedium', description: 'AiSettingsMediumDescription' },
  { tier: 'smart', title: 'AiSettingsSmart', description: 'AiSettingsSmartDescription' }
] as const;

export function AiAccountSettingsView({
  model,
  showHeading = true
}: {
  model: AiSettingsModel;
  showHeading?: boolean;
}) {
  const { t } = useI18n();
  const selectedProvider = model.credentialProvider;
  const provider = model.data?.providers.find((entry) => entry.id === selectedProvider);
  const providerOptions = [
    { value: '1', label: t('AiSettingsChatGpt') },
    ...(model.data?.providers ?? []).map((entry) => ({
      value: entry.id,
      label: t('AiSettingsProviderBrand', { provider: entry.name })
    }))
  ];

  return (
    <>
      <AiSettingsStatus model={model} />
      {model.data && (
        <Settings.Section title={showHeading ? t('AiSettingsAccount') : undefined}>
          <Settings.Intro>{t('AiSettingsCredentialsIntro')}</Settings.Intro>
          <Settings.Group>
            <Settings.SelectRow
              title={t('AiSettingsProvider')}
              value={selectedProvider}
              options={providerOptions}
              disabled={model.pending}
              onValueChange={model.selectCredentialProvider}
            />
            {provider ? (
              <ProviderKeyRow
                key={provider.id}
                provider={provider}
                pending={model.pending}
                save={model.saveApiKey}
              />
            ) : (
              <Settings.Row
                title={t('AiSettingsChatGpt')}
                description={
                  model.data.status.signedIn
                    ? (model.data.status.email ?? t('AiSettingsConnected'))
                    : t('AiSettingsPlanDescription')
                }
              >
                <AccountActions model={model} />
              </Settings.Row>
            )}
          </Settings.Group>
          <Settings.Intro>{t('AiSettingsApiProvidersDescription')}</Settings.Intro>
        </Settings.Section>
      )}
    </>
  );
}

function AccountActions({ model }: { model: AiSettingsModel }) {
  const { t } = useI18n();

  if (model.attempt) {
    if (!model.popupBlocked) return <Spinner size="md" label={t('AiSettingsWaiting')} />;

    return (
      <SignInActions url={model.attempt.url} linkLabel={t('AiSettingsOpenSignIn')}>
        <Button variant="ghost" disabled={model.cancelling} onClick={model.cancel}>
          {t('AiSettingsCancelSignIn')}
        </Button>
      </SignInActions>
    );
  }

  const signedIn = model.data?.status.signedIn;

  return (
    <Button
      variant="outline"
      disabled={model.pending}
      onClick={signedIn ? model.signOut : model.start}
    >
      {t(signedIn ? 'AiSettingsSignOut' : 'AiSettingsSignIn')}
    </Button>
  );
}

export function AiModelSettingsView({ model }: { model: AiSettingsModel }) {
  const { t } = useI18n();
  const choices: { setup: TierSetup; provider: string; model: string; disabled: boolean }[] = [
    {
      setup: { provider: 1 },
      provider: t('AiSettingsChatGpt'),
      model: t('AiSettingsDefaultModel'),
      disabled: !model.data?.status.signedIn
    },
    ...[
      { model: LlmModel.GPT6_LUNA, label: t('AiSettingsLuna') },
      { model: LlmModel.GPT61_SOL, label: t('AiSettingsSol') },
      { model: LlmModel.GPT6_ASTRA, label: t('AiSettingsAstra') }
    ].map(({ model: modelId, label }) => ({
      setup: { provider: 1 as const, model: modelId },
      provider: t('AiSettingsChatGpt'),
      model: label,
      disabled: !model.data?.status.signedIn
    })),
    ...(model.data?.providers ?? []).flatMap((provider) => [
      {
        setup: { provider: provider.id },
        provider: t('AiSettingsProviderBrand', { provider: provider.name }),
        model: t('AiSettingsDefaultModel'),
        disabled: !provider.configured
      },
      ...provider.models.map((id) => ({
        setup: { provider: provider.id, model: id },
        provider: t('AiSettingsProviderBrand', { provider: provider.name }),
        model: id,
        disabled: !provider.configured
      }))
    ])
  ];

  return (
    <>
      <AiSettingsStatus model={model} />
      {model.data && (
        <Settings.Section title={t('AiSettingsModels')}>
          <Settings.Group>
            {tiers.map(({ tier, title, description }) => {
              const setup = model.data!.settings[tier];
              const options = choices.filter(
                (option) =>
                  !option.disabled ||
                  (option.setup.provider === setup.provider && option.setup.model === setup.model)
              );
              let selected = options.findIndex(
                (option) =>
                  option.setup.provider === setup.provider && option.setup.model === setup.model
              );

              // Keep saved custom models selectable even when absent from the provider catalog.
              if (selected === -1 && typeof setup.provider === 'string') {
                const provider = model.data!.providers.find((entry) => entry.id === setup.provider);

                selected = options.length;
                options.push({
                  setup,
                  provider: t('AiSettingsProviderBrand', {
                    provider: provider?.name ?? setup.provider
                  }),
                  model: String(setup.model ?? t('AiSettingsDefaultModel')),
                  disabled: !provider?.configured
                });
              }

              return (
                <Settings.SelectRow
                  key={tier}
                  title={t(title)}
                  description={t(description)}
                  value={String(selected)}
                  options={options.map((option, index) => ({
                    value: String(index),
                    disabled: option.disabled,
                    label: t('AiSettingsModelOption', {
                      provider: option.provider,
                      model: option.model
                    })
                  }))}
                  disabled={model.pending || options.every((option) => option.disabled)}
                  onValueChange={(value) => {
                    const option = options.find((_entry, index) => String(index) === value);

                    if (option && !option.disabled) model.setSetup(tier, option.setup);
                  }}
                />
              );
            })}
          </Settings.Group>
        </Settings.Section>
      )}
    </>
  );
}

/** Both focused sections retain loading, save errors and recovery without coupling their controls. */
function AiSettingsStatus({ model }: { model: AiSettingsModel }) {
  const { t } = useI18n();

  return (
    <>
      {model.loading && <Loading label={t('LoadingSettings')} />}
      {model.error && (
        <Settings.Status
          action={
            <RetryButton
              variant="outline"
              onClick={model.retry}
              disabled={model.pending}
              label={t('Retry')}
            />
          }
        >
          {t(model.signInUnsupported ? 'AiSettingsSignInLocalOnly' : 'AiSettingsFailed')}
        </Settings.Status>
      )}
    </>
  );
}
