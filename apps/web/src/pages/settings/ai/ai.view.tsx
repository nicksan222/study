import { LlmModel } from '@study/contracts/settings/types';
import { Button } from '@study/ui/button';
import { Loading } from '@study/ui/loading';
import { SelectControl } from '@study/ui/select-control';
import { Settings } from '@study/ui/settings';
import { SignInActions } from '@study/ui/sign-in-actions';
import { Spinner } from '@study/ui/spinner';

import { useI18n } from '#web/lib/i18n.tsx';

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

  return (
    <>
      {model.loading && <Loading label={t('LoadingSettings')} />}
      {model.error && (
        <Settings.Status
          action={
            <Button variant="outline" onClick={model.retry} disabled={model.pending}>
              {t('Retry')}
            </Button>
          }
        >
          {t(model.signInUnsupported ? 'AiSettingsSignInLocalOnly' : 'AiSettingsFailed')}
        </Settings.Status>
      )}
      {model.data && (
        <>
          <Settings.Section title={showHeading ? t('AiSettingsAccount') : undefined}>
            <Settings.Group>
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
            </Settings.Group>
          </Settings.Section>
        </>
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

export function AiSettingsView({ model }: { model: AiSettingsModel }) {
  const { t } = useI18n();
  const options = [
    { value: '', label: t('AiSettingsDefaultModel') },
    { value: String(LlmModel.GPT6_LUNA), label: t('AiSettingsLuna') },
    { value: String(LlmModel.GPT61_SOL), label: t('AiSettingsSol') },
    { value: String(LlmModel.GPT6_ASTRA), label: t('AiSettingsAstra') }
  ];

  return (
    <>
      <AiAccountSettingsView model={model} />
      {model.data && (
        <Settings.Section title={t('AiSettingsModels')}>
          <Settings.Group>
            {tiers.map(({ tier, title, description }) => (
              <Settings.Row key={tier} title={t(title)} description={t(description)}>
                <SelectControl
                  label={t(title)}
                  value={String(model.data!.settings[tier].model ?? '')}
                  options={options}
                  disabled={model.pending}
                  onValueChange={(value) => {
                    const selected = Object.values(LlmModel).find(
                      (modelId) => String(modelId) === value
                    );

                    if (value === '' || selected !== undefined) model.setModel(tier, selected);
                  }}
                />
              </Settings.Row>
            ))}
          </Settings.Group>
        </Settings.Section>
      )}
    </>
  );
}
