import { defineRule } from 'vite-plus/lint/plugins';

import { persistenceWriters } from './persistence-writers.ts';
import { production } from './synchronous-transactions.ts';

const groups: Record<string, string[]> = {
  projects: ['projects'],
  integrations: [
    'integration_imports',
    'integration_import_notes',
    'integration_import_files',
    'integration_receipts'
  ],
  search: ['semantic_search_entries'],
  'projects,materials': ['project_materials'],
  'projects,notes': ['project_notes'],
  sources: [
    'sources',
    'source_blobs',
    'source_processing',
    'source_snapshots',
    'source_extraction_revisions',
    'note_sources',
    'source_recording_imports'
  ],
  'sources,pages': ['content_snapshots', 'blocks', 'chunks'],
  notes: [
    'assistant_chat_starts',
    'assistant_memory',
    'assistant_tool_receipts',
    'notes',
    'messages',
    'message_versions',
    'message_parts',
    'citations',
    'note_recording_posts',
    'note_question_answers',
    'note_reply_requests',
    'note_reply_sources',
    'note_context_pages',
    'note_context_sources',
    'note_retired_intents',
    'note_run_contexts',
    'note_deletions',
    'note_merges',
    'note_sidebar_preferences',
    'note_deletion_correlations'
  ],
  pages: [
    'pages',
    'page_versions',
    'page_version_parents',
    'page_edit_receipts',
    'page_inputs',
    'page_citations',
    'page_annotations',
    'page_annotation_revisions',
    'page_citation_assessments',
    'page_deletions',
    'page_retirements',
    'page_generation_requests',
    'page_transform_requests',
    'page_proposals',
    'page_proposal_receipts',
    'project_pages',
    'note_pages'
  ],
  recordings: ['recordings', 'recording_chunks', 'recording_posts'],
  materials: [
    'material_history_prunes',
    'material_history_members',
    'material_history_requests',
    'material_deletions',
    'material_deletion_members',
    'material_deletion_requests',
    'materials',
    'note_materials',
    'material_versions',
    'material_version_parents',
    'material_generation_requests',
    'material_evidence_inputs',
    'material_evidence_citations',
    'material_generation_scopes',
    'material_diagram_versions',
    'material_quiz_versions',
    'material_quiz_questions',
    'material_quiz_choices',
    'material_quiz_ordering_items',
    'material_quiz_open_answers',
    'material_flashcard_versions',
    'material_card_identities',
    'material_flashcard_entries'
  ],
  learning: [
    'material_quiz_attempts',
    'material_quiz_attempt_questions',
    'material_quiz_attempt_choices',
    'material_quiz_attempt_ordering_items',
    'material_quiz_responses',
    'material_quiz_selections',
    'material_card_schedules',
    'material_card_reviews',
    'learning_practice_controls',
    'learning_practice_slots',
    'learning_practice_inputs'
  ],
  themes: ['themes'],
  'settings,auth,themes': ['preferences'],
  readonly: [
    'ai_usage',
    'document_assets',
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
    'workflow_retired_correlations',
    'workflow_retired_executions',
    'workflow_executions',
    'workflow_activities',
    'workflow_agent_progress',
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
