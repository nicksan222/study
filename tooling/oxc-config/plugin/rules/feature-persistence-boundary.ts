import { defineRule } from 'vite-plus/lint/plugins';

import { persistenceWriters } from './persistence-writers.ts';
import { production } from './synchronous-transactions.ts';

const groups: Record<string, string[]> = {
  projects: ['projects'],
  search: ['semantic_search_entries'],
  'projects,materials': ['project_materials'],
  'projects,conversations': ['project_sessions'],
  sources: [
    'sources',
    'source_blobs',
    'source_processing',
    'source_snapshots',
    'source_extraction_revisions',
    'session_sources',
    'source_recording_imports'
  ],
  'sources,documents': ['content_snapshots', 'blocks', 'chunks'],
  conversations: [
    'sessions',
    'messages',
    'message_versions',
    'message_parts',
    'citations',
    'conversation_recording_posts',
    'conversation_question_answers',
    'conversation_reply_requests',
    'conversation_reply_sources',
    'session_context_documents',
    'session_context_sources',
    'session_retired_intents',
    'session_run_contexts',
    'session_deletions',
    'session_sidebar_preferences',
    'session_deletion_correlations'
  ],
  documents: [
    'study_documents',
    'study_document_versions',
    'study_document_version_parents',
    'study_document_edit_receipts',
    'study_document_inputs',
    'study_document_citations',
    'study_document_annotations',
    'study_document_annotation_revisions',
    'study_document_citation_assessments',
    'study_document_deletions',
    'study_document_retirements',
    'study_document_generation_requests',
    'study_document_transform_requests',
    'study_document_proposals',
    'study_document_proposal_receipts',
    'project_documents',
    'session_documents'
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
    'session_materials',
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
    'material_quiz_open_answers',
    'material_flashcard_versions',
    'material_card_identities',
    'material_flashcard_entries'
  ],
  learning: [
    'material_quiz_attempts',
    'material_quiz_attempt_questions',
    'material_quiz_attempt_choices',
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
