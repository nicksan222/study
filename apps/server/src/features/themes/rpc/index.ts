/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Binds the themes RPC contract to catalog, import/export, persistence, and          │
 * │ selection service operations.                                                            │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - RPC handlers adapt declared schemas to the owning feature service; transport wiring    │
 * │   stays here.                                                                            │
 * │ - Maps declared operations to the feature service.                                       │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Leaves input validation and domain behavior to contracts and service.                    │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { ThemesRpc } from '@study/contracts/themes/rpc';
import { Effect } from 'effect';

import { Themes } from '#server/features/themes/service/index';
import { defineRpc } from '#server/platform/definitions/define-rpc';

export const ThemesRpcLive = defineRpc(
  ThemesRpc,
  Effect.gen(function* () {
    const themes = yield* Themes;

    return {
      'themes.theme': ({ id }) => themes.theme(id),
      'themes.findTheme': ({ id }) => themes.findTheme(id),
      'themes.themes': (input) => themes.themes(input),
      'themes.selectedTheme': () => themes.selectedTheme(),
      'themes.exportTheme': (input) => themes.exportTheme(input),
      'themes.importTheme': (input) => themes.importTheme(input),
      'themes.saveTheme': (input) => themes.saveTheme(input),
      'themes.deleteTheme': (input) => themes.deleteTheme(input),
      'themes.selectTheme': (input) => themes.selectTheme(input)
    };
  })
);
