import { Schema } from 'effect';

import { sourceKindSchema } from './sniff.ts';

export const importCapabilityInputSchema = Schema.Struct({
  kind: sourceKindSchema,
  mime: Schema.String
});

export const importCapabilitySchema = Schema.Struct({
  kind: sourceKindSchema,
  recognized: Schema.Boolean,
  status: Schema.Literals(['supported', 'unavailable']),
  path: Schema.Literals(['text', 'html', 'office', 'vision', 'audio', 'none']),
  reason: Schema.Literals(['local_decoder', 'provider_unverified', 'model_missing', 'no_decoder']),
  provider: Schema.Struct({
    authentication: Schema.Literals(['session_configured', 'signed_out', 'unavailable']),
    capability: Schema.Literal('unverified')
  })
});
