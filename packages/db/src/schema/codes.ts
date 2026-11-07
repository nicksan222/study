import { blockKinds } from '@study/contracts/sources/schemas';

import { defineTable, text } from '../schema-builder.ts';

export const codes_source_origin = defineTable({
  role: 'internal',
  reason: 'Closed vocabulary for schema constraints'
})('codes_source_origin', {
  code: text({
    enum: ['attachment', 'import', 'note', 'recording', 'web']
  }).primaryKey()
});

export const codes_source_kind = defineTable({
  role: 'internal',
  reason: 'Closed vocabulary for schema constraints'
})('codes_source_kind', {
  code: text({
    enum: [
      'archive',
      'audio',
      'code',
      'document',
      'image',
      'link',
      'note',
      'other',
      'pdf',
      'slides',
      'spreadsheet',
      'text',
      'video',
      'web'
    ]
  }).primaryKey()
});

export const codes_title_source = defineTable({
  role: 'internal',
  reason: 'Closed vocabulary for schema constraints'
})('codes_title_source', {
  code: text({ enum: ['generated', 'provisional', 'user'] }).primaryKey()
});

export const codes_message_role = defineTable({
  role: 'internal',
  reason: 'Closed vocabulary for schema constraints'
})('codes_message_role', {
  code: text({ enum: ['assistant', 'user'] }).primaryKey()
});

export const codes_message_status = defineTable({
  role: 'internal',
  reason: 'Closed vocabulary for schema constraints'
})('codes_message_status', {
  code: text({ enum: ['complete', 'pending', 'writing'] }).primaryKey()
});

export const codes_version_origin = defineTable({
  role: 'internal',
  reason: 'Closed vocabulary for schema constraints'
})('codes_version_origin', {
  code: text({
    enum: ['answer', 'edited', 'improve', 'instruction', 'summarize', 'typed']
  }).primaryKey()
});

export const codes_extractor_kind = defineTable({
  role: 'internal',
  reason: 'Closed vocabulary for schema constraints'
})('codes_extractor_kind', {
  code: text({
    enum: ['office', 'text', 'transcription', 'vision', 'web']
  }).primaryKey()
});

export const codes_block_kind = defineTable({
  role: 'internal',
  reason: 'Closed vocabulary for schema constraints'
})('codes_block_kind', {
  code: text({
    enum: blockKinds
  }).primaryKey()
});
