import { StudyError } from '@study/contracts/errors';
import type { themePageInputSchema } from '@study/contracts/themes/rpc';
import { parseTheme, serializeTheme } from '@study/theme';
import { Effect } from 'effect';

import { ThemeSelectionStore, ThemeStore } from '#server/features/themes/store/index';
import { defineService } from '#server/platform/definitions/define-service';
import { transaction, useStore } from '#server/platform/definitions/define-store';

export const Themes = defineService(
  'study/Themes',
  Effect.gen(function* () {
    const themes = yield* useStore(ThemeStore);
    const selection = yield* useStore(ThemeSelectionStore);
    const save = (json: string, replace: boolean) =>
      Effect.try({
        try: () => parseTheme(json),
        catch: (error) => new StudyError('invalid_input', 'Invalid theme file', { cause: error })
      }).pipe(
        Effect.flatMap((theme) =>
          transaction((tx) => tx.store(ThemeStore).saveTheme({ theme, replace }))
        )
      );

    return {
      theme: themes.theme,
      findTheme: themes.findTheme,
      themes: (input: typeof themePageInputSchema.Type) =>
        Effect.gen(function* () {
          const items = yield* themes.themes(input);
          const last = items.at(-1);
          const more =
            last && items.length === input.limit
              ? yield* themes.themes({ limit: 1, before: last.id })
              : [];

          return { items, next: more.length && last ? last.id : null };
        }),
      selectedTheme: () =>
        selection.selection(undefined).pipe(Effect.map((value) => value.selected)),
      exportTheme: ({ id }: { id: string }) => themes.theme(id).pipe(Effect.map(serializeTheme)),
      importTheme: ({ json }: { json: string }) => save(json, false),
      saveTheme: ({ json }: { json: string }) => save(json, true),
      deleteTheme: ({ id }: { id: string }) =>
        transaction((tx) => {
          tx.store(ThemeStore).deleteTheme(id);
          const selected = tx.store(ThemeSelectionStore);

          if (selected.selection(undefined).selected === id) selected.setSelection(null);
        }),
      selectTheme: ({ id }: { id: string | null }) =>
        transaction((tx) => {
          if (id !== null) tx.store(ThemeStore).theme(id);

          tx.store(ThemeSelectionStore).setSelection(id);
        })
    };
  })
);
