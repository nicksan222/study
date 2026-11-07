/** Provider-neutral transfer contracts; providers normalize external formats into these inputs. */
import { Schema } from 'effect';

import { errorKindSchema } from '../errors.ts';
import { projectIdSchema, sessionIdSchema } from '../ids.ts';

export const MAX_INTEGRATION_BYTES = 32 * 1024 * 1024;

const integrationCapabilitySchema = Schema.Literals(['import', 'export']);

const integrationProviderIdSchema = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9-]{0,63}$/));

export const integrationProviderSchema = Schema.Struct({
  id: integrationProviderIdSchema,
  capabilities: Schema.Array(integrationCapabilitySchema)
});

const integrationFileSchema = Schema.Struct({
  path: Schema.String.check(Schema.isBetweenLength(1, 1024)),
  content: Schema.String.check(Schema.isMaxLength(Math.ceil(MAX_INTEGRATION_BYTES / 3) * 4))
});

export const integrationInputSchema = Schema.Struct({
  files: Schema.Array(integrationFileSchema).check(Schema.isBetweenLength(1, 10000))
});

export const integrationWarningSchema = Schema.Struct({
  code: Schema.Literals([
    'empty_note',
    'oversized_note',
    'missing_link',
    'ambiguous_link',
    'missing_attachment',
    'embedded_note',
    'unsupported_file'
  ]),
  path: Schema.String,
  target: Schema.NullOr(Schema.String)
});

export const integrationSessionSchema = Schema.Struct({
  key: Schema.String,
  title: Schema.String.check(Schema.isBetweenLength(1, 200)),
  /** Original Markdown, before Study's canonical source decoder runs. */
  text: Schema.String.check(Schema.isBetweenLength(1, 100000)),
  metadata: Schema.NullOr(Schema.String),
  attachments: Schema.Array(Schema.String),
  links: Schema.Array(
    Schema.Struct({
      raw: Schema.String,
      target: Schema.String,
      label: Schema.String,
      fragment: Schema.String,
      embedded: Schema.Boolean,
      start: Schema.Int,
      end: Schema.Int
    })
  )
});

export const integrationPlanSchema = Schema.Struct({
  sessions: Schema.Array(integrationSessionSchema).check(Schema.isMaxLength(2000)),
  files: Schema.Array(integrationFileSchema),
  warnings: Schema.Array(integrationWarningSchema)
});

export const integrationImportIdSchema = Schema.String.check(Schema.isUUID()).pipe(
  Schema.brand('IntegrationImportId')
);

export const previewIntegrationInputSchema = Schema.Struct({
  ...integrationInputSchema.fields,
  providerId: integrationProviderIdSchema,
  sourceKey: Schema.Trim.check(Schema.isBetweenLength(1, 200))
});

export const integrationImportKeySchema = Schema.Struct({ id: integrationImportIdSchema });

export const startIntegrationImportSchema = Schema.Struct({
  ...integrationImportKeySchema.fields,
  projectId: Schema.optional(projectIdSchema),
  excludedKeys: Schema.Array(Schema.String).check(Schema.isMaxLength(2000))
});

const integrationImportItemSchema = Schema.Struct({
  key: Schema.String,
  title: Schema.String,
  status: Schema.Literals(['pending', 'imported', 'unchanged', 'conflict', 'excluded', 'failed']),
  sessionId: Schema.NullOr(sessionIdSchema),
  errorKind: Schema.NullOr(errorKindSchema)
});

export const integrationImportSchema = Schema.Struct({
  id: integrationImportIdSchema,
  providerId: integrationProviderIdSchema,
  sourceKey: Schema.String,
  status: Schema.Literals(['preview', 'running', 'completed', 'cancelled', 'failed']),
  /** Original destination scope; retained for identity even if that project is later deleted. */
  projectId: Schema.NullOr(projectIdSchema),
  attempt: Schema.Int,
  items: Schema.Array(integrationImportItemSchema),
  warnings: Schema.Array(integrationWarningSchema),
  errorKind: Schema.NullOr(errorKindSchema)
});
