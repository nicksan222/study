import { defaultAppearancePreferences } from '@study/contracts/settings/types';
import { Settings } from '@study/ui/settings';

import { useI18n } from '#web/lib/i18n.tsx';

import type { AppearanceModel } from './use-page';

/** Edits appearance, language and zoom through persisted preference actions. */
export function InterfaceSettings({ model }: { model: AppearanceModel }) {
  const { t } = useI18n();
  const preferences = model.data!.preferences ?? defaultAppearancePreferences;
  const controls = [
    {
      key: 'contrast',
      title: 'AppearanceContrast',
      description: 'AppearanceContrastDescription',
      min: 75,
      max: 150,
      step: 5,
      suffix: '%'
    },
    {
      key: 'glassOpacity',
      title: 'GlassOpacity',
      description: 'GlassOpacityDescription',
      min: 40,
      max: 100,
      step: 5,
      suffix: '%'
    },
    {
      key: 'animationDurationMs',
      title: 'PanelAnimations',
      description: 'PanelAnimationsDescription',
      min: 0,
      max: 400,
      step: 25,
      suffix: ' ms'
    }
  ] as const;

  return (
    <Settings.Section variant="interface" title={t('InterfaceSettings')}>
      <Settings.Group>
        {controls.map((control) => (
          <Settings.RangeRow
            key={control.key}
            title={t(control.title)}
            description={t(control.description)}
            resetLabel={`${t('ResetSetting')}: ${t(control.title)}`}
            value={preferences[control.key]}
            defaultValue={defaultAppearancePreferences[control.key]}
            min={control.min}
            max={control.max}
            step={control.step}
            suffix={control.suffix}
            disabled={model.pending}
            onCommit={(value) => model.setPreferences({ ...preferences, [control.key]: value })}
          />
        ))}
        <Settings.RangeRow
          title={t('TextSize')}
          description={t('InterfaceScaleDescription')}
          resetLabel={`${t('ResetSetting')}: ${t('TextSize')}`}
          value={model.data!.settings.zoomPercent}
          defaultValue={100}
          min={50}
          max={200}
          step={5}
          disabled={model.pending}
          onCommit={model.setZoom}
        />
      </Settings.Group>
    </Settings.Section>
  );
}
