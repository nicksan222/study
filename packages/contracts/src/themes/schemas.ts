import { Schema } from 'effect';

import { themeColorKeys } from './keys.ts';

const colorsSchema = Schema.Record(Schema.Literals(themeColorKeys), Schema.optional(Schema.String));

export const themeFileSchema = Schema.Struct({
  version: Schema.Literal(1),
  id: Schema.String,
  name: Schema.String,
  colors: Schema.optional(colorsSchema),
  light: Schema.optional(colorsSchema),
  dark: Schema.optional(colorsSchema)
});
