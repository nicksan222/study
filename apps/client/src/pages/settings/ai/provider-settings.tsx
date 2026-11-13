import type { aiProviderSchema } from '@study/contracts/settings/schemas';
import { Button } from '@study/ui/button';
import { Input } from '@study/ui/input';
import { Settings } from '@study/ui/settings';
import { useState } from 'react';

import { useI18n } from '#client/lib/i18n.tsx';

type Provider = typeof aiProviderSchema.Type;

/** Draft keys stay in this input; saved keys are never fetched back into the browser. */
export function ProviderKeyRow({
  provider,
  pending,
  save
}: {
  provider: Provider;
  pending: boolean;
  save: (provider: string, apiKey: string | null) => Promise<void>;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState('');

  async function commit(apiKey: string | null) {
    try {
      await save(provider.id, apiKey);
      setDraft('');
    } catch {
      // The owning settings model exposes the failure and retry action.
    }
  }

  return (
    <Settings.Row
      title={t('AiSettingsProviderBrand', { provider: provider.name })}
      description={t(provider.configured ? 'AiSettingsKeySaved' : 'AiSettingsKeyMissing')}
    >
      <Settings.Form
        onSubmit={(event) => {
          event.preventDefault();

          if (draft.trim() && !pending) void commit(draft.trim());
        }}
      >
        <Input
          type="password"
          aria-label={t('AiSettingsApiKey')}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          value={draft}
          disabled={pending}
          onChange={(event) => setDraft(event.target.value)}
        />
        <Button type="submit" variant="outline" disabled={pending || !draft.trim()}>
          {t('AiSettingsSaveKey')}
        </Button>
        {provider.configured && (
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            onClick={() => void commit(null)}
          >
            {t('AiSettingsRemoveKey')}
          </Button>
        )}
      </Settings.Form>
    </Settings.Row>
  );
}
