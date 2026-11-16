import type { Translate } from './i18n.ts';

/** Keeps the labels used by every rendering of the appearance controls identical. */
export function interfaceControlLabels(t: Translate) {
  const controls = {
    contrast: ['AppearanceContrast', 'AppearanceContrastDescription'],
    glassOpacity: ['GlassOpacity', 'GlassOpacityDescription'],
    animationDurationMs: ['PanelAnimations', 'PanelAnimationsDescription'],
    zoom: ['TextSize', 'InterfaceScaleDescription']
  } as const;

  const label = ([title, description]: (typeof controls)[keyof typeof controls]) => ({
    title: t(title),
    description: t(description),
    resetLabel: `${t('ResetSetting')}: ${t(title)}`
  });

  return {
    contrast: label(controls.contrast),
    glassOpacity: label(controls.glassOpacity),
    animationDurationMs: label(controls.animationDurationMs),
    zoom: label(controls.zoom)
  };
}
