import { rpc } from '@study/contracts/react';

/** Startup preloading is bounded; mounted appearance settings own live reconciliation. */
export async function loadAppearance(signal?: AbortSignal) {
  const [settings, selected, preferences, themes] = await Promise.all([
    rpc.settings.appSettings.read({}, { signal }),
    rpc.themes.selectedTheme.read({}, { signal }),
    rpc.settings.appearancePreferences.read({}, { signal }),
    rpc.themes.list.read({ limit: 100 }, { signal })
  ]);

  return { settings, selected, preferences, themes: themes.items };
}
