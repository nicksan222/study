import { Schema } from 'effect';

import { failureSchema } from '../errors.ts';
import { allDependencies, dependency, endpointGroup, liveQuery, mutation } from '../protocol.ts';
import { themeFileSchema, themeCatalogEntrySchema } from './schemas.ts';

export const themeIdInputSchema = Schema.Struct({ id: Schema.String });

export const themePageInputSchema = Schema.Struct({
  limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 })),
  before: Schema.optional(Schema.String)
});

export const themePageSchema = Schema.Struct({
  items: Schema.Array(themeCatalogEntrySchema),
  next: Schema.NullOr(Schema.String)
});

const themeJsonInputSchema = Schema.Struct({ json: Schema.String });

export const selectThemeInputSchema = Schema.Struct({ id: Schema.NullOr(Schema.String) });

export const themesEndpoints = {
  get: liveQuery(
    'themes.theme',
    {
      payload: themeIdInputSchema,
      success: themeFileSchema,
      error: failureSchema
    },
    { dependencies: allDependencies, refresh: 'database' }
  ),
  find: liveQuery(
    'themes.findTheme',
    {
      payload: themeIdInputSchema,
      success: Schema.Option(themeFileSchema),
      error: failureSchema
    },
    { dependencies: allDependencies, refresh: 'database' }
  ),
  list: liveQuery(
    'themes.themes',
    {
      payload: themePageInputSchema,
      success: themePageSchema,
      error: failureSchema
    },
    { dependencies: allDependencies, refresh: 'database' }
  ),
  selectedTheme: liveQuery(
    'themes.selectedTheme',
    {
      payload: Schema.Struct({}),
      success: Schema.NullOr(Schema.String),
      error: failureSchema
    },
    { dependencies: allDependencies, refresh: 'database' }
  ),
  exportTheme: liveQuery(
    'themes.exportTheme',
    {
      payload: themeIdInputSchema,
      success: Schema.String,
      error: failureSchema
    },
    { dependencies: allDependencies, refresh: 'database' }
  ),
  importTheme: mutation(
    'themes.importTheme',
    {
      payload: themeJsonInputSchema,
      success: themeFileSchema,
      error: failureSchema
    },
    { changes: [dependency.themes] }
  ),
  save: mutation(
    'themes.saveTheme',
    {
      payload: themeJsonInputSchema,
      success: themeFileSchema,
      error: failureSchema
    },
    { changes: [dependency.themes] }
  ),
  delete: mutation(
    'themes.deleteTheme',
    {
      payload: themeIdInputSchema,
      success: Schema.Void,
      error: failureSchema
    },
    { changes: [dependency.themes] }
  ),
  select: mutation(
    'themes.selectTheme',
    {
      payload: selectThemeInputSchema,
      success: Schema.Void,
      error: failureSchema
    },
    { changes: [dependency.themes] }
  )
};

export const ThemesRpc = endpointGroup(themesEndpoints);
