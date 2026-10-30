import { defineRule } from 'vite-plus/lint/plugins';

import { persistenceWriters } from './persistence-writers.ts';
import { production } from './synchronous-transactions.ts';

const groups: Record<string, string[]> = {
  projects: ['projects'],
  sources: [
    'sources',
    'source_blobs',
    'source_processing',
    'source_snapshots',
    'source_recording_imports'
  ],
  'sources,materials': ['documents', 'blocks', 'chunks'],
  conversations: [
    'sessions',
    'messages',
    'message_versions',
    'message_parts',
    'citations',
    'conversation_recording_posts',
    'conversation_reply_requests'
  ],
  recordings: ['recordings', 'recording_chunks', 'recording_posts'],
  materials: [
    'materials',
    'session_materials',
    'material_versions',
    'material_version_parents',
    'material_version_inputs',
    'material_source_snapshots',
    'material_generation_requests',
    'material_generation_inputs',
    'material_generation_scopes',
    'material_file_versions',
    'material_audio_versions',
    'material_video_versions',
    'material_image_versions',
    'material_link_versions',
    'material_document_versions',
    'material_diagram_versions',
    'material_version_citations',
    'material_quiz_versions',
    'material_quiz_questions',
    'material_quiz_choices',
    'material_quiz_open_answers',
    'material_flashcard_versions',
    'material_card_identities',
    'material_flashcard_entries'
  ],
  learning: [
    'material_quiz_attempts',
    'material_quiz_responses',
    'material_quiz_selections',
    'material_card_schedules',
    'material_card_reviews',
    'learning_practice_controls',
    'learning_practice_slots'
  ],
  themes: ['themes'],
  'settings,auth,themes': ['preferences'],
  readonly: [
    'codes_source_origin',
    'codes_source_kind',
    'codes_title_source',
    'codes_message_role',
    'codes_message_status',
    'codes_version_origin',
    'codes_extractor_kind',
    'codes_block_kind'
  ],
  workflow: [
    'workflow_executions',
    'workflow_activities',
    'workflow_deferreds',
    'workflow_clocks',
    'workflow_events',
    'workflow_receipts',
    'workflow_configuration_waits'
  ]
};

export const tableOwners = Object.fromEntries(
  Object.entries(groups).flatMap(([owners, tables]) =>
    tables.map((table) => [
      table,
      owners === 'readonly' || owners === 'workflow' ? [] : owners.split(',')
    ])
  )
) as Record<string, string[]>;

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    const path = context.filename.replaceAll('\\', '/');
    const feature = /\/apps\/server\/src\/features\/([^/]+)\//.exec(path)?.[1];

    if (!feature || !production(path)) return {};

    return persistenceWriters(context, (node, table) => {
      const owners = tableOwners[table];

      if (owners && !groups.workflow.includes(table) && !owners.includes(feature))
        context.report({ node, message: `Feature ${feature} may not write ${table}.` });
    });
  }
});
