/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exposes schema-checked subject capabilities and their agent-facing usage guides.   │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Reuses Projects service operations with canonical typed IDs and schemas.               │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Feature services retain persistence policy; the agent runner provides dependencies and   │
 * │ tool execution.                                                                          │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import {
  themeIdInputSchema,
  themePageInputSchema,
  themePageSchema,
  selectThemeInputSchema
} from '@study/contracts/themes/rpc';
import { themeFileSchema } from '@study/contracts/themes/schemas';
import { serializeTheme } from '@study/theme';
import { Effect, Schema } from 'effect';

import { Themes } from '#server/features/themes/index';
import { defineTool } from '#server/platform/definitions/define-agent';

export const themeTools = {
  list_themes: defineTool({
    description: 'List available themes, following next with before for more pages.',
    wiki: {
      when: 'Discover available interface themes.',
      examples: ['Which themes can I use?'],
      limits: 'Returns theme metadata, at most 100 entries per page.'
    },
    input: themePageInputSchema,
    output: themePageSchema,
    mutates: false,
    execute: (input) =>
      Themes.use((service) => service.themes(input)).pipe(Effect.provide(Themes.layer))
  }),
  read_theme: defineTool({
    description: 'Read the full definition of a theme.',
    wiki: {
      when: 'Inspect theme colors before editing.',
      examples: ['What colors does my theme use?'],
      limits: 'Use a theme ID from list_themes. Does not select the theme.'
    },
    input: themeIdInputSchema,
    output: themeFileSchema,
    mutates: false,
    execute: ({ id }) =>
      Themes.use((service) => service.theme(id)).pipe(Effect.provide(Themes.layer))
  }),
  selected_theme: defineTool({
    description: 'Read the selected theme ID, or null for the default.',
    wiki: {
      when: 'Find the currently selected theme.',
      examples: ['Which theme is active?'],
      limits: 'Light, dark and system appearance are separate general settings.'
    },
    input: Schema.Record(Schema.String, Schema.Never),
    output: Schema.NullOr(Schema.String),
    mutates: false,
    execute: () =>
      Themes.use((service) => service.selectedTheme()).pipe(Effect.provide(Themes.layer))
  }),
  select_theme: defineTool({
    description: 'Select an existing theme, or restore the default using null.',
    wiki: {
      when: 'The user asks to switch themes.',
      examples: ['Switch to my Ocean theme.'],
      limits: 'Read available IDs first. Does not change light/dark/system mode.'
    },
    input: selectThemeInputSchema,
    output: Schema.Boolean,
    mutates: true,
    execute: (input) =>
      Themes.use((service) => service.selectTheme(input)).pipe(
        Effect.as(true),
        Effect.provide(Themes.layer)
      )
  }),
  save_theme: defineTool({
    description: 'Create or replace a custom theme using its complete validated definition.',
    wiki: {
      when: 'The user requests a custom theme or edits to an existing one.',
      examples: ['Make my custom theme a little warmer.'],
      limits:
        'Read an existing theme first and preserve unrelated tokens. Built-in themes cannot be overwritten; use a new custom ID.'
    },
    input: themeFileSchema,
    output: themeFileSchema,
    mutates: true,
    execute: (theme) =>
      Themes.use((service) => service.saveTheme({ json: serializeTheme(theme) })).pipe(
        Effect.provide(Themes.layer)
      )
  }),
  delete_theme: defineTool({
    description: 'Delete a custom theme; a deleted active theme falls back to the default.',
    wiki: {
      when: 'The user explicitly asks to delete a named custom theme.',
      examples: ['Delete my Ocean theme.'],
      limits:
        'Resolve its exact ID first. Built-in themes cannot be deleted. Deletion is permanent.'
    },
    input: themeIdInputSchema,
    output: Schema.Boolean,
    mutates: true,
    execute: (input) =>
      Themes.use((service) => service.deleteTheme(input)).pipe(
        Effect.as(true),
        Effect.provide(Themes.layer)
      )
  })
} as const;
