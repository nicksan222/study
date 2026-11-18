/** Bounded local dictation input; all samples are 16 kHz mono signed PCM16. */
import { Schema } from 'effect';

import { failureSchema } from '../errors.ts';
import { allDependencies, endpointGroup, liveQuery, mutation } from '../protocol.ts';

export const MAX_DICTATION_SAMPLES = 480_000;

export const dictationInputSchema = Schema.Struct({
  samples: Schema.Array(
    Schema.Int.check(Schema.isBetween({ minimum: -32768, maximum: 32767 }))
  ).check(Schema.isMinLength(1), Schema.isMaxLength(MAX_DICTATION_SAMPLES))
});

const voiceModelSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  languages: Schema.Array(Schema.String),
  languageDetection: Schema.Literal('automatic')
});

export type VoiceModel = typeof voiceModelSchema.Type;

export const voiceStatusSchema = Schema.Struct({
  modelId: Schema.String,
  models: Schema.Array(voiceModelSchema),
  state: Schema.Literals(['missing', 'downloading', 'ready']),
  downloadedBytes: Schema.Number,
  totalBytes: Schema.Number
});

const saved = Schema.Struct({});

const external = { changes: 'external' } as const;

export const voiceEndpoints = {
  status: liveQuery(
    'voice.status',
    { payload: {}, success: voiceStatusSchema, error: failureSchema },
    { dependencies: allDependencies, refresh: 'external' }
  ),
  install: mutation(
    'voice.install',
    { payload: {}, success: saved, error: failureSchema },
    external
  ),
  cancelInstall: mutation(
    'voice.cancelInstall',
    { payload: {}, success: saved, error: failureSchema },
    external
  ),
  remove: mutation('voice.remove', { payload: {}, success: saved, error: failureSchema }, external),
  transcribe: mutation(
    'voice.transcribe',
    {
      payload: dictationInputSchema,
      success: Schema.Struct({ text: Schema.String }),
      error: failureSchema
    },
    external
  )
};

export const VoiceRpc = endpointGroup(voiceEndpoints);
