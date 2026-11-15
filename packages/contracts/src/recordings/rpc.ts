import { Schema } from 'effect';

import { failureSchema } from '../errors.ts';
import { recordingIdSchema, noteIdSchema } from '../ids.ts';
import { allDependencies, dependency, endpointGroup, liveQuery, mutation } from '../protocol.ts';
import { recordingViewSchema, recordingPostSchema } from './schemas.ts';

export const recordingPageInputSchema = Schema.Struct({
  limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 })),
  before: Schema.optional(recordingIdSchema)
});

const recordingPageSchema = Schema.Struct({
  items: Schema.Array(recordingViewSchema),
  next: Schema.NullOr(recordingIdSchema)
});

export const appendRecordingInputSchema = Schema.Struct({
  id: recordingIdSchema,
  samples: Schema.Array(
    Schema.Int.check(Schema.isBetween({ minimum: -32768, maximum: 32767 }))
  ).check(Schema.isMinLength(1), Schema.isMaxLength(960000))
});

export const postRecordingInputSchema = Schema.Struct({
  note: noteIdSchema,
  recording: recordingIdSchema,
  name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(255))
});

export const recordingsEndpoints = {
  create: mutation(
    'recordings.createRecording',
    {
      payload: { id: noteIdSchema },
      success: recordingViewSchema,
      error: failureSchema
    },
    { changes: [dependency.recordings] }
  ),
  append: mutation(
    'recordings.appendRecording',
    {
      payload: appendRecordingInputSchema,
      success: Schema.Void,
      error: failureSchema
    },
    { changes: [dependency.recordings] }
  ),
  get: liveQuery(
    'recordings.recording',
    {
      payload: { id: recordingIdSchema },
      success: recordingViewSchema,
      error: failureSchema
    },
    { dependencies: allDependencies, refresh: 'database' }
  ),
  list: liveQuery(
    'recordings.recordings',
    {
      payload: recordingPageInputSchema,
      success: recordingPageSchema,
      error: failureSchema
    },
    { dependencies: allDependencies, refresh: 'database' }
  ),
  delete: mutation(
    'recordings.deleteRecording',
    {
      payload: { id: recordingIdSchema },
      success: Schema.Boolean,
      error: failureSchema
    },
    { changes: [dependency.recordings] }
  ),
  recordingPost: liveQuery(
    'recordings.recordingPost',
    {
      payload: { requestId: Schema.String.check(Schema.isMinLength(1)) },
      success: recordingPostSchema,
      error: failureSchema
    },
    { dependencies: allDependencies, refresh: 'database' }
  ),
  postRecording: mutation(
    'recordings.postRecording',
    {
      payload: postRecordingInputSchema,
      success: recordingPostSchema,
      error: failureSchema
    },
    { changes: [dependency.recordings] }
  )
};

export const RecordingsRpc = endpointGroup(recordingsEndpoints);
