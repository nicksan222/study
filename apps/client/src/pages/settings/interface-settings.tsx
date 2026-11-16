import { defaultAppearancePreferences } from '@study/contracts';
import { interfaceControlLabels } from '@study/localization';
import { InterfaceControls } from '@study/ui';

import { useI18n } from '#client/lib/i18n.tsx';

import type { AppearanceModel } from './use-page';

/** Edits appearance, language and zoom through persisted preference actions. */
export function InterfaceSettings({ model }: { model: AppearanceModel }) {
  const { t } = useI18n();
  const preferences = model.data!.preferences ?? defaultAppearancePreferences;

  return (
    <InterfaceControls
      title={t('InterfaceSettings')}
      disabled={model.pending}
      labels={interfaceControlLabels(t)}
      values={{ ...preferences, zoom: model.data!.settings.zoomPercent }}
      defaults={{ ...defaultAppearancePreferences, zoom: 100 }}
      onCommit={(key, value) => {
        if (key === 'zoom') model.setZoom(value);
        else model.setPreferences({ ...preferences, [key]: value });
      }}
    />
  );
}
