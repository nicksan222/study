import { Appearance } from '@study/contracts/settings/types';
import { applyThemeToDocument, createThemeStore, defaultThemeId } from '@study/ui/theme';

import { runOperation } from './effect/runtime';
import { loadAppearance } from './study-client/operations';

export function initializeAppearance(document: Document): () => void {
  const store = createThemeStore({ appearance: 'dark' });
  const restore = applyThemeToDocument(store, document);
  const controller = new AbortController();

  void runOperation(loadAppearance(), controller.signal).then((outcome) => {
    if (controller.signal.aborted || outcome.status !== 'ready') return;

    const { settings, selected, themes } = outcome.value;
    const theme = themes.find((item) => item.id === (selected ?? defaultThemeId));

    if (theme) store.setTheme(theme);

    store.setAppearance(settings.appearance === Appearance.LIGHT ? 'light' : 'dark');
  });

  return () => {
    controller.abort();
    restore();
  };
}
