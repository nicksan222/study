/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Validates and serializes theme files, coordinates catalog mutations, and maintains │
 * │ selected-theme preferences transactionally.                                              │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Feature services own application rules and coordinate typed store operations.          │
 * │ - Validates or coordinates feature-level operations.                                     │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses owned stores and platform transactions rather than querying SQLite directly.        │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts/errors';
import type { themePageInputSchema } from '@study/contracts/themes/rpc';
import { parseTheme, serializeTheme } from '@study/theme';
import { Effect } from 'effect';

import { ThemeSelectionStore, ThemeStore } from '#server/features/themes/store/index';
import { defineService } from '#server/platform/definitions/define-service';
import { transaction, useStore } from '#server/platform/definitions/define-store';
import { pageById } from '#server/platform/definitions/page-by-id';

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
      themes: (input: typeof themePageInputSchema.Type) => pageById(themes.themes, input),
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
