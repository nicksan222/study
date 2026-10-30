import { Schema } from 'effect';
import { Rpc, RpcGroup } from 'effect/rpc';

import { failureSchema } from '../errors.ts';
import { themeFileSchema } from './schemas.ts';

const themeIdInputSchema = Schema.Struct({ id: Schema.String });

export const themePageInputSchema = Schema.Struct({
  limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 })),
  before: Schema.optional(Schema.String)
});

const themePageSchema = Schema.Struct({
  items: Schema.Array(themeFileSchema),
  next: Schema.NullOr(Schema.String)
});

const themeJsonInputSchema = Schema.Struct({ json: Schema.String });

const selectThemeInputSchema = Schema.Struct({ id: Schema.NullOr(Schema.String) });

export const ThemesRpc = RpcGroup.make(
  Rpc.make('theme', {
    payload: themeIdInputSchema,
    success: themeFileSchema,
    error: failureSchema
  }),
  Rpc.make('findTheme', {
    payload: themeIdInputSchema,
    success: Schema.Option(themeFileSchema),
    error: failureSchema
  }),
  Rpc.make('themes', {
    payload: themePageInputSchema,
    success: themePageSchema,
    error: failureSchema
  }),
  Rpc.make('selectedTheme', {
    payload: Schema.Struct({}),
    success: Schema.NullOr(Schema.String),
    error: failureSchema
  }),
  Rpc.make('exportTheme', {
    payload: themeIdInputSchema,
    success: Schema.String,
    error: failureSchema
  }),
  Rpc.make('importTheme', {
    payload: themeJsonInputSchema,
    success: themeFileSchema,
    error: failureSchema
  }),
  Rpc.make('saveTheme', {
    payload: themeJsonInputSchema,
    success: themeFileSchema,
    error: failureSchema
  }),
  Rpc.make('deleteTheme', {
    payload: themeIdInputSchema,
    success: Schema.Void,
    error: failureSchema
  }),
  Rpc.make('selectTheme', {
    payload: selectThemeInputSchema,
    success: Schema.Void,
    error: failureSchema
  })
).prefix('themes.');
