import { Appearance, defaultAppearancePreferences } from '@study/contracts/settings/types';
import {
  applyThemeToDocument,
  createThemeStore,
  defaultThemeId,
  observeSystemAppearance
} from '@study/ui/theme';

import { loadAppearance } from './study-client/operations';

let store = createThemeStore({ appearance: 'dark' });

let revision = 0;

let activePage: Document | undefined;

const preferenceProperties = [
  '--appearance-contrast-base',
  '--appearance-contrast-boost',
  '--appearance-contrast-border-boost',
  '--glass-opacity',
  '--ui-animation-duration',
  'zoom'
];

export function applyAppearance({
  settings,
  selected,
  themes,
  preferences = defaultAppearancePreferences
}: Awaited<ReturnType<typeof loadAppearance>>) {
  revision++;
  store.setTheme(themes.find((theme) => theme.id === (selected ?? defaultThemeId)) ?? {});
  store.setAppearance(
    settings.appearance === Appearance.SYSTEM
      ? 'system'
      : settings.appearance === Appearance.LIGHT
        ? 'light'
        : 'dark'
  );
  const element = activePage?.documentElement;

  if (element) {
    element.style.setProperty(
      '--appearance-contrast-base',
      `${Math.min(preferences.contrast, 100)}%`
    );
    element.style.setProperty(
      '--appearance-contrast-boost',
      `${Math.max(0, preferences.contrast - 100)}%`
    );
    element.style.setProperty(
      '--appearance-contrast-border-boost',
      `${Math.max(0, preferences.contrast - 100) / 2}%`
    );
    element.style.setProperty('--glass-opacity', `${preferences.glassOpacity}%`);
    element.style.setProperty('--ui-animation-duration', `${preferences.animationDurationMs}ms`);
    element.style.setProperty('zoom', `${settings.zoomPercent ?? 100}%`);
  }
}

export function initializeAppearance(document: Document): () => void {
  activePage = document;
  const originalPreferences = new Map(
    preferenceProperties.map((key) => [key, document.documentElement.style.getPropertyValue(key)])
  );

  store = createThemeStore({ appearance: 'dark' });
  const restore = applyThemeToDocument(store, document);
  const media = document.defaultView?.matchMedia('(prefers-color-scheme: dark)');
  const stopObserving = media ? observeSystemAppearance(store, media) : () => {};
  const controller = new AbortController();
  const initialRevision = revision;

  void loadAppearance(controller.signal)
    .then((data) => {
      if (!controller.signal.aborted && initialRevision === revision) applyAppearance(data);
    })
    .catch(() => {
      // Startup keeps the default palette when saved appearance is unavailable.
    });

  return () => {
    controller.abort();
    stopObserving();
    restore();

    for (const [key, value] of originalPreferences) {
      if (value) document.documentElement.style.setProperty(key, value);
      else document.documentElement.style.removeProperty(key);
    }

    if (activePage === document) activePage = undefined;
  };
}
