import { sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const codes_source_origin = sqliteTable('codes_source_origin', {
  code: text({
    enum: ['attachment', 'import', 'note', 'recording', 'web']
  }).primaryKey()
});

export const codes_source_kind = sqliteTable('codes_source_kind', {
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

export const codes_title_source = sqliteTable('codes_title_source', {
  code: text({ enum: ['generated', 'provisional', 'user'] }).primaryKey()
});

export const codes_message_role = sqliteTable('codes_message_role', {
  code: text({ enum: ['assistant', 'user'] }).primaryKey()
});

export const codes_message_status = sqliteTable('codes_message_status', {
  code: text({ enum: ['complete', 'pending', 'writing'] }).primaryKey()
});

export const codes_version_origin = sqliteTable('codes_version_origin', {
  code: text({
    enum: ['answer', 'edited', 'improve', 'instruction', 'summarize', 'typed']
  }).primaryKey()
});

export const codes_artifact_kind = sqliteTable('codes_artifact_kind', {
  code: text({ enum: ['diagram', 'flashcards'] }).primaryKey()
});

export const codes_extractor_kind = sqliteTable('codes_extractor_kind', {
  code: text({
    enum: ['office', 'text', 'transcription', 'vision', 'web']
  }).primaryKey()
});

export const codes_block_kind = sqliteTable('codes_block_kind', {
  code: text({
    enum: ['code', 'heading', 'list_item', 'paragraph', 'segment', 'table']
  }).primaryKey()
});

export const codes_artifact_status = sqliteTable('codes_artifact_status', {
  code: text({ enum: ['complete', 'pending', 'writing'] }).primaryKey()
});

export const codes_rating = sqliteTable('codes_rating', {
  code: text({ enum: ['again', 'easy', 'good', 'hard'] }).primaryKey()
});

export const codes_question_kind = sqliteTable('codes_question_kind', {
  code: text({ enum: ['choice', 'open'] }).primaryKey()
});

export const codes_question_status = sqliteTable('codes_question_status', {
  code: text({
    enum: ['answered', 'graded', 'pending', 'ready', 'writing']
  }).primaryKey()
});

export const codes_verdict = sqliteTable('codes_verdict', {
  code: text({ enum: ['correct', 'incorrect', 'partly'] }).primaryKey()
});

export const codes_job_kind = sqliteTable('codes_job_kind', {
  code: text({
    enum: [
      'artifact',
      'extract',
      'fetch',
      'grade',
      'index',
      'question',
      'reply',
      'rewrite',
      'title'
    ]
  }).primaryKey()
});

export const codes_job_status = sqliteTable('codes_job_status', {
  code: text({
    enum: ['blocked', 'cancelled', 'failed', 'queued', 'running', 'succeeded', 'waiting']
  }).primaryKey()
});

export const codes_error_kind = sqliteTable('codes_error_kind', {
  code: text({
    enum: [
      'auth',
      'cancelled',
      'config',
      'internal',
      'invalid_input',
      'model_unavailable',
      'not_enough',
      'not_found',
      'rate_limited',
      'transient',
      'unsupported'
    ]
  }).primaryKey()
});

export const codes_requirement = sqliteTable('codes_requirement', {
  code: text({ enum: ['language_models'] }).primaryKey()
});
