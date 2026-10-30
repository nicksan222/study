import { Appearance } from '@study/server/shared/settings';
import { applyThemeToDocument, createThemeStore, defaultThemeId } from '@study/ui/theme';

import { studyClient } from './study-client';

export function initializeAppearance(document: Document): () => void {
  const store = createThemeStore({ appearance: 'dark' });
  const restore = applyThemeToDocument(store, document);
  let active = true;

  void Promise.all([
    studyClient.settings.getAppSettings.query({}),
    studyClient.themes.selected.query({}),
    studyClient.themes.list.query({})
  ])
    .then(([settings, selected, themes]) => {
      if (!active) return;

      const theme = themes.find((item) => item.id === (selected ?? defaultThemeId));

      if (theme) store.setTheme(theme);

      store.setAppearance(settings.appearance === Appearance.LIGHT ? 'light' : 'dark');
    })
    .catch(() => {
      // The generated default palette remains available before the server connects.
    });

  return () => {
    active = false;
    restore();
  };
}
