import type { StudyError } from '@study/contracts/errors';
import { ThemesRpc } from '@study/contracts/themes/rpc';
import { Effect } from 'effect';

import { Themes } from '#server/features/themes/service/index';

const failure = (error: StudyError) => ({
  kind: error.kind,
  message: error.message,
  retryAfterMs: error.retryAfterMs
});

export const ThemesRpcLive = ThemesRpc.toLayer(
  Effect.gen(function* () {
    const themes = yield* Themes;

    return {
      'themes.theme': ({ id }) => themes.theme(id).pipe(Effect.mapError(failure)),
      'themes.findTheme': ({ id }) => themes.findTheme(id).pipe(Effect.mapError(failure)),
      'themes.themes': (input) => themes.themes(input).pipe(Effect.mapError(failure)),
      'themes.selectedTheme': () => themes.selectedTheme().pipe(Effect.mapError(failure)),
      'themes.exportTheme': (input) => themes.exportTheme(input).pipe(Effect.mapError(failure)),
      'themes.importTheme': (input) => themes.importTheme(input).pipe(Effect.mapError(failure)),
      'themes.saveTheme': (input) => themes.saveTheme(input).pipe(Effect.mapError(failure)),
      'themes.deleteTheme': (input) => themes.deleteTheme(input).pipe(Effect.mapError(failure)),
      'themes.selectTheme': (input) => themes.selectTheme(input).pipe(Effect.mapError(failure))
    };
  })
);
