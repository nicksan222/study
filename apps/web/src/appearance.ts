import { Appearance } from '@study/contracts/settings/types';
import { applyThemeToDocument, createThemeStore, defaultThemeId } from '@study/ui/theme';
import { Effect } from 'effect';

import { runStudy } from './study-client';

export function initializeAppearance(document: Document): () => void {
  const store = createThemeStore({ appearance: 'dark' });
  const restore = applyThemeToDocument(store, document);
  const controller = new AbortController();

  void runStudy(
    (client) =>
      Effect.gen(function* () {
        const [settings, selected] = yield* Effect.all(
          [client['settings.appSettings']({}), client['themes.selectedTheme']({})],
          { concurrency: 'unbounded' }
        );
        let before: string | undefined;
        const themeId = selected ?? defaultThemeId;

        do {
          const page = yield* client['themes.themes']({ limit: 100, before });
          const theme = page.items.find((item) => item.id === themeId);

          if (theme) {
            store.setTheme(theme);
            break;
          }

          before = page.next ?? undefined;
        } while (before !== undefined);

        store.setAppearance(settings.appearance === Appearance.LIGHT ? 'light' : 'dark');
      }),
    controller.signal
  ).catch(() => {
    // The generated default palette remains available before the server connects.
  });

  return () => {
    controller.abort();
    restore();
  };
}
