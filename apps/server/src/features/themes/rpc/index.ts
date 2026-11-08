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

import { Themes } from '#server/features/themes/service/index';
import { defineRpc } from '#server/platform/definitions/define-rpc';

export const ThemesRpcLive = defineRpc(ThemesRpc, { themes: Themes }, ({ themes }) => ({
  'themes.theme': ({ id }) => themes.theme(id),
  'themes.findTheme': ({ id }) => themes.findTheme(id),
  'themes.themes': themes.themes,
  'themes.selectedTheme': () => themes.selectedTheme(),
  'themes.exportTheme': themes.exportTheme,
  'themes.importTheme': themes.importTheme,
  'themes.saveTheme': themes.saveTheme,
  'themes.deleteTheme': themes.deleteTheme,
  'themes.selectTheme': themes.selectTheme
}));
