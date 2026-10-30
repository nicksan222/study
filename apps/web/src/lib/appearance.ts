import { Appearance } from '@study/contracts/settings/types';
import { applyThemeToDocument, createThemeStore, defaultThemeId } from '@study/ui/theme';

import { loadAppearance } from './study-client/operations';

export function initializeAppearance(document: Document): () => void {
  const store = createThemeStore({ appearance: 'dark' });
  const restore = applyThemeToDocument(store, document);
  const controller = new AbortController();

  void loadAppearance(controller.signal)
    .then(({ settings, selected, themes }) => {
      if (controller.signal.aborted) return;

      const theme = themes.find((item) => item.id === (selected ?? defaultThemeId));

      if (theme) store.setTheme(theme);

      store.setAppearance(settings.appearance === Appearance.LIGHT ? 'light' : 'dark');
    })
    .catch(() => {
      // Startup keeps the default palette when saved appearance is unavailable.
    });

  return () => {
    controller.abort();
    restore();
  };
}
