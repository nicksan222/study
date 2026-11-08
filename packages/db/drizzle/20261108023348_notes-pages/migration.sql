-- Keep opaque request IDs, canonical intent digests, workflow tags, subscriptions and activity names stable for durable replay.
CREATE TEMP TABLE notes_pages_sequences AS SELECT CASE name WHEN 'conversation_reply_requests' THEN 'note_reply_requests' WHEN 'conversation_recording_posts' THEN 'note_recording_posts' WHEN 'project_sessions' THEN 'project_notes' WHEN 'session_materials' THEN 'note_materials' WHEN 'sessions' THEN 'notes' WHEN 'session_run_contexts' THEN 'note_run_contexts' WHEN 'session_deletion_correlations' THEN 'note_deletion_correlations' WHEN 'session_deletions' THEN 'note_deletions' WHEN 'session_sidebar_preferences' THEN 'note_sidebar_preferences' WHEN 'project_documents' THEN 'project_pages' WHEN 'session_documents' THEN 'note_pages' WHEN 'study_document_edit_receipts' THEN 'page_edit_receipts' WHEN 'study_document_version_parents' THEN 'page_version_parents' WHEN 'study_document_versions' THEN 'page_versions' WHEN 'study_documents' THEN 'pages' WHEN 'study_document_annotation_revisions' THEN 'page_annotation_revisions' WHEN 'study_document_annotations' THEN 'page_annotations' WHEN 'study_document_citations' THEN 'page_citations' WHEN 'study_document_deletions' THEN 'page_deletions' WHEN 'study_document_proposal_receipts' THEN 'page_proposal_receipts' WHEN 'study_document_proposals' THEN 'page_proposals' WHEN 'study_document_retirements' THEN 'page_retirements' WHEN 'study_document_citation_assessments' THEN 'page_citation_assessments' WHEN 'study_document_generation_requests' THEN 'page_generation_requests' WHEN 'session_sources' THEN 'note_sources' WHEN 'study_document_transform_requests' THEN 'page_transform_requests' WHEN 'session_context_documents' THEN 'note_context_pages' WHEN 'session_context_sources' THEN 'note_context_sources' WHEN 'session_retired_intents' THEN 'note_retired_intents' WHEN 'conversation_reply_sources' THEN 'note_reply_sources' WHEN 'study_document_inputs' THEN 'page_inputs' WHEN 'conversation_question_answers' THEN 'note_question_answers' WHEN 'session_merges' THEN 'note_merges' ELSE name END AS name,seq FROM sqlite_sequence;
--> statement-breakpoint
-- Preserve all installed authority and search guards across Drizzle table rebuilds.
DROP TRIGGER "authored_source_blocks_delete";
--> statement-breakpoint
DROP TRIGGER "authored_source_blocks_insert";
--> statement-breakpoint
DROP TRIGGER "authored_source_blocks_update";
--> statement-breakpoint
DROP TRIGGER "authored_source_content_snapshots_delete";
--> statement-breakpoint
DROP TRIGGER "authored_source_content_snapshots_update";
--> statement-breakpoint
DROP TRIGGER "authored_source_revision_update";
--> statement-breakpoint
DROP TRIGGER "catalog_project_delete";
--> statement-breakpoint
DROP TRIGGER "catalog_project_insert";
--> statement-breakpoint
DROP TRIGGER "catalog_project_update";
--> statement-breakpoint
DROP TRIGGER "catalog_session_delete";
--> statement-breakpoint
DROP TRIGGER "catalog_session_insert";
--> statement-breakpoint
DROP TRIGGER "catalog_session_update";
--> statement-breakpoint
DROP TRIGGER "catalog_source_delete";
--> statement-breakpoint
DROP TRIGGER "catalog_source_insert";
--> statement-breakpoint
DROP TRIGGER "catalog_source_update";
--> statement-breakpoint
DROP TRIGGER "chunks_fts_ad";
--> statement-breakpoint
DROP TRIGGER "chunks_fts_ai";
--> statement-breakpoint
DROP TRIGGER "chunks_fts_au";
--> statement-breakpoint
DROP TRIGGER "conversation_recording_posts_immutable";
--> statement-breakpoint
DROP TRIGGER "conversation_recording_posts_retain";
--> statement-breakpoint
DROP TRIGGER "conversation_recording_posts_validate_insert";
--> statement-breakpoint
DROP TRIGGER "conversation_reply_sources_capture";
--> statement-breakpoint
DROP TRIGGER "conversation_reply_sources_immutable";
--> statement-breakpoint
DROP TRIGGER "conversation_reply_sources_retained";
--> statement-breakpoint
DROP TRIGGER "document_asset_insert";
--> statement-breakpoint
DROP TRIGGER "document_asset_kind";
--> statement-breakpoint
DROP TRIGGER "document_asset_snapshot_delete";
--> statement-breakpoint
DROP TRIGGER "document_asset_snapshot_update";
--> statement-breakpoint
DROP TRIGGER "document_asset_update";
--> statement-breakpoint
DROP TRIGGER "document_asset_update_forbidden";
--> statement-breakpoint
DROP TRIGGER "generation_history_publication";
--> statement-breakpoint
DROP TRIGGER "learning_practice_control_identity";
--> statement-breakpoint
DROP TRIGGER "learning_practice_control_retained";
--> statement-breakpoint
DROP TRIGGER "learning_practice_failure_clear";
--> statement-breakpoint
DROP TRIGGER "learning_practice_inputs_available";
--> statement-breakpoint
DROP TRIGGER "learning_practice_inputs_capture";
--> statement-breakpoint
DROP TRIGGER "learning_practice_inputs_immutable";
--> statement-breakpoint
DROP TRIGGER "learning_practice_inputs_retained";
--> statement-breakpoint
DROP TRIGGER "learning_practice_retry_capture";
--> statement-breakpoint
DROP TRIGGER "learning_practice_retry_transition";
--> statement-breakpoint
DROP TRIGGER "learning_practice_selection_delete";
--> statement-breakpoint
DROP TRIGGER "learning_practice_selection_insert";
--> statement-breakpoint
DROP TRIGGER "learning_practice_selection_update";
--> statement-breakpoint
DROP TRIGGER "learning_practice_slot_capture";
--> statement-breakpoint
DROP TRIGGER "learning_practice_slot_immutable";
--> statement-breakpoint
DROP TRIGGER "learning_practice_slot_retained";
--> statement-breakpoint
DROP TRIGGER "material_attempt_delete";
--> statement-breakpoint
DROP TRIGGER "material_attempt_identity";
--> statement-breakpoint
DROP TRIGGER "material_attempt_published";
--> statement-breakpoint
DROP TRIGGER "material_card_identity_update";
--> statement-breakpoint
DROP TRIGGER "material_card_reviews_history_insert";
--> statement-breakpoint
DROP TRIGGER "material_deletion_identity";
--> statement-breakpoint
DROP TRIGGER "material_deletion_member_valid";
--> statement-breakpoint
DROP TRIGGER "material_deletion_members_delete_retained";
--> statement-breakpoint
DROP TRIGGER "material_deletion_members_update_retained";
--> statement-breakpoint
DROP TRIGGER "material_deletion_publication";
--> statement-breakpoint
DROP TRIGGER "material_deletion_requests_owned";
--> statement-breakpoint
DROP TRIGGER "material_deletion_requests_delete_retained";
--> statement-breakpoint
DROP TRIGGER "material_deletion_requests_update_retained";
--> statement-breakpoint
DROP TRIGGER "material_deletion_retained";
--> statement-breakpoint
DROP TRIGGER "material_deletion_title";
--> statement-breakpoint
DROP TRIGGER "material_deletion_version_insert";
--> statement-breakpoint
DROP TRIGGER "material_diagram_versions_delete_draft";
--> statement-breakpoint
DROP TRIGGER "material_diagram_versions_deletion_insert";
--> statement-breakpoint
DROP TRIGGER "material_diagram_versions_history_insert";
--> statement-breakpoint
DROP TRIGGER "material_diagram_versions_history_update";
--> statement-breakpoint
DROP TRIGGER "material_diagram_versions_insert_draft";
--> statement-breakpoint
DROP TRIGGER "material_diagram_versions_update_draft";
--> statement-breakpoint
DROP TRIGGER "material_evidence_citations_draft";
--> statement-breakpoint
DROP TRIGGER "material_evidence_citations_immutable";
--> statement-breakpoint
DROP TRIGGER "material_evidence_citations_retained";
--> statement-breakpoint
DROP TRIGGER "material_evidence_inputs_available";
--> statement-breakpoint
DROP TRIGGER "material_evidence_inputs_immutable";
--> statement-breakpoint
DROP TRIGGER "material_evidence_inputs_owner";
--> statement-breakpoint
DROP TRIGGER "material_evidence_inputs_retained";
--> statement-breakpoint
DROP TRIGGER "material_flashcard_entries_delete_draft";
--> statement-breakpoint
DROP TRIGGER "material_flashcard_entries_deletion_insert";
--> statement-breakpoint
DROP TRIGGER "material_flashcard_entries_history_insert";
--> statement-breakpoint
DROP TRIGGER "material_flashcard_entries_history_update";
--> statement-breakpoint
DROP TRIGGER "material_flashcard_entries_insert_draft";
--> statement-breakpoint
DROP TRIGGER "material_flashcard_entries_update_draft";
--> statement-breakpoint
DROP TRIGGER "material_flashcard_versions_delete_draft";
--> statement-breakpoint
DROP TRIGGER "material_flashcard_versions_deletion_insert";
--> statement-breakpoint
DROP TRIGGER "material_flashcard_versions_history_insert";
--> statement-breakpoint
DROP TRIGGER "material_flashcard_versions_history_update";
--> statement-breakpoint
DROP TRIGGER "material_flashcard_versions_insert_draft";
--> statement-breakpoint
DROP TRIGGER "material_flashcard_versions_update_draft";
--> statement-breakpoint
DROP TRIGGER "material_generation_binding_immutable";
--> statement-breakpoint
DROP TRIGGER "material_generation_cancel_fence";
--> statement-breakpoint
DROP TRIGGER "material_generation_intent_immutable";
--> statement-breakpoint
DROP TRIGGER "material_generation_intent_insert";
--> statement-breakpoint
DROP TRIGGER "material_generation_intent_retained";
--> statement-breakpoint
DROP TRIGGER "material_generation_publication_scope";
--> statement-breakpoint
DROP TRIGGER "material_generation_question_specification";
--> statement-breakpoint
DROP TRIGGER "material_generation_receipt_scope";
--> statement-breakpoint
DROP TRIGGER "material_generation_request_scope";
--> statement-breakpoint
DROP TRIGGER "material_generation_result_immutable";
--> statement-breakpoint
DROP TRIGGER "material_generation_scope_immutable";
--> statement-breakpoint
DROP TRIGGER "material_generation_scope_retained";
--> statement-breakpoint
DROP TRIGGER "material_generation_active_publication";
--> statement-breakpoint
DROP TRIGGER "material_generation_session_scope";
--> statement-breakpoint
DROP TRIGGER "material_history_members_delete";
--> statement-breakpoint
DROP TRIGGER "material_history_members_update";
--> statement-breakpoint
DROP TRIGGER "material_history_members_valid";
--> statement-breakpoint
DROP TRIGGER "material_history_prunes_identity";
--> statement-breakpoint
DROP TRIGGER "material_history_prunes_retained";
--> statement-breakpoint
DROP TRIGGER "material_history_prunes_valid";
--> statement-breakpoint
DROP TRIGGER "material_history_requests_delete";
--> statement-breakpoint
DROP TRIGGER "material_history_requests_update";
--> statement-breakpoint
DROP TRIGGER "material_history_requests_owned";
--> statement-breakpoint
DROP TRIGGER "material_identity_update";
--> statement-breakpoint
DROP TRIGGER "material_publish_flashcards";
--> statement-breakpoint
DROP TRIGGER "material_quiz_attempts_history_insert";
--> statement-breakpoint
DROP TRIGGER "material_quiz_selections_completed_delete";
--> statement-breakpoint
DROP TRIGGER "material_quiz_selections_completed_insert";
--> statement-breakpoint
DROP TRIGGER "material_quiz_selections_completed_update";
--> statement-breakpoint
DROP TRIGGER "material_quiz_versions_delete_draft";
--> statement-breakpoint
DROP TRIGGER "material_quiz_versions_deletion_insert";
--> statement-breakpoint
DROP TRIGGER "material_quiz_versions_history_insert";
--> statement-breakpoint
DROP TRIGGER "material_quiz_versions_history_update";
--> statement-breakpoint
DROP TRIGGER "material_quiz_versions_insert_draft";
--> statement-breakpoint
DROP TRIGGER "material_quiz_versions_update_draft";
--> statement-breakpoint
DROP TRIGGER "material_review_delete";
--> statement-breakpoint
DROP TRIGGER "material_review_published";
--> statement-breakpoint
DROP TRIGGER "material_review_update";
--> statement-breakpoint
DROP TRIGGER "material_version_parents_delete_draft";
--> statement-breakpoint
DROP TRIGGER "material_version_parents_history_capture";
--> statement-breakpoint
DROP TRIGGER "material_version_parents_history_insert";
--> statement-breakpoint
DROP TRIGGER "material_version_parents_history_update";
--> statement-breakpoint
DROP TRIGGER "material_version_parents_insert_draft";
--> statement-breakpoint
DROP TRIGGER "material_version_parents_target_insert";
--> statement-breakpoint
DROP TRIGGER "material_version_parents_target_update";
--> statement-breakpoint
DROP TRIGGER "material_version_parents_update_draft";
--> statement-breakpoint
DROP TRIGGER "material_versions_delete_frozen";
--> statement-breakpoint
DROP TRIGGER "material_versions_frozen";
--> statement-breakpoint
DROP TRIGGER "material_versions_publish_payload";
--> statement-breakpoint
DROP TRIGGER "material_versions_start_draft";
--> statement-breakpoint
DROP TRIGGER "message_fts_ad";
--> statement-breakpoint
DROP TRIGGER "message_fts_ai";
--> statement-breakpoint
DROP TRIGGER "message_fts_finish";
--> statement-breakpoint
DROP TRIGGER "recording_chunks_captured_delete";
--> statement-breakpoint
DROP TRIGGER "recording_chunks_captured_insert";
--> statement-breakpoint
DROP TRIGGER "recording_chunks_captured_update";
--> statement-breakpoint
DROP TRIGGER "recording_posts_immutable";
--> statement-breakpoint
DROP TRIGGER "recording_posts_result_valid";
--> statement-breakpoint
DROP TRIGGER "recording_posts_retain";
--> statement-breakpoint
DROP TRIGGER "recording_posts_validate_insert";
--> statement-breakpoint
DROP TRIGGER "recordings_captured_update";
--> statement-breakpoint
DROP TRIGGER "retired_event_insert";
--> statement-breakpoint
DROP TRIGGER "retired_event_payload";
--> statement-breakpoint
DROP TRIGGER "retired_execution_insert";
--> statement-breakpoint
DROP TRIGGER "retired_execution_payload";
--> statement-breakpoint
DROP TRIGGER "session_deletion_correlations_delete_retained";
--> statement-breakpoint
DROP TRIGGER "session_deletion_correlations_update_retained";
--> statement-breakpoint
DROP TRIGGER "session_deletion_identity";
--> statement-breakpoint
DROP TRIGGER "session_deletion_retained";
--> statement-breakpoint
DROP TRIGGER "session_id_not_reusable";
--> statement-breakpoint
DROP TRIGGER "session_retired_intent_recapture";
--> statement-breakpoint
DROP TRIGGER "session_retired_intents_delete";
--> statement-breakpoint
DROP TRIGGER "session_retired_intents_owner";
--> statement-breakpoint
DROP TRIGGER "session_retired_intents_update";
--> statement-breakpoint
DROP TRIGGER "session_run_contexts_immutable";
--> statement-breakpoint
DROP TRIGGER "source_extraction_revision_owner";
--> statement-breakpoint
DROP TRIGGER "source_extraction_revisions_insert";
--> statement-breakpoint
DROP TRIGGER "source_extraction_revisions_update";
--> statement-breakpoint
DROP TRIGGER "source_recording_bytes_frozen";
--> statement-breakpoint
DROP TRIGGER "source_recording_bytes_retained";
--> statement-breakpoint
DROP TRIGGER "source_recording_capture_frozen";
--> statement-breakpoint
DROP TRIGGER "source_recording_imports_immutable";
--> statement-breakpoint
DROP TRIGGER "source_recording_imports_retain";
--> statement-breakpoint
DROP TRIGGER "source_recording_imports_validate_insert";
--> statement-breakpoint
DROP TRIGGER "source_snapshots_published_delete";
--> statement-breakpoint
DROP TRIGGER "source_snapshots_published_update";
--> statement-breakpoint
DROP TRIGGER "study_document_annotation_head";
--> statement-breakpoint
DROP TRIGGER "study_document_annotation_revision_owner";
--> statement-breakpoint
DROP TRIGGER "study_document_annotation_revisions_delete";
--> statement-breakpoint
DROP TRIGGER "study_document_annotation_revisions_update";
--> statement-breakpoint
DROP TRIGGER "study_document_annotation_snapshot";
--> statement-breakpoint
DROP TRIGGER "study_document_annotations_delete";
--> statement-breakpoint
DROP TRIGGER "study_document_blocks_delete";
--> statement-breakpoint
DROP TRIGGER "study_document_blocks_insert";
--> statement-breakpoint
DROP TRIGGER "study_document_blocks_update";
--> statement-breakpoint
DROP TRIGGER "study_document_citation_assessments_immutable_update";
--> statement-breakpoint
DROP TRIGGER "study_document_citations_delete";
--> statement-breakpoint
DROP TRIGGER "study_document_citations_insert";
--> statement-breakpoint
DROP TRIGGER "study_document_citations_update";
--> statement-breakpoint
DROP TRIGGER "study_document_content_snapshots_delete";
--> statement-breakpoint
DROP TRIGGER "study_document_content_snapshots_update";
--> statement-breakpoint
DROP TRIGGER "study_document_document_assets_delete";
--> statement-breakpoint
DROP TRIGGER "study_document_document_assets_insert";
--> statement-breakpoint
DROP TRIGGER "study_document_document_assets_update";
--> statement-breakpoint
DROP TRIGGER "study_document_edit_receipts_delete";
--> statement-breakpoint
DROP TRIGGER "study_document_edit_receipts_update";
--> statement-breakpoint
DROP TRIGGER "study_document_generation_intent";
--> statement-breakpoint
DROP TRIGGER "study_document_input_message";
--> statement-breakpoint
DROP TRIGGER "study_document_input_publication";
--> statement-breakpoint
DROP TRIGGER "study_document_inputs_delete";
--> statement-breakpoint
DROP TRIGGER "study_document_inputs_insert";
--> statement-breakpoint
DROP TRIGGER "study_document_inputs_update";
--> statement-breakpoint
DROP TRIGGER "study_document_parents_delete";
--> statement-breakpoint
DROP TRIGGER "study_document_parents_insert";
--> statement-breakpoint
DROP TRIGGER "study_document_parents_update";
--> statement-breakpoint
DROP TRIGGER "study_document_proposal_receipts_immutable_update";
--> statement-breakpoint
DROP TRIGGER "study_document_proposals_immutable_update";
--> statement-breakpoint
DROP TRIGGER "study_document_retirement_dependencies";
--> statement-breakpoint
DROP TRIGGER "study_document_retirements_delete";
--> statement-breakpoint
DROP TRIGGER "study_document_retirements_update";
--> statement-breakpoint
DROP TRIGGER "study_document_source_input";
--> statement-breakpoint
DROP TRIGGER "study_document_transform_intent_immutable";
--> statement-breakpoint
DROP TRIGGER "study_document_transform_publication_owner";
--> statement-breakpoint
DROP TRIGGER "study_document_versions_draft_identity";
--> statement-breakpoint
DROP TRIGGER "study_document_versions_draft_insert";
--> statement-breakpoint
DROP TRIGGER "study_document_versions_publish";
--> statement-breakpoint
DROP TRIGGER "study_document_versions_sealed_delete";
--> statement-breakpoint
DROP TRIGGER "study_document_versions_sealed_update";
--> statement-breakpoint
DROP TRIGGER "study_document_versions_snapshot_owner";
--> statement-breakpoint
DROP TRIGGER "workflow_activities_retired_insert";
--> statement-breakpoint
DROP TRIGGER "workflow_clocks_retired_insert";
--> statement-breakpoint
DROP TRIGGER "workflow_configuration_waits_retired_insert";
--> statement-breakpoint
DROP TRIGGER "workflow_deferreds_retired_insert";
--> statement-breakpoint
DROP TRIGGER "workflow_retired_correlations_delete_retained";
--> statement-breakpoint
DROP TRIGGER "workflow_retired_correlations_update_retained";
--> statement-breakpoint
DROP TRIGGER "workflow_retired_executions_delete_retained";
--> statement-breakpoint
DROP TRIGGER "workflow_retired_executions_update_retained";
--> statement-breakpoint
DROP TRIGGER "study_document_retained_content_snapshots_insert";
--> statement-breakpoint
DROP TRIGGER "study_document_retained_content_snapshots_update";
--> statement-breakpoint
DROP TRIGGER "study_document_retained_content_snapshots_delete";
--> statement-breakpoint
DROP TRIGGER "study_document_retained_blocks_insert";
--> statement-breakpoint
DROP TRIGGER "study_document_retained_blocks_update";
--> statement-breakpoint
DROP TRIGGER "study_document_retained_blocks_delete";
--> statement-breakpoint
DROP TRIGGER "study_document_retained_document_assets_insert";
--> statement-breakpoint
DROP TRIGGER "study_document_retained_document_assets_update";
--> statement-breakpoint
DROP TRIGGER "study_document_retained_document_assets_delete";
--> statement-breakpoint
DROP TRIGGER "study_document_retained_study_document_versions_update";
--> statement-breakpoint
DROP TRIGGER "study_document_retained_study_document_versions_delete";
--> statement-breakpoint
DROP TRIGGER "study_document_retained_study_document_version_parents_insert";
--> statement-breakpoint
DROP TRIGGER "study_document_retained_study_document_version_parents_update";
--> statement-breakpoint
DROP TRIGGER "study_document_retained_study_document_version_parents_delete";
--> statement-breakpoint
DROP TRIGGER "study_document_retained_study_document_inputs_insert";
--> statement-breakpoint
DROP TRIGGER "study_document_retained_study_document_inputs_update";
--> statement-breakpoint
DROP TRIGGER "study_document_retained_study_document_inputs_delete";
--> statement-breakpoint
DROP TRIGGER "study_document_retained_study_document_citations_insert";
--> statement-breakpoint
DROP TRIGGER "study_document_retained_study_document_citations_update";
--> statement-breakpoint
DROP TRIGGER "study_document_retained_study_document_citations_delete";
--> statement-breakpoint
DROP TRIGGER "conversation_reply_requests_active_insert";
--> statement-breakpoint
DROP TRIGGER "conversation_reply_requests_active_update";
--> statement-breakpoint
DROP TRIGGER "session_run_contexts_active_request";
--> statement-breakpoint
DROP TRIGGER "conversation_reply_version_active_insert";
--> statement-breakpoint
DROP TRIGGER "conversation_reply_version_active_update";
--> statement-breakpoint
DROP TRIGGER "session_selection_exact_inputs";
--> statement-breakpoint
DROP TRIGGER "study_document_citation_assessments_retained";
--> statement-breakpoint
DROP TRIGGER "study_document_citation_assessments_exact_user_insert";
--> statement-breakpoint
DROP TRIGGER "source_extraction_blocks_insert";
--> statement-breakpoint
DROP TRIGGER "source_extraction_blocks_update";
--> statement-breakpoint
DROP TRIGGER "source_extraction_blocks_delete";
--> statement-breakpoint
DROP TRIGGER "source_extraction_document_assets_insert";
--> statement-breakpoint
DROP TRIGGER "source_extraction_document_assets_update";
--> statement-breakpoint
DROP TRIGGER "source_extraction_document_assets_delete";
--> statement-breakpoint
DROP TRIGGER "source_extraction_content_snapshots_update";
--> statement-breakpoint
DROP TRIGGER "source_extraction_content_snapshots_delete";
--> statement-breakpoint
DROP TRIGGER "source_extraction_identity_update";
--> statement-breakpoint
DROP TRIGGER "material_generation_input_project";
--> statement-breakpoint
DROP TRIGGER "material_generation_publication_input_project";
--> statement-breakpoint
DROP TRIGGER "material_generation_receipt_input_project";
--> statement-breakpoint
DROP TRIGGER "study_document_publication_locations";
--> statement-breakpoint
DROP TRIGGER "study_document_generation_base_insert";
--> statement-breakpoint
DROP TRIGGER "study_document_generation_base_update";
--> statement-breakpoint
DROP TRIGGER "study_document_proposal_exact_owner";
--> statement-breakpoint
DROP TRIGGER "study_document_generation_requests_retained_delete";
--> statement-breakpoint
DROP TRIGGER "study_document_proposals_retained_delete";
--> statement-breakpoint
DROP TRIGGER "study_document_proposal_receipt_exact_owner";
--> statement-breakpoint
DROP TRIGGER "study_document_proposal_receipts_retained_delete";
--> statement-breakpoint
DROP TRIGGER "source_extraction_citation_retained";
--> statement-breakpoint
DROP TRIGGER "source_citation_retained";
--> statement-breakpoint
DROP TRIGGER "study_document_citation_retained";
--> statement-breakpoint
DROP TRIGGER "study_document_generation_result_insert";
--> statement-breakpoint
DROP TRIGGER "study_document_generation_result_update";
--> statement-breakpoint
DROP TRIGGER "study_document_transform_result_hash";
--> statement-breakpoint
DROP TRIGGER "material_generation_publish";
--> statement-breakpoint
DROP TRIGGER "material_generation_receipt_valid";
--> statement-breakpoint
DROP TRIGGER "material_generation_auto_title_specification";
--> statement-breakpoint
DROP TRIGGER "catalog_native_material_delete";
--> statement-breakpoint
DROP TRIGGER "catalog_native_material_update";
--> statement-breakpoint
DROP TRIGGER "catalog_native_question_delete";
--> statement-breakpoint
DROP TRIGGER "catalog_native_version_delete";
--> statement-breakpoint
DROP TRIGGER "catalog_native_version_insert";
--> statement-breakpoint
DROP TRIGGER "catalog_native_version_update";
--> statement-breakpoint
DROP TRIGGER "learning_practice_answer_immutable";
--> statement-breakpoint
DROP TRIGGER "learning_practice_slot_answer";
--> statement-breakpoint
DROP TRIGGER "learning_practice_slot_publication";
--> statement-breakpoint
DROP TRIGGER "material_attempt_complete_answers";
--> statement-breakpoint
DROP TRIGGER "material_deletion_search";
--> statement-breakpoint
DROP TRIGGER "material_generation_question_publication";
--> statement-breakpoint
DROP TRIGGER "material_publish_quiz";
--> statement-breakpoint
DROP TRIGGER "material_quiz_choices_delete_draft";
--> statement-breakpoint
DROP TRIGGER "material_quiz_choices_insert_draft";
--> statement-breakpoint
DROP TRIGGER "material_quiz_choices_update_draft";
--> statement-breakpoint
DROP TRIGGER "material_quiz_open_answers_delete_draft";
--> statement-breakpoint
DROP TRIGGER "material_quiz_open_answers_insert_draft";
--> statement-breakpoint
DROP TRIGGER "material_quiz_open_answers_update_draft";
--> statement-breakpoint
DROP TRIGGER "material_quiz_questions_delete_draft";
--> statement-breakpoint
DROP TRIGGER "material_quiz_questions_deletion_insert";
--> statement-breakpoint
DROP TRIGGER "material_quiz_questions_history_insert";
--> statement-breakpoint
DROP TRIGGER "material_quiz_questions_history_update";
--> statement-breakpoint
DROP TRIGGER "material_quiz_questions_insert_draft";
--> statement-breakpoint
DROP TRIGGER "material_quiz_questions_update_draft";
--> statement-breakpoint
DROP TRIGGER "material_quiz_responses_completed_delete";
--> statement-breakpoint
DROP TRIGGER "material_quiz_responses_completed_insert";
--> statement-breakpoint
DROP TRIGGER "material_quiz_responses_completed_update";
--> statement-breakpoint
DROP TRIGGER "material_selection_single_insert";
--> statement-breakpoint
DROP TRIGGER "material_selection_single_update";
--> statement-breakpoint
DROP TRIGGER "material_quiz_ordering_items_delete_draft";
--> statement-breakpoint
DROP TRIGGER "material_quiz_ordering_items_insert_draft";
--> statement-breakpoint
DROP TRIGGER "material_quiz_ordering_items_update_draft";
--> statement-breakpoint
DROP TRIGGER "material_ordering_response_insert";
--> statement-breakpoint
DROP TRIGGER "material_ordering_response_update";
--> statement-breakpoint
DROP TRIGGER "material_matching_pairs_insert";
--> statement-breakpoint
DROP TRIGGER "material_matching_answer_insert";
--> statement-breakpoint
DROP TRIGGER "material_matching_order_insert";
--> statement-breakpoint
DROP TRIGGER "material_matching_pairs_update";
--> statement-breakpoint
DROP TRIGGER "material_matching_answer_update";
--> statement-breakpoint
DROP TRIGGER "material_matching_order_update";
--> statement-breakpoint
DROP TRIGGER "material_matching_order_immutable";
--> statement-breakpoint
ALTER TABLE `session_deletion_correlations` RENAME TO `note_deletion_correlations`;--> statement-breakpoint
ALTER TABLE `session_deletions` RENAME TO `note_deletions`;--> statement-breakpoint
ALTER TABLE `session_merges` RENAME TO `note_merges`;--> statement-breakpoint
ALTER TABLE `conversation_question_answers` RENAME TO `note_question_answers`;--> statement-breakpoint
ALTER TABLE `conversation_reply_requests` RENAME TO `note_reply_requests`;--> statement-breakpoint
ALTER TABLE `session_run_contexts` RENAME TO `note_run_contexts`;--> statement-breakpoint
ALTER TABLE `session_sidebar_preferences` RENAME TO `note_sidebar_preferences`;--> statement-breakpoint
ALTER TABLE `sessions` RENAME TO `notes`;--> statement-breakpoint
ALTER TABLE `conversation_recording_posts` RENAME TO `note_recording_posts`;--> statement-breakpoint
ALTER TABLE `session_materials` RENAME TO `note_materials`;--> statement-breakpoint
ALTER TABLE `project_sessions` RENAME TO `project_notes`;--> statement-breakpoint
ALTER TABLE `session_documents` RENAME TO `note_pages`;--> statement-breakpoint
ALTER TABLE `study_document_edit_receipts` RENAME TO `page_edit_receipts`;--> statement-breakpoint
ALTER TABLE `study_document_version_parents` RENAME TO `page_version_parents`;--> statement-breakpoint
ALTER TABLE `study_document_versions` RENAME TO `page_versions`;--> statement-breakpoint
ALTER TABLE `study_documents` RENAME TO `pages`;--> statement-breakpoint
ALTER TABLE `project_documents` RENAME TO `project_pages`;--> statement-breakpoint
ALTER TABLE `session_sources` RENAME TO `note_sources`;--> statement-breakpoint
ALTER TABLE `study_document_annotation_revisions` RENAME TO `page_annotation_revisions`;--> statement-breakpoint
ALTER TABLE `study_document_annotations` RENAME TO `page_annotations`;--> statement-breakpoint
ALTER TABLE `study_document_citation_assessments` RENAME TO `page_citation_assessments`;--> statement-breakpoint
ALTER TABLE `study_document_citations` RENAME TO `page_citations`;--> statement-breakpoint
ALTER TABLE `study_document_deletions` RENAME TO `page_deletions`;--> statement-breakpoint
ALTER TABLE `study_document_generation_requests` RENAME TO `page_generation_requests`;--> statement-breakpoint
ALTER TABLE `study_document_inputs` RENAME TO `page_inputs`;--> statement-breakpoint
ALTER TABLE `study_document_proposal_receipts` RENAME TO `page_proposal_receipts`;--> statement-breakpoint
ALTER TABLE `study_document_proposals` RENAME TO `page_proposals`;--> statement-breakpoint
ALTER TABLE `study_document_retirements` RENAME TO `page_retirements`;--> statement-breakpoint
ALTER TABLE `study_document_transform_requests` RENAME TO `page_transform_requests`;--> statement-breakpoint
ALTER TABLE `session_context_documents` RENAME TO `note_context_pages`;--> statement-breakpoint
ALTER TABLE `session_context_sources` RENAME TO `note_context_sources`;--> statement-breakpoint
ALTER TABLE `session_retired_intents` RENAME TO `note_retired_intents`;--> statement-breakpoint
ALTER TABLE `conversation_reply_sources` RENAME TO `note_reply_sources`;--> statement-breakpoint
ALTER TABLE `messages` RENAME COLUMN `session_id` TO `note_id`;--> statement-breakpoint
ALTER TABLE `note_deletion_correlations` RENAME COLUMN `session_id` TO `note_id`;--> statement-breakpoint
ALTER TABLE `note_deletions` RENAME COLUMN `session_id` TO `note_id`;--> statement-breakpoint
ALTER TABLE `note_merges` RENAME COLUMN `session_ids` TO `note_ids`;--> statement-breakpoint
ALTER TABLE `note_merges` RENAME COLUMN `session_id` TO `note_id`;--> statement-breakpoint
ALTER TABLE `note_reply_requests` RENAME COLUMN `session_id` TO `note_id`;--> statement-breakpoint
ALTER TABLE `note_run_contexts` RENAME COLUMN `session_id` TO `note_id`;--> statement-breakpoint
ALTER TABLE `note_sidebar_preferences` RENAME COLUMN `session_id` TO `note_id`;--> statement-breakpoint
ALTER TABLE `notes` RENAME COLUMN `assistant_for_session_id` TO `assistant_for_note_id`;--> statement-breakpoint
ALTER TABLE `recordings` RENAME COLUMN `session_id` TO `note_id`;--> statement-breakpoint
ALTER TABLE `note_recording_posts` RENAME COLUMN `session_id` TO `note_id`;--> statement-breakpoint
ALTER TABLE `source_recording_imports` RENAME COLUMN `session_id` TO `note_id`;--> statement-breakpoint
ALTER TABLE `recording_posts` RENAME COLUMN `session_id` TO `note_id`;--> statement-breakpoint
ALTER TABLE `learning_practice_inputs` RENAME COLUMN `document_version_id` TO `page_version_id`;--> statement-breakpoint
ALTER TABLE `note_materials` RENAME COLUMN `session_id` TO `note_id`;--> statement-breakpoint
ALTER TABLE `project_notes` RENAME COLUMN `session_id` TO `note_id`;--> statement-breakpoint
ALTER TABLE `note_pages` RENAME COLUMN `session_id` TO `note_id`;--> statement-breakpoint
ALTER TABLE `note_pages` RENAME COLUMN `document_id` TO `page_id`;--> statement-breakpoint
ALTER TABLE `page_edit_receipts` RENAME COLUMN `document_id` TO `page_id`;--> statement-breakpoint
ALTER TABLE `page_version_parents` RENAME COLUMN `document_id` TO `page_id`;--> statement-breakpoint
ALTER TABLE `page_versions` RENAME COLUMN `document_id` TO `page_id`;--> statement-breakpoint
ALTER TABLE `project_pages` RENAME COLUMN `document_id` TO `page_id`;--> statement-breakpoint
ALTER TABLE `note_sources` RENAME COLUMN `session_id` TO `note_id`;--> statement-breakpoint
ALTER TABLE `page_annotation_revisions` RENAME COLUMN `document_id` TO `page_id`;--> statement-breakpoint
ALTER TABLE `page_annotations` RENAME COLUMN `document_id` TO `page_id`;--> statement-breakpoint
ALTER TABLE `page_deletions` RENAME COLUMN `document_id` TO `page_id`;--> statement-breakpoint
ALTER TABLE `page_generation_requests` RENAME COLUMN `document_id` TO `page_id`;--> statement-breakpoint
ALTER TABLE `page_generation_requests` RENAME COLUMN `session_id` TO `note_id`;--> statement-breakpoint
ALTER TABLE `page_inputs` RENAME COLUMN `document_version_id` TO `page_version_id`;--> statement-breakpoint
ALTER TABLE `page_transform_requests` RENAME COLUMN `session_id` TO `note_id`;--> statement-breakpoint
ALTER TABLE `note_retired_intents` RENAME COLUMN `session_id` TO `note_id`;--> statement-breakpoint
ALTER TABLE `material_evidence_inputs` RENAME COLUMN `document_version_id` TO `page_version_id`;--> statement-breakpoint
ALTER TABLE `assistant_chat_starts` RENAME COLUMN `session_id` TO `note_id`;--> statement-breakpoint
ALTER TABLE `assistant_memory` RENAME COLUMN `session_id` TO `note_id`;--> statement-breakpoint
ALTER TABLE `integration_receipts` RENAME COLUMN `session_id` TO `note_id`;--> statement-breakpoint
ALTER TABLE `integration_receipts` RENAME COLUMN `document_id` TO `page_id`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_note_deletions` (
	`note_id` integer PRIMARY KEY,
	`operation_id` text NOT NULL UNIQUE,
	`status` text NOT NULL,
	`error_kind` text,
	`attempt` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`completed_at` integer,
	CONSTRAINT "note_deletion_state_check" CHECK("attempt" >= 1 AND "status" IN ('pending','failed','completed') AND (("status" = 'completed') = ("completed_at" IS NOT NULL)) AND (("status" = 'failed') = ("error_kind" IS NOT NULL)))
);
--> statement-breakpoint
INSERT INTO `__new_note_deletions`(`note_id`, `operation_id`, `status`, `error_kind`, `attempt`, `created_at`, `completed_at`) SELECT `note_id`, `operation_id`, `status`, `error_kind`, `attempt`, `created_at`, `completed_at` FROM `note_deletions`;--> statement-breakpoint
DROP TABLE `note_deletions`;--> statement-breakpoint
ALTER TABLE `__new_note_deletions` RENAME TO `note_deletions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_note_merges` (
	`intent_key` text PRIMARY KEY,
	`note_ids` text NOT NULL,
	`note_id` integer NOT NULL,
	CONSTRAINT `fk_session_merges_session_id_sessions_id_fk` FOREIGN KEY (`note_id`) REFERENCES `notes`(`id`) ON DELETE CASCADE,
	CONSTRAINT "note_merges_ids_json" CHECK(json_valid("note_ids"))
);
--> statement-breakpoint
INSERT INTO `__new_note_merges`(`intent_key`, `note_ids`, `note_id`) SELECT `intent_key`, `note_ids`, `note_id` FROM `note_merges`;--> statement-breakpoint
DROP TABLE `note_merges`;--> statement-breakpoint
ALTER TABLE `__new_note_merges` RENAME TO `note_merges`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_note_reply_requests` (
	`request_id` text PRIMARY KEY,
	`note_id` integer NOT NULL,
	`version_id` integer NOT NULL,
	`snapshot` text NOT NULL,
	CONSTRAINT `fk_conversation_reply_requests_session_id_sessions_id_fk` FOREIGN KEY (`note_id`) REFERENCES `notes`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_conversation_reply_requests_version_id_message_versions_id_fk` FOREIGN KEY (`version_id`) REFERENCES `message_versions`(`id`) ON DELETE CASCADE,
	CONSTRAINT "note_reply_requests_snapshot_json" CHECK(json_valid("snapshot"))
);
--> statement-breakpoint
INSERT INTO `__new_note_reply_requests`(`request_id`, `note_id`, `version_id`, `snapshot`) SELECT `request_id`, `note_id`, `version_id`, `snapshot` FROM `note_reply_requests`;--> statement-breakpoint
DROP TABLE `note_reply_requests`;--> statement-breakpoint
ALTER TABLE `__new_note_reply_requests` RENAME TO `note_reply_requests`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_note_run_contexts` (
	`request_id` text PRIMARY KEY,
	`note_id` integer NOT NULL,
	`intent_key` text NOT NULL,
	`intent` text NOT NULL,
	`snapshot` text NOT NULL,
	CONSTRAINT `fk_session_run_contexts_session_id_sessions_id_fk` FOREIGN KEY (`note_id`) REFERENCES `notes`(`id`) ON DELETE CASCADE,
	CONSTRAINT "note_run_contexts_json" CHECK(json_valid("snapshot") AND json_valid("intent"))
);
--> statement-breakpoint
INSERT INTO `__new_note_run_contexts`(`request_id`, `note_id`, `intent_key`, `intent`, `snapshot`) SELECT `request_id`, `note_id`, `intent_key`, `intent`, `snapshot` FROM `note_run_contexts`;--> statement-breakpoint
DROP TABLE `note_run_contexts`;--> statement-breakpoint
ALTER TABLE `__new_note_run_contexts` RENAME TO `note_run_contexts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_note_sidebar_preferences` (
	`note_id` integer PRIMARY KEY,
	`settled` integer NOT NULL,
	CONSTRAINT `fk_session_sidebar_preferences_session_id_sessions_id_fk` FOREIGN KEY (`note_id`) REFERENCES `notes`(`id`) ON DELETE CASCADE,
	CONSTRAINT "note_sidebar_preferences_settled_check" CHECK("settled" IN (0, 1))
);
--> statement-breakpoint
INSERT INTO `__new_note_sidebar_preferences`(`note_id`, `settled`) SELECT `note_id`, `settled` FROM `note_sidebar_preferences`;--> statement-breakpoint
DROP TABLE `note_sidebar_preferences`;--> statement-breakpoint
ALTER TABLE `__new_note_sidebar_preferences` RENAME TO `note_sidebar_preferences`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_notes` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`title` text NOT NULL,
	`mode` text DEFAULT 'notebook' NOT NULL,
	`assistant_for_note_id` integer,
	`archived_at` integer,
	`selection_revision` integer DEFAULT '0' NOT NULL,
	`selection` text DEFAULT '[]' NOT NULL,
	`context_revision` integer DEFAULT '0' NOT NULL,
	`title_source` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_sessions_assistant_for_session_id_sessions_id_fk` FOREIGN KEY (`assistant_for_note_id`) REFERENCES `notes`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_sessions_title_source_codes_title_source_code_fk` FOREIGN KEY (`title_source`) REFERENCES `codes_title_source`(`code`),
	CONSTRAINT "notes_check_1" CHECK(length(trim(title)) > 0 AND length(title) <= 200)
);
--> statement-breakpoint
INSERT INTO `__new_notes`(`id`, `title`, `mode`, `archived_at`, `selection_revision`, `selection`, `context_revision`, `title_source`, `created_at`, `updated_at`, `assistant_for_note_id`) SELECT `id`, `title`, `mode`, `archived_at`, `selection_revision`, `selection`, `context_revision`, `title_source`, `created_at`, `updated_at`, `assistant_for_note_id` FROM `notes`;--> statement-breakpoint
DROP TABLE `notes`;--> statement-breakpoint
ALTER TABLE `__new_notes` RENAME TO `notes`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_note_recording_posts` (
	`request_id` text PRIMARY KEY,
	`note_id` integer NOT NULL,
	`input_hash` text NOT NULL,
	`message_id` integer NOT NULL,
	CONSTRAINT `fk_conversation_recording_posts_session_id_sessions_id_fk` FOREIGN KEY (`note_id`) REFERENCES `notes`(`id`) ON DELETE CASCADE,
	CONSTRAINT "note_recording_posts_request_check" CHECK(length(trim("request_id")) > 0),
	CONSTRAINT "note_recording_posts_hash_check" CHECK(length("input_hash") = 64 AND "input_hash" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "note_recording_posts_message_check" CHECK("message_id" > 0)
);
--> statement-breakpoint
INSERT INTO `__new_note_recording_posts`(`request_id`, `note_id`, `input_hash`, `message_id`) SELECT `request_id`, `note_id`, `input_hash`, `message_id` FROM `note_recording_posts`;--> statement-breakpoint
DROP TABLE `note_recording_posts`;--> statement-breakpoint
ALTER TABLE `__new_note_recording_posts` RENAME TO `note_recording_posts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_note_materials` (
	`note_id` integer NOT NULL,
	`material_id` integer NOT NULL,
	`position` integer NOT NULL,
	CONSTRAINT `session_materials_pk` PRIMARY KEY(`note_id`, `material_id`),
	CONSTRAINT `fk_session_materials_session_id_sessions_id_fk` FOREIGN KEY (`note_id`) REFERENCES `notes`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_session_materials_material_id_materials_id_fk` FOREIGN KEY (`material_id`) REFERENCES `materials`(`id`) ON DELETE CASCADE,
	CONSTRAINT "note_materials_position_check" CHECK(typeof(position) = 'integer' AND position >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_note_materials`(`note_id`, `material_id`, `position`) SELECT `note_id`, `material_id`, `position` FROM `note_materials`;--> statement-breakpoint
DROP TABLE `note_materials`;--> statement-breakpoint
ALTER TABLE `__new_note_materials` RENAME TO `note_materials`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_note_pages` (
	`note_id` integer NOT NULL,
	`page_id` integer NOT NULL,
	`archived_at` integer,
	`position` integer NOT NULL,
	CONSTRAINT `session_documents_pk` PRIMARY KEY(`note_id`, `page_id`),
	CONSTRAINT `fk_session_documents_session_id_sessions_id_fk` FOREIGN KEY (`note_id`) REFERENCES `notes`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_session_documents_document_id_study_documents_id_fk` FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`) ON DELETE CASCADE,
	CONSTRAINT "note_pages_position_check" CHECK(typeof("position") = 'integer' AND "position" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_note_pages`(`note_id`, `page_id`, `archived_at`, `position`) SELECT `note_id`, `page_id`, `archived_at`, `position` FROM `note_pages`;--> statement-breakpoint
DROP TABLE `note_pages`;--> statement-breakpoint
ALTER TABLE `__new_note_pages` RENAME TO `note_pages`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_page_edit_receipts` (
	`page_id` integer NOT NULL,
	`key` text NOT NULL,
	`operation` text NOT NULL,
	`intent` text NOT NULL,
	`expected_version_id` integer NOT NULL,
	`current_version_id` integer NOT NULL,
	`submitted_version_id` integer NOT NULL,
	`outcome` text NOT NULL,
	CONSTRAINT `study_document_edit_receipts_pk` PRIMARY KEY(`page_id`, `key`),
	CONSTRAINT `fk_study_document_edit_receipts_document_id_study_documents_id_fk` FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`),
	CONSTRAINT `fk_study_document_edit_receipts_expected_version_id_document_id_study_document_versions_id_document_id_fk` FOREIGN KEY (`expected_version_id`,`page_id`) REFERENCES `page_versions`(`id`,`page_id`),
	CONSTRAINT `fk_study_document_edit_receipts_current_version_id_document_id_study_document_versions_id_document_id_fk` FOREIGN KEY (`current_version_id`,`page_id`) REFERENCES `page_versions`(`id`,`page_id`),
	CONSTRAINT `fk_study_document_edit_receipts_submitted_version_id_document_id_study_document_versions_id_document_id_fk` FOREIGN KEY (`submitted_version_id`,`page_id`) REFERENCES `page_versions`(`id`,`page_id`),
	CONSTRAINT "page_edit_receipts_intent_check" CHECK(json_valid("intent") AND length("key") BETWEEN 1 AND 200),
	CONSTRAINT "page_edit_receipts_outcome_check" CHECK("operation" IN ('save','restore') AND "outcome" IN ('saved','conflict') AND ("outcome" != 'saved' OR "expected_version_id" = "current_version_id"))
);
--> statement-breakpoint
INSERT INTO `__new_page_edit_receipts`(`page_id`, `key`, `operation`, `intent`, `expected_version_id`, `current_version_id`, `submitted_version_id`, `outcome`) SELECT `page_id`, `key`, `operation`, `intent`, `expected_version_id`, `current_version_id`, `submitted_version_id`, `outcome` FROM `page_edit_receipts`;--> statement-breakpoint
DROP TABLE `page_edit_receipts`;--> statement-breakpoint
ALTER TABLE `__new_page_edit_receipts` RENAME TO `page_edit_receipts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_page_version_parents` (
	`version_id` integer NOT NULL,
	`parent_version_id` integer NOT NULL,
	`page_id` integer NOT NULL,
	CONSTRAINT `study_document_version_parents_pk` PRIMARY KEY(`version_id`, `parent_version_id`),
	CONSTRAINT `fk_study_document_version_parents_version_id_document_id_study_document_versions_id_document_id_fk` FOREIGN KEY (`version_id`,`page_id`) REFERENCES `page_versions`(`id`,`page_id`) ON DELETE CASCADE,
	CONSTRAINT `fk_study_document_version_parents_parent_version_id_document_id_study_document_versions_id_document_id_fk` FOREIGN KEY (`parent_version_id`,`page_id`) REFERENCES `page_versions`(`id`,`page_id`),
	CONSTRAINT "page_version_parents_distinct_check" CHECK("version_id" != "parent_version_id")
);
--> statement-breakpoint
INSERT INTO `__new_page_version_parents`(`version_id`, `parent_version_id`, `page_id`) SELECT `version_id`, `parent_version_id`, `page_id` FROM `page_version_parents`;--> statement-breakpoint
DROP TABLE `page_version_parents`;--> statement-breakpoint
ALTER TABLE `__new_page_version_parents` RENAME TO `page_version_parents`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_page_versions` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`page_id` integer NOT NULL,
	`number` integer NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`operation` text DEFAULT 'original' NOT NULL,
	`creator` text DEFAULT 'user' NOT NULL,
	`content_snapshot_id` integer NOT NULL,
	`instruction` text,
	`language` text,
	`created_at` integer NOT NULL,
	`published_at` integer,
	CONSTRAINT `fk_study_document_versions_document_id_study_documents_id_fk` FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`),
	CONSTRAINT `fk_study_document_versions_content_snapshot_id_content_snapshots_id_fk` FOREIGN KEY (`content_snapshot_id`) REFERENCES `content_snapshots`(`id`),
	CONSTRAINT "page_versions_identity_check" CHECK("id" > 0 AND typeof("number") = 'integer' AND "number" > 0),
	CONSTRAINT "page_versions_status_check" CHECK("status" IN ('draft','published') AND (("status" = 'published') = ("published_at" IS NOT NULL))),
	CONSTRAINT "page_versions_operation_check" CHECK("operation" IN ('original','edit','summarize','translate','generate','restore')),
	CONSTRAINT "page_versions_creator_check" CHECK("creator" IN ('user','agent')),
	CONSTRAINT "page_versions_language_check" CHECK("language" IS NULL OR length(trim("language")) BETWEEN 1 AND 64),
	CONSTRAINT "page_versions_instruction_check" CHECK("instruction" IS NULL OR length(trim("instruction")) BETWEEN 1 AND 100000),
	CONSTRAINT "page_versions_times_check" CHECK(typeof("created_at") = 'integer' AND "created_at" >= 0 AND ("published_at" IS NULL OR (typeof("published_at") = 'integer' AND "published_at" >= "created_at")))
);
--> statement-breakpoint
INSERT INTO `__new_page_versions`(`id`, `page_id`, `number`, `status`, `operation`, `creator`, `content_snapshot_id`, `instruction`, `language`, `created_at`, `published_at`) SELECT `id`, `page_id`, `number`, `status`, `operation`, `creator`, `content_snapshot_id`, `instruction`, `language`, `created_at`, `published_at` FROM `page_versions`;--> statement-breakpoint
DROP TABLE `page_versions`;--> statement-breakpoint
ALTER TABLE `__new_page_versions` RENAME TO `page_versions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_pages` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`title` text NOT NULL,
	`description` text,
	`create_key` text,
	`creation_intent` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`archived_at` integer,
	CONSTRAINT "pages_title_check" CHECK(length(trim("title")) BETWEEN 1 AND 200),
	CONSTRAINT "pages_description_check" CHECK("description" IS NULL OR length("description") <= 240),
	CONSTRAINT "pages_creation_check" CHECK(("create_key" IS NULL AND "creation_intent" IS NULL) OR (length("create_key") BETWEEN 1 AND 200 AND json_valid("creation_intent"))),
	CONSTRAINT "pages_times_check" CHECK("id" > 0 AND typeof("created_at") = 'integer' AND "created_at" >= 0 AND typeof("updated_at") = 'integer' AND "updated_at" >= "created_at" AND ("archived_at" IS NULL OR (typeof("archived_at") = 'integer' AND "archived_at" >= "created_at")))
);
--> statement-breakpoint
INSERT INTO `__new_pages`(`id`, `title`, `description`, `create_key`, `creation_intent`, `created_at`, `updated_at`, `archived_at`) SELECT `id`, `title`, `description`, `create_key`, `creation_intent`, `created_at`, `updated_at`, `archived_at` FROM `pages`;--> statement-breakpoint
DROP TABLE `pages`;--> statement-breakpoint
ALTER TABLE `__new_pages` RENAME TO `pages`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_note_sources` (
	`note_id` integer NOT NULL,
	`source_id` integer NOT NULL,
	`archived_at` integer,
	`position` integer NOT NULL,
	CONSTRAINT `session_sources_pk` PRIMARY KEY(`note_id`, `source_id`),
	CONSTRAINT `fk_session_sources_session_id_sessions_id_fk` FOREIGN KEY (`note_id`) REFERENCES `notes`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_session_sources_source_id_sources_id_fk` FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON DELETE CASCADE,
	CONSTRAINT "note_sources_position_check" CHECK("position">=0)
);
--> statement-breakpoint
INSERT INTO `__new_note_sources`(`note_id`, `source_id`, `archived_at`, `position`) SELECT `note_id`, `source_id`, `archived_at`, `position` FROM `note_sources`;--> statement-breakpoint
DROP TABLE `note_sources`;--> statement-breakpoint
ALTER TABLE `__new_note_sources` RENAME TO `note_sources`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_page_annotation_revisions` (
	`annotation_id` integer NOT NULL,
	`revision` integer NOT NULL,
	`page_id` integer NOT NULL,
	`version_id` integer NOT NULL,
	`snapshot_id` integer NOT NULL,
	`payload` text NOT NULL,
	CONSTRAINT `study_document_annotation_revisions_pk` PRIMARY KEY(`annotation_id`, `revision`),
	CONSTRAINT `fk_study_document_annotation_revisions_snapshot_id_content_snapshots_id_fk` FOREIGN KEY (`snapshot_id`) REFERENCES `content_snapshots`(`id`),
	CONSTRAINT `fk_study_document_annotation_revisions_annotation_id_document_id_study_document_annotations_id_document_id_fk` FOREIGN KEY (`annotation_id`,`page_id`) REFERENCES `page_annotations`(`id`,`page_id`),
	CONSTRAINT `fk_study_document_annotation_revisions_version_id_document_id_study_document_versions_id_document_id_fk` FOREIGN KEY (`version_id`,`page_id`) REFERENCES `page_versions`(`id`,`page_id`),
	CONSTRAINT "page_annotation_payload" CHECK(json_valid("payload") AND "revision">0)
);
--> statement-breakpoint
INSERT INTO `__new_page_annotation_revisions`(`annotation_id`, `revision`, `page_id`, `version_id`, `snapshot_id`, `payload`) SELECT `annotation_id`, `revision`, `page_id`, `version_id`, `snapshot_id`, `payload` FROM `page_annotation_revisions`;--> statement-breakpoint
DROP TABLE `page_annotation_revisions`;--> statement-breakpoint
ALTER TABLE `__new_page_annotation_revisions` RENAME TO `page_annotation_revisions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_page_annotations` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`page_id` integer NOT NULL,
	`revision` integer NOT NULL,
	CONSTRAINT `fk_study_document_annotations_document_id_study_documents_id_fk` FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`),
	CONSTRAINT "page_annotations_revision" CHECK("revision">0)
);
--> statement-breakpoint
INSERT INTO `__new_page_annotations`(`id`, `page_id`, `revision`) SELECT `id`, `page_id`, `revision` FROM `page_annotations`;--> statement-breakpoint
DROP TABLE `page_annotations`;--> statement-breakpoint
ALTER TABLE `__new_page_annotations` RENAME TO `page_annotations`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_page_citation_assessments` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`version_id` integer NOT NULL,
	`marker` integer NOT NULL,
	`payload` text NOT NULL,
	CONSTRAINT `fk_study_document_citation_assessments_version_id_marker_study_document_citations_version_id_marker_fk` FOREIGN KEY (`version_id`,`marker`) REFERENCES `page_citations`(`version_id`,`marker`),
	CONSTRAINT "page_assessment_payload" CHECK(json_valid("payload"))
);
--> statement-breakpoint
INSERT INTO `__new_page_citation_assessments`(`id`, `version_id`, `marker`, `payload`) SELECT `id`, `version_id`, `marker`, `payload` FROM `page_citation_assessments`;--> statement-breakpoint
DROP TABLE `page_citation_assessments`;--> statement-breakpoint
ALTER TABLE `__new_page_citation_assessments` RENAME TO `page_citation_assessments`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_page_citations` (
	`version_id` integer NOT NULL,
	`marker` integer NOT NULL,
	`input_id` integer NOT NULL,
	`anchor` text NOT NULL,
	`target` text,
	`quote` text NOT NULL,
	CONSTRAINT `study_document_citations_pk` PRIMARY KEY(`version_id`, `marker`),
	CONSTRAINT `fk_study_document_citations_input_id_version_id_study_document_inputs_id_version_id_fk` FOREIGN KEY (`input_id`,`version_id`) REFERENCES `page_inputs`(`id`,`version_id`),
	CONSTRAINT "page_citations_anchor" CHECK(CASE WHEN json_valid("anchor") THEN coalesce(
    json_type("anchor") = 'object' AND CASE json_extract("anchor", '$.type')
    WHEN 'authored' THEN 1
    WHEN 'time' THEN json_type("anchor", '$.startMs') = 'integer' AND json_extract("anchor", '$.startMs') >= 0
      AND json_type("anchor", '$.endMs') = 'integer' AND json_extract("anchor", '$.endMs') >= json_extract("anchor", '$.startMs')
    WHEN 'page' THEN json_type("anchor", '$.page') = 'integer' AND json_extract("anchor", '$.page') >= 1
    WHEN 'paragraph' THEN json_type("anchor", '$.index') = 'integer' AND json_extract("anchor", '$.index') >= 0
    WHEN 'slide' THEN json_type("anchor", '$.index') = 'integer' AND json_extract("anchor", '$.index') >= 0
    WHEN 'url' THEN json_type("anchor", '$.url') = 'text' AND length(trim(json_extract("anchor", '$.url'))) > 0
      AND json_type("anchor", '$.fragment') IN ('null', 'text')
    WHEN 'text' THEN json_type("anchor", '$.lineStart') = 'integer' AND json_extract("anchor", '$.lineStart') >= 0
      AND json_type("anchor", '$.lineEnd') = 'integer' AND json_extract("anchor", '$.lineEnd') >= json_extract("anchor", '$.lineStart')
      AND json_type("anchor", '$.start') = 'integer' AND json_extract("anchor", '$.start') >= 0
      AND json_type("anchor", '$.end') = 'integer' AND json_extract("anchor", '$.end') >= json_extract("anchor", '$.start')
    ELSE 0 END, 0) ELSE 0 END),
	CONSTRAINT "page_citations_value" CHECK("marker" BETWEEN 1 AND 4294967295 AND length(trim("quote"))>0 AND ("target" IS NULL OR json_valid("target")))
);
--> statement-breakpoint
INSERT INTO `__new_page_citations`(`version_id`, `marker`, `input_id`, `anchor`, `target`, `quote`) SELECT `version_id`, `marker`, `input_id`, `anchor`, `target`, `quote` FROM `page_citations`;--> statement-breakpoint
DROP TABLE `page_citations`;--> statement-breakpoint
ALTER TABLE `__new_page_citations` RENAME TO `page_citations`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_page_generation_requests` (
	`id` text PRIMARY KEY,
	`page_id` integer NOT NULL,
	`expected_version_id` integer,
	`note_id` integer,
	`intent_hash` text NOT NULL,
	`result_version_id` integer,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_study_document_generation_requests_document_id_study_documents_id_fk` FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`),
	CONSTRAINT `fk_study_document_generation_requests_session_id_sessions_id_fk` FOREIGN KEY (`note_id`) REFERENCES `notes`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_study_document_generation_requests_result_version_id_study_document_versions_id_fk` FOREIGN KEY (`result_version_id`) REFERENCES `page_versions`(`id`),
	CONSTRAINT `fk_study_document_generation_requests_expected_version_id_document_id_study_document_versions_id_document_id_fk` FOREIGN KEY (`expected_version_id`,`page_id`) REFERENCES `page_versions`(`id`,`page_id`),
	CONSTRAINT "page_generation_hash" CHECK(length("intent_hash")=64),
	CONSTRAINT "page_creation_result" CHECK("expected_version_id" IS NOT NULL OR "result_version_id" IS NOT NULL)
);
--> statement-breakpoint
INSERT INTO `__new_page_generation_requests`(`id`, `page_id`, `expected_version_id`, `note_id`, `intent_hash`, `result_version_id`, `created_at`) SELECT `id`, `page_id`, `expected_version_id`, `note_id`, `intent_hash`, `result_version_id`, `created_at` FROM `page_generation_requests`;--> statement-breakpoint
DROP TABLE `page_generation_requests`;--> statement-breakpoint
ALTER TABLE `__new_page_generation_requests` RENAME TO `page_generation_requests`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_page_inputs` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`version_id` integer,
	`request_id` text,
	`position` integer NOT NULL,
	`page_version_id` integer,
	`source_id` integer,
	`source_revision` integer,
	`source_snapshot_id` integer,
	`message_version_id` integer,
	`exact_message_version_id` integer,
	CONSTRAINT `fk_study_document_inputs_version_id_study_document_versions_id_fk` FOREIGN KEY (`version_id`) REFERENCES `page_versions`(`id`),
	CONSTRAINT `fk_study_document_inputs_request_id_study_document_generation_requests_id_fk` FOREIGN KEY (`request_id`) REFERENCES `page_generation_requests`(`id`),
	CONSTRAINT `fk_study_document_inputs_document_version_id_study_document_versions_id_fk` FOREIGN KEY (`page_version_id`) REFERENCES `page_versions`(`id`),
	CONSTRAINT `fk_study_document_inputs_source_snapshot_id_content_snapshots_id_fk` FOREIGN KEY (`source_snapshot_id`) REFERENCES `content_snapshots`(`id`),
	CONSTRAINT `fk_study_document_inputs_message_version_id_message_versions_id_fk` FOREIGN KEY (`message_version_id`) REFERENCES `message_versions`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_study_document_inputs_source_id_source_revision_source_snapshots_source_id_revision_fk` FOREIGN KEY (`source_id`,`source_revision`) REFERENCES `source_snapshots`(`source_id`,`revision`),
	CONSTRAINT `fk_study_document_inputs_source_id_source_revision_source_snapshot_id_source_extraction_revisions_source_id_revision_snapshot_id_fk` FOREIGN KEY (`source_id`,`source_revision`,`source_snapshot_id`) REFERENCES `source_extraction_revisions`(`source_id`,`revision`,`snapshot_id`),
	CONSTRAINT "page_inputs_exact_target" CHECK(("version_id" IS NOT NULL) != ("request_id" IS NOT NULL) AND "position">=0 AND
 (("page_version_id" IS NOT NULL)+("source_id" IS NOT NULL)+("exact_message_version_id" IS NOT NULL))=1 AND
 (("source_id" IS NULL)=("source_revision" IS NULL)) AND ("source_snapshot_id" IS NULL OR "source_id" IS NOT NULL) AND ("source_revision" IS NULL OR "source_revision">0) AND ("message_version_id" IS NULL OR "message_version_id"="exact_message_version_id"))
);
--> statement-breakpoint
INSERT INTO `__new_page_inputs`(`id`, `version_id`, `request_id`, `position`, `page_version_id`, `source_id`, `source_revision`, `source_snapshot_id`, `message_version_id`, `exact_message_version_id`) SELECT `id`, `version_id`, `request_id`, `position`, `page_version_id`, `source_id`, `source_revision`, `source_snapshot_id`, `message_version_id`, `exact_message_version_id` FROM `page_inputs`;--> statement-breakpoint
DROP TABLE `page_inputs`;--> statement-breakpoint
ALTER TABLE `__new_page_inputs` RENAME TO `page_inputs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_page_proposal_receipts` (
	`key` text PRIMARY KEY,
	`request_id` text NOT NULL,
	`operation` text NOT NULL,
	`intent` text NOT NULL,
	`outcome` text NOT NULL,
	`current_version_id` integer NOT NULL,
	`result_version_id` integer,
	CONSTRAINT `fk_study_document_proposal_receipts_request_id_study_document_proposals_request_id_fk` FOREIGN KEY (`request_id`) REFERENCES `page_proposals`(`request_id`),
	CONSTRAINT `fk_study_document_proposal_receipts_current_version_id_study_document_versions_id_fk` FOREIGN KEY (`current_version_id`) REFERENCES `page_versions`(`id`),
	CONSTRAINT `fk_study_document_proposal_receipts_result_version_id_study_document_versions_id_fk` FOREIGN KEY (`result_version_id`) REFERENCES `page_versions`(`id`),
	CONSTRAINT "page_proposal_receipt" CHECK(json_valid("intent") AND (("outcome"='conflict' AND "operation"='apply' AND "result_version_id" IS NULL) OR ("outcome"='applied' AND "operation"='apply' AND "result_version_id" IS NOT NULL) OR ("outcome"='kept' AND "operation"='keep' AND "result_version_id" IS NOT NULL)))
);
--> statement-breakpoint
INSERT INTO `__new_page_proposal_receipts`(`key`, `request_id`, `operation`, `intent`, `outcome`, `current_version_id`, `result_version_id`) SELECT `key`, `request_id`, `operation`, `intent`, `outcome`, `current_version_id`, `result_version_id` FROM `page_proposal_receipts`;--> statement-breakpoint
DROP TABLE `page_proposal_receipts`;--> statement-breakpoint
ALTER TABLE `__new_page_proposal_receipts` RENAME TO `page_proposal_receipts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_page_transform_requests` (
	`id` text PRIMARY KEY,
	`context_request_id` text NOT NULL,
	`note_id` integer,
	`request` text NOT NULL,
	`intent_hash` text NOT NULL,
	`instruction` text NOT NULL,
	`event_id` text NOT NULL,
	`cancelled` integer DEFAULT false NOT NULL,
	`error_kind` text,
	`result_version_id` integer,
	`report` text,
	`result_hash` text,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_study_document_transform_requests_session_id_sessions_id_fk` FOREIGN KEY (`note_id`) REFERENCES `notes`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_study_document_transform_requests_result_version_id_study_document_versions_id_fk` FOREIGN KEY (`result_version_id`) REFERENCES `page_versions`(`id`),
	CONSTRAINT "page_transform_request_check" CHECK(json_valid("request")),
	CONSTRAINT "page_transform_report_check" CHECK("report" IS NULL OR json_valid("report"))
);
--> statement-breakpoint
INSERT INTO `__new_page_transform_requests`(`id`, `context_request_id`, `note_id`, `request`, `intent_hash`, `instruction`, `event_id`, `cancelled`, `error_kind`, `result_version_id`, `report`, `result_hash`, `created_at`) SELECT `id`, `context_request_id`, `note_id`, `request`, `intent_hash`, `instruction`, `event_id`, `cancelled`, `error_kind`, `result_version_id`, `report`, `result_hash`, `created_at` FROM `page_transform_requests`;--> statement-breakpoint
DROP TABLE `page_transform_requests`;--> statement-breakpoint
ALTER TABLE `__new_page_transform_requests` RENAME TO `page_transform_requests`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_note_reply_sources` (
	`request_id` text NOT NULL,
	`part_id` integer NOT NULL,
	`source_id` integer NOT NULL,
	`revision` integer NOT NULL,
	`snapshot_id` integer,
	CONSTRAINT `conversation_reply_sources_pk` PRIMARY KEY(`request_id`, `part_id`),
	CONSTRAINT `fk_conversation_reply_sources_request_id_conversation_reply_requests_request_id_fk` FOREIGN KEY (`request_id`) REFERENCES `note_reply_requests`(`request_id`) ON DELETE CASCADE,
	CONSTRAINT `fk_conversation_reply_sources_source_id_revision_source_snapshots_source_id_revision_fk` FOREIGN KEY (`source_id`,`revision`) REFERENCES `source_snapshots`(`source_id`,`revision`),
	CONSTRAINT `fk_conversation_reply_sources_source_id_revision_snapshot_id_source_extraction_revisions_source_id_revision_snapshot_id_fk` FOREIGN KEY (`source_id`,`revision`,`snapshot_id`) REFERENCES `source_extraction_revisions`(`source_id`,`revision`,`snapshot_id`),
	CONSTRAINT "note_reply_source_identity" CHECK("part_id">0 AND "revision">0)
);
--> statement-breakpoint
INSERT INTO `__new_note_reply_sources`(`request_id`, `part_id`, `source_id`, `revision`, `snapshot_id`) SELECT `request_id`, `part_id`, `source_id`, `revision`, `snapshot_id` FROM `note_reply_sources`;--> statement-breakpoint
DROP TABLE `note_reply_sources`;--> statement-breakpoint
ALTER TABLE `__new_note_reply_sources` RENAME TO `note_reply_sources`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_learning_practice_inputs` (
	`slot_id` text NOT NULL,
	`position` integer NOT NULL,
	`page_version_id` integer,
	`source_id` integer,
	`source_revision` integer,
	`source_snapshot_id` integer,
	CONSTRAINT `learning_practice_inputs_pk` PRIMARY KEY(`slot_id`, `position`),
	CONSTRAINT `fk_learning_practice_inputs_slot_id_learning_practice_slots_id_fk` FOREIGN KEY (`slot_id`) REFERENCES `learning_practice_slots`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_learning_practice_inputs_document_version_id_study_document_versions_id_fk` FOREIGN KEY (`page_version_id`) REFERENCES `page_versions`(`id`),
	CONSTRAINT `fk_learning_practice_inputs_source_id_source_revision_source_snapshot_id_source_extraction_revisions_source_id_revision_snapshot_id_fk` FOREIGN KEY (`source_id`,`source_revision`,`source_snapshot_id`) REFERENCES `source_extraction_revisions`(`source_id`,`revision`,`snapshot_id`),
	CONSTRAINT "exact_content_input_reference" CHECK((("page_version_id" IS NOT NULL AND "source_id" IS NULL AND "source_revision" IS NULL AND "source_snapshot_id" IS NULL) OR ("page_version_id" IS NULL AND "source_id" IS NOT NULL AND "source_revision">0 AND "source_snapshot_id" IS NOT NULL))),
	CONSTRAINT "learning_practice_inputs_position" CHECK("position">=0)
);
--> statement-breakpoint
INSERT INTO `__new_learning_practice_inputs`(`slot_id`, `position`, `page_version_id`, `source_id`, `source_revision`, `source_snapshot_id`) SELECT `slot_id`, `position`, `page_version_id`, `source_id`, `source_revision`, `source_snapshot_id` FROM `learning_practice_inputs`;--> statement-breakpoint
DROP TABLE `learning_practice_inputs`;--> statement-breakpoint
ALTER TABLE `__new_learning_practice_inputs` RENAME TO `learning_practice_inputs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_material_evidence_inputs` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`version_id` integer,
	`request_id` text,
	`position` integer NOT NULL,
	`page_version_id` integer,
	`source_id` integer,
	`source_revision` integer,
	`source_snapshot_id` integer,
	CONSTRAINT `fk_material_evidence_inputs_version_id_material_versions_id_fk` FOREIGN KEY (`version_id`) REFERENCES `material_versions`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_material_evidence_inputs_request_id_material_generation_requests_id_fk` FOREIGN KEY (`request_id`) REFERENCES `material_generation_requests`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_material_evidence_inputs_document_version_id_study_document_versions_id_fk` FOREIGN KEY (`page_version_id`) REFERENCES `page_versions`(`id`),
	CONSTRAINT `fk_material_evidence_inputs_source_id_source_revision_source_snapshot_id_source_extraction_revisions_source_id_revision_snapshot_id_fk` FOREIGN KEY (`source_id`,`source_revision`,`source_snapshot_id`) REFERENCES `source_extraction_revisions`(`source_id`,`revision`,`snapshot_id`),
	CONSTRAINT "exact_content_input_reference" CHECK((("page_version_id" IS NOT NULL AND "source_id" IS NULL AND "source_revision" IS NULL AND "source_snapshot_id" IS NULL) OR ("page_version_id" IS NULL AND "source_id" IS NOT NULL AND "source_revision">0 AND "source_snapshot_id" IS NOT NULL))),
	CONSTRAINT "material_evidence_input_owner" CHECK(("version_id" IS NULL)!=("request_id" IS NULL) AND "position">=0)
);
--> statement-breakpoint
INSERT INTO `__new_material_evidence_inputs`(`id`, `version_id`, `request_id`, `position`, `page_version_id`, `source_id`, `source_revision`, `source_snapshot_id`) SELECT `id`, `version_id`, `request_id`, `position`, `page_version_id`, `source_id`, `source_revision`, `source_snapshot_id` FROM `material_evidence_inputs`;--> statement-breakpoint
DROP TABLE `material_evidence_inputs`;--> statement-breakpoint
ALTER TABLE `__new_material_evidence_inputs` RENAME TO `material_evidence_inputs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
DROP INDEX IF EXISTS `messages_session_capture_key_unique`;--> statement-breakpoint
DROP INDEX IF EXISTS `messages_session_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `conversation_reply_requests_version_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `session_run_contexts_intent_unique`;--> statement-breakpoint
DROP INDEX IF EXISTS `sessions_assistant_for_session_unique`;--> statement-breakpoint
DROP INDEX IF EXISTS `recordings_session_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `conversation_recording_posts_message_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `session_materials_position_unique`;--> statement-breakpoint
DROP INDEX IF EXISTS `session_materials_material_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `project_sessions_session_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `session_documents_position_unique`;--> statement-breakpoint
DROP INDEX IF EXISTS `session_documents_document_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `study_document_edit_receipts_submitted_unique`;--> statement-breakpoint
DROP INDEX IF EXISTS `study_document_version_parents_parent_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `study_document_versions_number_unique`;--> statement-breakpoint
DROP INDEX IF EXISTS `study_document_versions_owner_unique`;--> statement-breakpoint
DROP INDEX IF EXISTS `study_document_versions_content_unique`;--> statement-breakpoint
DROP INDEX IF EXISTS `study_document_versions_heads_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `study_documents_create_key_unique`;--> statement-breakpoint
DROP INDEX IF EXISTS `project_documents_document_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `session_sources_position`;--> statement-breakpoint
DROP INDEX IF EXISTS `study_document_annotations_owner`;--> statement-breakpoint
DROP INDEX IF EXISTS `study_document_inputs_owner`;--> statement-breakpoint
DROP INDEX IF EXISTS `study_document_inputs_version_position`;--> statement-breakpoint
DROP INDEX IF EXISTS `study_document_inputs_request_position`;--> statement-breakpoint
DROP INDEX IF EXISTS `study_document_transform_sessions_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `conversation_reply_sources_revision`;--> statement-breakpoint
DROP INDEX IF EXISTS `conversation_reply_sources_snapshot`;--> statement-breakpoint
CREATE UNIQUE INDEX `note_reply_requests_version_idx` ON `note_reply_requests` (`version_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `note_run_contexts_intent_unique` ON `note_run_contexts` (`note_id`,`intent_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `notes_assistant_for_note_unique` ON `notes` (`assistant_for_note_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `note_recording_posts_message_idx` ON `note_recording_posts` (`message_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `note_materials_position_unique` ON `note_materials` (`note_id`,`position`);--> statement-breakpoint
CREATE INDEX `note_materials_material_idx` ON `note_materials` (`material_id`,`note_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `note_pages_position_unique` ON `note_pages` (`note_id`,`position`);--> statement-breakpoint
CREATE INDEX `note_pages_page_idx` ON `note_pages` (`page_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `page_edit_receipts_submitted_unique` ON `page_edit_receipts` (`submitted_version_id`);--> statement-breakpoint
CREATE INDEX `page_version_parents_parent_idx` ON `page_version_parents` (`parent_version_id`,`version_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `page_versions_number_unique` ON `page_versions` (`page_id`,`number`);--> statement-breakpoint
CREATE UNIQUE INDEX `page_versions_owner_unique` ON `page_versions` (`id`,`page_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `page_versions_content_unique` ON `page_versions` (`content_snapshot_id`);--> statement-breakpoint
CREATE INDEX `page_versions_heads_idx` ON `page_versions` (`page_id`,`status`,"number" desc);--> statement-breakpoint
CREATE UNIQUE INDEX `pages_create_key_unique` ON `pages` (`create_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `note_sources_position` ON `note_sources` (`note_id`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `page_annotations_owner` ON `page_annotations` (`id`,`page_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `page_inputs_owner` ON `page_inputs` (`id`,`version_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `page_inputs_version_position` ON `page_inputs` (`version_id`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `page_inputs_request_position` ON `page_inputs` (`request_id`,`position`);--> statement-breakpoint
CREATE INDEX `page_transform_notes_idx` ON `page_transform_requests` (`note_id`,`id`);--> statement-breakpoint
CREATE INDEX `note_reply_sources_revision` ON `note_reply_sources` (`source_id`,`revision`);--> statement-breakpoint
CREATE INDEX `note_reply_sources_snapshot` ON `note_reply_sources` (`snapshot_id`);--> statement-breakpoint
CREATE INDEX `learning_practice_inputs_document` ON `learning_practice_inputs` (`page_version_id`);--> statement-breakpoint
CREATE INDEX `learning_practice_inputs_source` ON `learning_practice_inputs` (`source_id`,`source_revision`,`source_snapshot_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `material_evidence_inputs_version_owner` ON `material_evidence_inputs` (`id`,`version_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `material_evidence_inputs_version_position` ON `material_evidence_inputs` (`version_id`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `material_evidence_inputs_request_position` ON `material_evidence_inputs` (`request_id`,`position`);--> statement-breakpoint
CREATE INDEX `material_evidence_inputs_document` ON `material_evidence_inputs` (`page_version_id`);--> statement-breakpoint
CREATE INDEX `material_evidence_inputs_source` ON `material_evidence_inputs` (`source_id`,`source_revision`,`source_snapshot_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `messages_note_capture_key_unique` ON `messages` (`note_id`,`capture_key`);--> statement-breakpoint
CREATE INDEX `messages_note_idx` ON `messages` (`note_id`,`id`);--> statement-breakpoint
CREATE INDEX `recordings_note_idx` ON `recordings` (`note_id`);--> statement-breakpoint
CREATE INDEX `project_notes_note_idx` ON `project_notes` (`note_id`);--> statement-breakpoint
CREATE INDEX `project_pages_page_idx` ON `project_pages` (`page_id`);
--> statement-breakpoint
UPDATE sqlite_sequence SET seq=max(seq,coalesce((SELECT seq FROM notes_pages_sequences p WHERE p.name=sqlite_sequence.name),seq));
--> statement-breakpoint
INSERT INTO sqlite_sequence(name,seq) SELECT name,seq FROM notes_pages_sequences p WHERE NOT EXISTS(SELECT 1 FROM sqlite_sequence s WHERE s.name=p.name);
--> statement-breakpoint
DROP TABLE notes_pages_sequences;
--> statement-breakpoint
CREATE TEMP TABLE notes_pages_json (old TEXT PRIMARY KEY, migrated TEXT NOT NULL);
--> statement-breakpoint
INSERT OR IGNORE INTO notes_pages_json SELECT "value","value" FROM "preferences" WHERE "scope" IN ('workspace','sidebar','agent-rules') AND "value" IS NOT NULL AND json_valid("value");
--> statement-breakpoint
INSERT OR IGNORE INTO notes_pages_json SELECT "selection","selection" FROM "notes" WHERE "selection" IS NOT NULL AND json_valid("selection");
--> statement-breakpoint
INSERT OR IGNORE INTO notes_pages_json SELECT "result","result" FROM "workflow_activities" WHERE "result" IS NOT NULL AND json_valid("result");
--> statement-breakpoint
INSERT OR IGNORE INTO notes_pages_json SELECT "result","result" FROM "workflow_deferreds" WHERE "result" IS NOT NULL AND json_valid("result");
--> statement-breakpoint
INSERT OR IGNORE INTO notes_pages_json SELECT "payload","payload" FROM "workflow_executions" WHERE "payload" IS NOT NULL AND json_valid("payload");
--> statement-breakpoint
INSERT OR IGNORE INTO notes_pages_json SELECT "result","result" FROM "workflow_executions" WHERE "result" IS NOT NULL AND json_valid("result");
--> statement-breakpoint
INSERT OR IGNORE INTO notes_pages_json SELECT "payload","payload" FROM "workflow_events" WHERE "payload" IS NOT NULL AND json_valid("payload");
--> statement-breakpoint
INSERT OR IGNORE INTO notes_pages_json SELECT "tools","tools" FROM "workflow_agent_progress" WHERE "tools" IS NOT NULL AND json_valid("tools");
--> statement-breakpoint
INSERT OR IGNORE INTO notes_pages_json SELECT "snapshot","snapshot" FROM "note_reply_requests" WHERE "snapshot" IS NOT NULL AND json_valid("snapshot");
--> statement-breakpoint
INSERT OR IGNORE INTO notes_pages_json SELECT "intent","intent" FROM "note_run_contexts" WHERE "intent" IS NOT NULL AND json_valid("intent");
--> statement-breakpoint
INSERT OR IGNORE INTO notes_pages_json SELECT "snapshot","snapshot" FROM "note_run_contexts" WHERE "snapshot" IS NOT NULL AND json_valid("snapshot");
--> statement-breakpoint
INSERT OR IGNORE INTO notes_pages_json SELECT "payload","payload" FROM "material_generation_requests" WHERE "payload" IS NOT NULL AND json_valid("payload");
--> statement-breakpoint
INSERT OR IGNORE INTO notes_pages_json SELECT "selection","selection" FROM "material_deletions" WHERE "selection" IS NOT NULL AND json_valid("selection");
--> statement-breakpoint
INSERT OR IGNORE INTO notes_pages_json SELECT "selection","selection" FROM "material_history_prunes" WHERE "selection" IS NOT NULL AND json_valid("selection");
--> statement-breakpoint
INSERT OR IGNORE INTO notes_pages_json SELECT "payload","payload" FROM "page_annotation_revisions" WHERE "payload" IS NOT NULL AND json_valid("payload");
--> statement-breakpoint
INSERT OR IGNORE INTO notes_pages_json SELECT "payload","payload" FROM "page_citation_assessments" WHERE "payload" IS NOT NULL AND json_valid("payload");
--> statement-breakpoint
INSERT OR IGNORE INTO notes_pages_json SELECT "request","request" FROM "page_transform_requests" WHERE "request" IS NOT NULL AND json_valid("request");
--> statement-breakpoint
INSERT OR IGNORE INTO notes_pages_json SELECT "report","report" FROM "page_transform_requests" WHERE "report" IS NOT NULL AND json_valid("report");
--> statement-breakpoint
INSERT OR IGNORE INTO notes_pages_json SELECT "inputs","inputs" FROM "learning_practice_slots" WHERE "inputs" IS NOT NULL AND json_valid("inputs");
--> statement-breakpoint
INSERT OR IGNORE INTO notes_pages_json SELECT "target","target" FROM "semantic_search_entries" WHERE "target" IS NOT NULL AND json_valid("target");
--> statement-breakpoint
INSERT OR IGNORE INTO notes_pages_json SELECT "input","input" FROM "assistant_tool_receipts" WHERE "input" IS NOT NULL AND json_valid("input");
--> statement-breakpoint
INSERT OR IGNORE INTO notes_pages_json SELECT "result","result" FROM "assistant_tool_receipts" WHERE "result" IS NOT NULL AND json_valid("result");
--> statement-breakpoint
INSERT OR IGNORE INTO notes_pages_json SELECT "state","state" FROM "integration_imports" WHERE "state" IS NOT NULL AND json_valid("state");
--> statement-breakpoint
-- Visit children before their parents; moving an object retains already migrated children.
UPDATE notes_pages_json SET migrated=(
 WITH RECURSIVE operations AS (
  SELECT j.fullkey,j.path,CASE
 WHEN j.key IN ('sessions','documents') AND j.type='array' AND NOT EXISTS(
  SELECT 1 FROM json_each(j.value) item WHERE item.type!='object'
  OR json_type(CASE WHEN item.type='object' THEN item.value ELSE '{}' END,'$.title') IS NOT 'text'
  OR (json_type(CASE WHEN item.type='object' THEN item.value ELSE '{}' END,'$.id') IS NULL
   AND json_type(CASE WHEN item.type='object' THEN item.value ELSE '{}' END,'$.key') IS NULL)
 ) THEN CASE j.key WHEN 'sessions' THEN 'notes' ELSE 'pages' END
 WHEN j.key='documents' AND j.type='object' AND json_type(j.value,'$.items')='array'
 AND json_type(j.value,'$.nextCursor') IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM json_each(j.value,'$.items') item WHERE item.type!='object'
  OR json_type(CASE WHEN item.type='object' THEN item.value ELSE '{}' END,'$.title') IS NOT 'text'
  OR json_type(CASE WHEN item.type='object' THEN item.value ELSE '{}' END,'$.id') IS NULL
 ) THEN 'pages'
 WHEN j.key='documentId' AND json_type(old,j.path||'.sourceId') IS NULL AND json_type(old,j.path||'.mime') IS NULL AND NOT (json_type(old,j.path||'.ordinal') IS NOT NULL AND json_type(old,j.path||'.before') IS NOT NULL AND json_type(old,j.path||'.after') IS NOT NULL) AND coalesce(json_extract(old,j.path||'.type'),'') NOT IN ('SourceIndexed','SourceCorrectionRequested','passage') THEN 'pageId'
 WHEN j.key='document' AND j.type='object' AND json_type(j.value,'$.id') IS NOT NULL AND json_type(j.value,'$.version') IS NOT NULL THEN 'page'
 WHEN j.key='kind' AND j.atom='document' AND (json_type(old,j.path||'.versionId') IS NOT NULL OR (j.path LIKE '%.target' AND json_type(old,j.path||'.id') IS NOT NULL AND json_type(old,j.path||'.mime') IS NULL)) THEN '@page'
 WHEN j.key IN ('type','kind') AND j.atom IN ('session','document') THEN CASE WHEN j.atom='session' THEN '@note' WHEN j.key='type' THEN '@page' ELSE NULL END
 WHEN j.key='toolName' AND j.atom IN ('read_session_context','edit_session_note','list_session_sources','read_session_source','list_documents','read_document','create_document','save_document','update_document_metadata','archive_document','list_document_versions','read_document_version','restore_document_version','link_document_subject','unlink_document_subject','link_document_session','unlink_document_session','list_sessions','read_session','create_session','rename_session','read_session_history','link_session_subject','unlink_session_subject') THEN '@'||(CASE j.atom WHEN 'read_session_context' THEN 'read_note_context' WHEN 'edit_session_note' THEN 'edit_note_message' WHEN 'list_session_sources' THEN 'list_note_sources' WHEN 'read_session_source' THEN 'read_note_source' WHEN 'list_documents' THEN 'list_pages' WHEN 'read_document' THEN 'read_page' WHEN 'create_document' THEN 'create_page' WHEN 'save_document' THEN 'save_page' WHEN 'update_document_metadata' THEN 'update_page_metadata' WHEN 'archive_document' THEN 'archive_page' WHEN 'list_document_versions' THEN 'list_page_versions' WHEN 'read_document_version' THEN 'read_page_version' WHEN 'restore_document_version' THEN 'restore_page_version' WHEN 'link_document_subject' THEN 'link_page_subject' WHEN 'unlink_document_subject' THEN 'unlink_page_subject' WHEN 'link_document_session' THEN 'link_page_note' WHEN 'unlink_document_session' THEN 'unlink_page_note' WHEN 'list_sessions' THEN 'list_notes' WHEN 'read_session' THEN 'read_note' WHEN 'create_session' THEN 'create_note' WHEN 'rename_session' THEN 'rename_note' WHEN 'read_session_history' THEN 'read_note_history' WHEN 'link_session_subject' THEN 'link_note_subject' WHEN 'unlink_session_subject' THEN 'unlink_note_subject' ELSE j.atom END)
 WHEN j.key='agentId' AND j.atom IN ('document-transform','session-assistant') THEN CASE j.atom WHEN 'document-transform' THEN '@page-transform' ELSE '@note-assistant' END
 WHEN j.key='kind' AND j.atom='conversation-boundary' THEN '@note-boundary'
 WHEN j.key='retainedCopies' AND j.atom='authored_outputs_and_raw_session_records' THEN '@authored_outputs_and_raw_note_records'
 WHEN j.key='type' AND j.type='text' AND CASE j.atom WHEN 'ConversationGenerationRequested' THEN 'NoteGenerationRequested' WHEN 'ConversationTitleRequested' THEN 'NoteTitleRequested' WHEN 'ConversationQuestionRequested' THEN 'NoteQuestionRequested' WHEN 'SessionDeletionRequested' THEN 'NoteDeletionRequested' WHEN 'DocumentGenerationRequested' THEN 'PageGenerationRequested' WHEN 'DocumentGenerationFailed' THEN 'PageGenerationFailed' WHEN 'DocumentPublished' THEN 'PagePublished' WHEN 'DocumentAnnotationChanged' THEN 'PageAnnotationChanged' ELSE NULL END IS NOT NULL THEN '@'||(CASE j.atom WHEN 'ConversationGenerationRequested' THEN 'NoteGenerationRequested' WHEN 'ConversationTitleRequested' THEN 'NoteTitleRequested' WHEN 'ConversationQuestionRequested' THEN 'NoteQuestionRequested' WHEN 'SessionDeletionRequested' THEN 'NoteDeletionRequested' WHEN 'DocumentGenerationRequested' THEN 'PageGenerationRequested' WHEN 'DocumentGenerationFailed' THEN 'PageGenerationFailed' WHEN 'DocumentPublished' THEN 'PagePublished' WHEN 'DocumentAnnotationChanged' THEN 'PageAnnotationChanged' ELSE NULL END)
 ELSE CASE j.key WHEN 'sessionId' THEN 'noteId' WHEN 'sessionIds' THEN 'noteIds' WHEN 'targetSessionId' THEN 'targetNoteId' WHEN 'additionalSessionIds' THEN 'additionalNoteIds' WHEN 'includedSessions' THEN 'includedNotes' WHEN 'assistantForSessionId' THEN 'assistantForNoteId' WHEN 'generatedDocumentCount' THEN 'generatedPageCount' WHEN 'documentVersions' THEN 'pageVersions' WHEN 'documentRetirements' THEN 'pageRetirements' WHEN 'settledDocumentThreshold' THEN 'settledPageThreshold' WHEN 'sidebarShowDocumentCounts' THEN 'sidebarShowPageCounts' WHEN 'expandDocuments' THEN 'expandPages' WHEN 'autoTitleSessions' THEN 'autoTitleNotes' ELSE NULL END END AS replacement,
   row_number() OVER (ORDER BY length(j.fullkey) DESC,j.id DESC) AS ordinal
  FROM json_tree(old) j
  WHERE (CASE
 WHEN j.key IN ('sessions','documents') AND j.type='array' AND NOT EXISTS(
  SELECT 1 FROM json_each(j.value) item WHERE item.type!='object'
  OR json_type(CASE WHEN item.type='object' THEN item.value ELSE '{}' END,'$.title') IS NOT 'text'
  OR (json_type(CASE WHEN item.type='object' THEN item.value ELSE '{}' END,'$.id') IS NULL
   AND json_type(CASE WHEN item.type='object' THEN item.value ELSE '{}' END,'$.key') IS NULL)
 ) THEN CASE j.key WHEN 'sessions' THEN 'notes' ELSE 'pages' END
 WHEN j.key='documents' AND j.type='object' AND json_type(j.value,'$.items')='array'
 AND json_type(j.value,'$.nextCursor') IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM json_each(j.value,'$.items') item WHERE item.type!='object'
  OR json_type(CASE WHEN item.type='object' THEN item.value ELSE '{}' END,'$.title') IS NOT 'text'
  OR json_type(CASE WHEN item.type='object' THEN item.value ELSE '{}' END,'$.id') IS NULL
 ) THEN 'pages'
 WHEN j.key='documentId' AND json_type(old,j.path||'.sourceId') IS NULL AND json_type(old,j.path||'.mime') IS NULL AND NOT (json_type(old,j.path||'.ordinal') IS NOT NULL AND json_type(old,j.path||'.before') IS NOT NULL AND json_type(old,j.path||'.after') IS NOT NULL) AND coalesce(json_extract(old,j.path||'.type'),'') NOT IN ('SourceIndexed','SourceCorrectionRequested','passage') THEN 'pageId'
 WHEN j.key='document' AND j.type='object' AND json_type(j.value,'$.id') IS NOT NULL AND json_type(j.value,'$.version') IS NOT NULL THEN 'page'
 WHEN j.key='kind' AND j.atom='document' AND (json_type(old,j.path||'.versionId') IS NOT NULL OR (j.path LIKE '%.target' AND json_type(old,j.path||'.id') IS NOT NULL AND json_type(old,j.path||'.mime') IS NULL)) THEN '@page'
 WHEN j.key IN ('type','kind') AND j.atom IN ('session','document') THEN CASE WHEN j.atom='session' THEN '@note' WHEN j.key='type' THEN '@page' ELSE NULL END
 WHEN j.key='toolName' AND j.atom IN ('read_session_context','edit_session_note','list_session_sources','read_session_source','list_documents','read_document','create_document','save_document','update_document_metadata','archive_document','list_document_versions','read_document_version','restore_document_version','link_document_subject','unlink_document_subject','link_document_session','unlink_document_session','list_sessions','read_session','create_session','rename_session','read_session_history','link_session_subject','unlink_session_subject') THEN '@'||(CASE j.atom WHEN 'read_session_context' THEN 'read_note_context' WHEN 'edit_session_note' THEN 'edit_note_message' WHEN 'list_session_sources' THEN 'list_note_sources' WHEN 'read_session_source' THEN 'read_note_source' WHEN 'list_documents' THEN 'list_pages' WHEN 'read_document' THEN 'read_page' WHEN 'create_document' THEN 'create_page' WHEN 'save_document' THEN 'save_page' WHEN 'update_document_metadata' THEN 'update_page_metadata' WHEN 'archive_document' THEN 'archive_page' WHEN 'list_document_versions' THEN 'list_page_versions' WHEN 'read_document_version' THEN 'read_page_version' WHEN 'restore_document_version' THEN 'restore_page_version' WHEN 'link_document_subject' THEN 'link_page_subject' WHEN 'unlink_document_subject' THEN 'unlink_page_subject' WHEN 'link_document_session' THEN 'link_page_note' WHEN 'unlink_document_session' THEN 'unlink_page_note' WHEN 'list_sessions' THEN 'list_notes' WHEN 'read_session' THEN 'read_note' WHEN 'create_session' THEN 'create_note' WHEN 'rename_session' THEN 'rename_note' WHEN 'read_session_history' THEN 'read_note_history' WHEN 'link_session_subject' THEN 'link_note_subject' WHEN 'unlink_session_subject' THEN 'unlink_note_subject' ELSE j.atom END)
 WHEN j.key='agentId' AND j.atom IN ('document-transform','session-assistant') THEN CASE j.atom WHEN 'document-transform' THEN '@page-transform' ELSE '@note-assistant' END
 WHEN j.key='kind' AND j.atom='conversation-boundary' THEN '@note-boundary'
 WHEN j.key='retainedCopies' AND j.atom='authored_outputs_and_raw_session_records' THEN '@authored_outputs_and_raw_note_records'
 WHEN j.key='type' AND j.type='text' AND CASE j.atom WHEN 'ConversationGenerationRequested' THEN 'NoteGenerationRequested' WHEN 'ConversationTitleRequested' THEN 'NoteTitleRequested' WHEN 'ConversationQuestionRequested' THEN 'NoteQuestionRequested' WHEN 'SessionDeletionRequested' THEN 'NoteDeletionRequested' WHEN 'DocumentGenerationRequested' THEN 'PageGenerationRequested' WHEN 'DocumentGenerationFailed' THEN 'PageGenerationFailed' WHEN 'DocumentPublished' THEN 'PagePublished' WHEN 'DocumentAnnotationChanged' THEN 'PageAnnotationChanged' ELSE NULL END IS NOT NULL THEN '@'||(CASE j.atom WHEN 'ConversationGenerationRequested' THEN 'NoteGenerationRequested' WHEN 'ConversationTitleRequested' THEN 'NoteTitleRequested' WHEN 'ConversationQuestionRequested' THEN 'NoteQuestionRequested' WHEN 'SessionDeletionRequested' THEN 'NoteDeletionRequested' WHEN 'DocumentGenerationRequested' THEN 'PageGenerationRequested' WHEN 'DocumentGenerationFailed' THEN 'PageGenerationFailed' WHEN 'DocumentPublished' THEN 'PagePublished' WHEN 'DocumentAnnotationChanged' THEN 'PageAnnotationChanged' ELSE NULL END)
 ELSE CASE j.key WHEN 'sessionId' THEN 'noteId' WHEN 'sessionIds' THEN 'noteIds' WHEN 'targetSessionId' THEN 'targetNoteId' WHEN 'additionalSessionIds' THEN 'additionalNoteIds' WHEN 'includedSessions' THEN 'includedNotes' WHEN 'assistantForSessionId' THEN 'assistantForNoteId' WHEN 'generatedDocumentCount' THEN 'generatedPageCount' WHEN 'documentVersions' THEN 'pageVersions' WHEN 'documentRetirements' THEN 'pageRetirements' WHEN 'settledDocumentThreshold' THEN 'settledPageThreshold' WHEN 'sidebarShowDocumentCounts' THEN 'sidebarShowPageCounts' WHEN 'expandDocuments' THEN 'expandPages' WHEN 'autoTitleSessions' THEN 'autoTitleNotes' ELSE NULL END END) IS NOT NULL AND NOT EXISTS (
   SELECT 1 FROM json_tree(old) canonical
   WHERE canonical.type IN ('object','array') AND (canonical.key IN ('meta','metadata') OR (canonical.type='object' AND json_type(canonical.value,'$.blocks')='array'))
   AND (j.fullkey=canonical.fullkey OR substr(j.fullkey,1,length(canonical.fullkey)+1) IN (canonical.fullkey||'.',canonical.fullkey||'['))
  )
 ), rewritten(ordinal,value) AS (
  SELECT 0,old UNION ALL
  SELECT o.ordinal,CASE WHEN substr(o.replacement,1,1)='@'
   THEN json_set(r.value,o.fullkey,substr(o.replacement,2))
   ELSE json_remove(json_set(r.value,o.path||'.'||o.replacement,json(r.value -> o.fullkey)),o.fullkey) END
  FROM rewritten r JOIN operations o ON o.ordinal=r.ordinal+1
 ) SELECT value FROM rewritten ORDER BY ordinal DESC LIMIT 1
);
--> statement-breakpoint
UPDATE "preferences" SET "value"=(SELECT migrated FROM notes_pages_json WHERE old="preferences"."value") WHERE "value" IN (SELECT old FROM notes_pages_json WHERE old!=migrated);
--> statement-breakpoint
UPDATE "notes" SET "selection"=(SELECT migrated FROM notes_pages_json WHERE old="notes"."selection") WHERE "selection" IN (SELECT old FROM notes_pages_json WHERE old!=migrated);
--> statement-breakpoint
UPDATE "workflow_activities" SET "result"=(SELECT migrated FROM notes_pages_json WHERE old="workflow_activities"."result") WHERE "result" IN (SELECT old FROM notes_pages_json WHERE old!=migrated);
--> statement-breakpoint
UPDATE "workflow_deferreds" SET "result"=(SELECT migrated FROM notes_pages_json WHERE old="workflow_deferreds"."result") WHERE "result" IN (SELECT old FROM notes_pages_json WHERE old!=migrated);
--> statement-breakpoint
UPDATE "workflow_executions" SET "payload"=(SELECT migrated FROM notes_pages_json WHERE old="workflow_executions"."payload") WHERE "payload" IN (SELECT old FROM notes_pages_json WHERE old!=migrated);
--> statement-breakpoint
UPDATE "workflow_executions" SET "result"=(SELECT migrated FROM notes_pages_json WHERE old="workflow_executions"."result") WHERE "result" IN (SELECT old FROM notes_pages_json WHERE old!=migrated);
--> statement-breakpoint
UPDATE "workflow_events" SET "payload"=(SELECT migrated FROM notes_pages_json WHERE old="workflow_events"."payload") WHERE "payload" IN (SELECT old FROM notes_pages_json WHERE old!=migrated);
--> statement-breakpoint
UPDATE "workflow_agent_progress" SET "tools"=(SELECT migrated FROM notes_pages_json WHERE old="workflow_agent_progress"."tools") WHERE "tools" IN (SELECT old FROM notes_pages_json WHERE old!=migrated);
--> statement-breakpoint
UPDATE "note_reply_requests" SET "snapshot"=(SELECT migrated FROM notes_pages_json WHERE old="note_reply_requests"."snapshot") WHERE "snapshot" IN (SELECT old FROM notes_pages_json WHERE old!=migrated);
--> statement-breakpoint
UPDATE "note_run_contexts" SET "intent"=(SELECT migrated FROM notes_pages_json WHERE old="note_run_contexts"."intent") WHERE "intent" IN (SELECT old FROM notes_pages_json WHERE old!=migrated);
--> statement-breakpoint
UPDATE "note_run_contexts" SET "snapshot"=(SELECT migrated FROM notes_pages_json WHERE old="note_run_contexts"."snapshot") WHERE "snapshot" IN (SELECT old FROM notes_pages_json WHERE old!=migrated);
--> statement-breakpoint
UPDATE "material_generation_requests" SET "payload"=(SELECT migrated FROM notes_pages_json WHERE old="material_generation_requests"."payload") WHERE "payload" IN (SELECT old FROM notes_pages_json WHERE old!=migrated);
--> statement-breakpoint
UPDATE "material_deletions" SET "selection"=(SELECT migrated FROM notes_pages_json WHERE old="material_deletions"."selection") WHERE "selection" IN (SELECT old FROM notes_pages_json WHERE old!=migrated);
--> statement-breakpoint
UPDATE "material_history_prunes" SET "selection"=(SELECT migrated FROM notes_pages_json WHERE old="material_history_prunes"."selection") WHERE "selection" IN (SELECT old FROM notes_pages_json WHERE old!=migrated);
--> statement-breakpoint
UPDATE "page_annotation_revisions" SET "payload"=(SELECT migrated FROM notes_pages_json WHERE old="page_annotation_revisions"."payload") WHERE "payload" IN (SELECT old FROM notes_pages_json WHERE old!=migrated);
--> statement-breakpoint
UPDATE "page_citation_assessments" SET "payload"=(SELECT migrated FROM notes_pages_json WHERE old="page_citation_assessments"."payload") WHERE "payload" IN (SELECT old FROM notes_pages_json WHERE old!=migrated);
--> statement-breakpoint
UPDATE "page_transform_requests" SET "request"=(SELECT migrated FROM notes_pages_json WHERE old="page_transform_requests"."request") WHERE "request" IN (SELECT old FROM notes_pages_json WHERE old!=migrated);
--> statement-breakpoint
UPDATE "page_transform_requests" SET "report"=(SELECT migrated FROM notes_pages_json WHERE old="page_transform_requests"."report") WHERE "report" IN (SELECT old FROM notes_pages_json WHERE old!=migrated);
--> statement-breakpoint
UPDATE "learning_practice_slots" SET "inputs"=(SELECT migrated FROM notes_pages_json WHERE old="learning_practice_slots"."inputs") WHERE "inputs" IN (SELECT old FROM notes_pages_json WHERE old!=migrated);
--> statement-breakpoint
UPDATE "semantic_search_entries" SET "target"=(SELECT migrated FROM notes_pages_json WHERE old="semantic_search_entries"."target") WHERE "target" IN (SELECT old FROM notes_pages_json WHERE old!=migrated);
--> statement-breakpoint
UPDATE "assistant_tool_receipts" SET "input"=(SELECT migrated FROM notes_pages_json WHERE old="assistant_tool_receipts"."input") WHERE "input" IN (SELECT old FROM notes_pages_json WHERE old!=migrated);
--> statement-breakpoint
UPDATE "assistant_tool_receipts" SET "result"=(SELECT migrated FROM notes_pages_json WHERE old="assistant_tool_receipts"."result") WHERE "result" IN (SELECT old FROM notes_pages_json WHERE old!=migrated);
--> statement-breakpoint
UPDATE "integration_imports" SET "state"=(SELECT migrated FROM notes_pages_json WHERE old="integration_imports"."state") WHERE "state" IN (SELECT old FROM notes_pages_json WHERE old!=migrated);
--> statement-breakpoint
DROP TABLE notes_pages_json;
--> statement-breakpoint
UPDATE workflow_events SET type=CASE type WHEN 'ConversationGenerationRequested' THEN 'NoteGenerationRequested' WHEN 'ConversationTitleRequested' THEN 'NoteTitleRequested' WHEN 'ConversationQuestionRequested' THEN 'NoteQuestionRequested' WHEN 'SessionDeletionRequested' THEN 'NoteDeletionRequested' WHEN 'DocumentGenerationRequested' THEN 'PageGenerationRequested' WHEN 'DocumentGenerationFailed' THEN 'PageGenerationFailed' WHEN 'DocumentPublished' THEN 'PagePublished' WHEN 'DocumentAnnotationChanged' THEN 'PageAnnotationChanged' ELSE type END;
--> statement-breakpoint
UPDATE catalog_fts SET kind=CASE kind WHEN 'session' THEN 'note' WHEN 'document' THEN 'page' ELSE kind END WHERE kind IN ('session','document');
--> statement-breakpoint
UPDATE semantic_search_entries SET kind=CASE kind WHEN 'session' THEN 'note' WHEN 'document' THEN 'page' ELSE kind END;
--> statement-breakpoint
UPDATE note_retired_intents SET reason='note_deleted' WHERE reason='session_deleted';
--> statement-breakpoint
UPDATE preferences SET key='pages' WHERE key='documents' AND scope='agent-rules';
--> statement-breakpoint
UPDATE workflow_agent_progress SET agent_id=CASE agent_id WHEN 'document-transform' THEN 'page-transform' WHEN 'session-assistant' THEN 'note-assistant' ELSE agent_id END;
--> statement-breakpoint
UPDATE ai_usage SET agent=CASE agent WHEN 'document-transform' THEN 'page-transform' WHEN 'session-assistant' THEN 'note-assistant' ELSE agent END;
--> statement-breakpoint
UPDATE assistant_tool_receipts SET name=CASE name WHEN 'read_session_context' THEN 'read_note_context' WHEN 'edit_session_note' THEN 'edit_note_message' WHEN 'list_session_sources' THEN 'list_note_sources' WHEN 'read_session_source' THEN 'read_note_source' WHEN 'list_documents' THEN 'list_pages' WHEN 'read_document' THEN 'read_page' WHEN 'create_document' THEN 'create_page' WHEN 'save_document' THEN 'save_page' WHEN 'update_document_metadata' THEN 'update_page_metadata' WHEN 'archive_document' THEN 'archive_page' WHEN 'list_document_versions' THEN 'list_page_versions' WHEN 'read_document_version' THEN 'read_page_version' WHEN 'restore_document_version' THEN 'restore_page_version' WHEN 'link_document_subject' THEN 'link_page_subject' WHEN 'unlink_document_subject' THEN 'unlink_page_subject' WHEN 'link_document_session' THEN 'link_page_note' WHEN 'unlink_document_session' THEN 'unlink_page_note' WHEN 'list_sessions' THEN 'list_notes' WHEN 'read_session' THEN 'read_note' WHEN 'create_session' THEN 'create_note' WHEN 'rename_session' THEN 'rename_note' WHEN 'read_session_history' THEN 'read_note_history' WHEN 'link_session_subject' THEN 'link_note_subject' WHEN 'unlink_session_subject' THEN 'unlink_note_subject' ELSE name END;
--> statement-breakpoint
UPDATE preferences SET key='settledPageThreshold' WHERE key='settledDocumentThreshold';
--> statement-breakpoint
UPDATE preferences SET key='sidebarShowPageCounts' WHERE key='sidebarShowDocumentCounts';
--> statement-breakpoint
UPDATE preferences SET key='expandPages' WHERE key='expandDocuments';
--> statement-breakpoint
UPDATE workflow_retired_correlations SET event_type=CASE event_type WHEN 'ConversationGenerationRequested' THEN 'NoteGenerationRequested' WHEN 'ConversationTitleRequested' THEN 'NoteTitleRequested' WHEN 'ConversationQuestionRequested' THEN 'NoteQuestionRequested' WHEN 'SessionDeletionRequested' THEN 'NoteDeletionRequested' WHEN 'DocumentGenerationRequested' THEN 'PageGenerationRequested' WHEN 'DocumentGenerationFailed' THEN 'PageGenerationFailed' WHEN 'DocumentPublished' THEN 'PagePublished' WHEN 'DocumentAnnotationChanged' THEN 'PageAnnotationChanged' ELSE event_type END;
--> statement-breakpoint
UPDATE preferences SET key='autoTitleNotes' WHERE scope='workspace' AND key='autoTitleSessions';
--> statement-breakpoint
-- Restore the existing guards with renamed owners and exact evidence vocabulary.
CREATE TRIGGER authored_source_blocks_delete BEFORE DELETE ON blocks WHEN EXISTS(SELECT 1 FROM (SELECT source_id,revision,snapshot_id FROM "note_reply_sources" UNION ALL SELECT source_id,revision,snapshot_id FROM "note_context_sources" UNION ALL SELECT source_id,source_revision,source_snapshot_id FROM "page_inputs" WHERE source_id IS NOT NULL UNION ALL SELECT source_id,source_revision,source_snapshot_id FROM material_evidence_inputs WHERE source_id IS NOT NULL UNION ALL SELECT source_id,source_revision,source_snapshot_id FROM learning_practice_inputs WHERE source_id IS NOT NULL) p WHERE p.snapshot_id=OLD.document_id) BEGIN SELECT RAISE(ABORT,'exact evidence pins source extraction'); END;
--> statement-breakpoint
CREATE TRIGGER authored_source_blocks_insert BEFORE INSERT ON blocks WHEN EXISTS(SELECT 1 FROM "page_inputs" WHERE source_snapshot_id=NEW.document_id) BEGIN SELECT RAISE(ABORT,'authored provenance pins exact source extraction'); END;
--> statement-breakpoint
CREATE TRIGGER authored_source_blocks_update BEFORE UPDATE ON blocks WHEN EXISTS(SELECT 1 FROM (SELECT source_id,revision,snapshot_id FROM "note_reply_sources" UNION ALL SELECT source_id,revision,snapshot_id FROM "note_context_sources" UNION ALL SELECT source_id,source_revision,source_snapshot_id FROM "page_inputs" WHERE source_id IS NOT NULL UNION ALL SELECT source_id,source_revision,source_snapshot_id FROM material_evidence_inputs WHERE source_id IS NOT NULL UNION ALL SELECT source_id,source_revision,source_snapshot_id FROM learning_practice_inputs WHERE source_id IS NOT NULL) p WHERE p.snapshot_id=OLD.document_id) BEGIN SELECT RAISE(ABORT,'exact evidence pins source extraction'); END;
--> statement-breakpoint
CREATE TRIGGER authored_source_content_snapshots_delete BEFORE DELETE ON content_snapshots WHEN EXISTS(SELECT 1 FROM (SELECT source_id,revision,snapshot_id FROM "note_reply_sources" UNION ALL SELECT source_id,revision,snapshot_id FROM "note_context_sources" UNION ALL SELECT source_id,source_revision,source_snapshot_id FROM "page_inputs" WHERE source_id IS NOT NULL UNION ALL SELECT source_id,source_revision,source_snapshot_id FROM material_evidence_inputs WHERE source_id IS NOT NULL UNION ALL SELECT source_id,source_revision,source_snapshot_id FROM learning_practice_inputs WHERE source_id IS NOT NULL) p WHERE p.snapshot_id=OLD.id) BEGIN SELECT RAISE(ABORT,'exact evidence pins source extraction'); END;
--> statement-breakpoint
CREATE TRIGGER authored_source_content_snapshots_update BEFORE UPDATE ON content_snapshots WHEN EXISTS(SELECT 1 FROM (SELECT source_id,revision,snapshot_id FROM "note_reply_sources" UNION ALL SELECT source_id,revision,snapshot_id FROM "note_context_sources" UNION ALL SELECT source_id,source_revision,source_snapshot_id FROM "page_inputs" WHERE source_id IS NOT NULL UNION ALL SELECT source_id,source_revision,source_snapshot_id FROM material_evidence_inputs WHERE source_id IS NOT NULL UNION ALL SELECT source_id,source_revision,source_snapshot_id FROM learning_practice_inputs WHERE source_id IS NOT NULL) p WHERE p.snapshot_id=OLD.id) BEGIN SELECT RAISE(ABORT,'exact evidence pins source extraction'); END;
--> statement-breakpoint
CREATE TRIGGER authored_source_revision_update BEFORE UPDATE ON source_snapshots WHEN EXISTS(SELECT 1 FROM "page_inputs" WHERE source_id=OLD.source_id AND source_revision=OLD.revision) BEGIN SELECT RAISE(ABORT,'authored provenance pins exact source revision'); END;
--> statement-breakpoint
CREATE TRIGGER catalog_project_delete AFTER DELETE ON projects BEGIN DELETE FROM catalog_fts WHERE kind='project' AND target_id=old.id; END;
--> statement-breakpoint
CREATE TRIGGER catalog_project_insert AFTER INSERT ON projects BEGIN INSERT INTO catalog_fts VALUES(new.name, 'project', new.id, new.id); END;
--> statement-breakpoint
CREATE TRIGGER catalog_project_update AFTER UPDATE OF name ON projects BEGIN DELETE FROM catalog_fts WHERE kind='project' AND target_id=old.id; INSERT INTO catalog_fts VALUES(new.name, 'project', new.id, new.id); END;
--> statement-breakpoint
CREATE TRIGGER catalog_note_delete AFTER DELETE ON "notes" BEGIN
    DELETE FROM catalog_fts WHERE kind = 'session' AND target_id = old.id;
END;
--> statement-breakpoint
CREATE TRIGGER catalog_note_insert AFTER INSERT ON "notes" BEGIN
    INSERT INTO catalog_fts VALUES (new.title, 'session', new.id, NULL);
END;
--> statement-breakpoint
CREATE TRIGGER catalog_note_update AFTER UPDATE OF title ON "notes" BEGIN
    DELETE FROM catalog_fts WHERE kind = 'session' AND target_id = old.id;
    INSERT INTO catalog_fts VALUES (new.title, 'session', new.id, NULL);
END;
--> statement-breakpoint
CREATE TRIGGER catalog_source_delete AFTER DELETE ON sources BEGIN DELETE FROM catalog_fts WHERE kind='source' AND target_id=old.id; END;
--> statement-breakpoint
CREATE TRIGGER catalog_source_insert AFTER INSERT ON sources BEGIN INSERT INTO catalog_fts VALUES(new.name, 'source', new.id, new.project_id); END;
--> statement-breakpoint
CREATE TRIGGER catalog_source_update AFTER UPDATE OF name,project_id ON sources BEGIN DELETE FROM catalog_fts WHERE kind='source' AND target_id=OLD.id; INSERT INTO catalog_fts VALUES(NEW.name,'source',NEW.id,NEW.project_id); END;
--> statement-breakpoint
CREATE TRIGGER chunks_fts_ad AFTER DELETE ON chunks BEGIN
    INSERT INTO chunks_fts (chunks_fts, rowid, text) VALUES ('delete', old.id, old.text);
END;
--> statement-breakpoint
CREATE TRIGGER chunks_fts_ai AFTER INSERT ON chunks BEGIN
    INSERT INTO chunks_fts (rowid, text) VALUES (new.id, new.text);
END;
--> statement-breakpoint
CREATE TRIGGER chunks_fts_au AFTER UPDATE OF text ON chunks BEGIN
    INSERT INTO chunks_fts (chunks_fts, rowid, text) VALUES ('delete', old.id, old.text);
    INSERT INTO chunks_fts (rowid, text) VALUES (new.id, new.text);
END;
--> statement-breakpoint
CREATE TRIGGER note_recording_posts_immutable BEFORE UPDATE ON "note_recording_posts"
BEGIN SELECT RAISE(ABORT,'conversation recording post is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER note_recording_posts_retain BEFORE DELETE ON "note_recording_posts"
WHEN EXISTS(SELECT 1 FROM "notes" s WHERE s.id=OLD."note_id")
BEGIN SELECT RAISE(ABORT,'conversation recording post is retained'); END;
--> statement-breakpoint
CREATE TRIGGER note_recording_posts_validate_insert BEFORE INSERT ON "note_recording_posts"
WHEN NOT EXISTS (
 SELECT 1 FROM messages m JOIN "notes" s ON s.id=m."note_id"
 JOIN message_versions v ON v.id=m.active_version_id AND v.message_id=m.id
 JOIN message_parts p ON p.message_id=m.id AND p.ordinal=0 JOIN sources src ON src.id=p.source_id
 WHERE m.id=NEW.message_id AND m."note_id"=NEW."note_id" AND m.role='user' AND m.recording_ms IS NOT NULL AND m.recorded_in=src.id AND v.origin='typed' AND v.status='complete' AND v.text='' AND src.origin='recording' AND src.kind='audio' AND src.mime LIKE 'audio/%'
)
BEGIN SELECT RAISE(ABORT,'invalid conversation recording post'); END;
--> statement-breakpoint
CREATE TRIGGER note_reply_sources_capture BEFORE INSERT ON "note_reply_sources"
WHEN (NEW.snapshot_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "note_reply_requests" r,json_each(r.snapshot,'$.messages') m,json_each(m.value,'$.attachments') p
 WHERE r.request_id=NEW.request_id AND CAST(json_extract(p.value,'$.partId') AS INTEGER)=NEW.part_id
 AND CAST(json_extract(p.value,'$.sourceId') AS INTEGER)=NEW.source_id AND CAST(json_extract(p.value,'$.revision') AS INTEGER)=NEW.revision
 AND CAST(json_extract(p.value,'$.snapshotId') AS INTEGER)=NEW.snapshot_id)) OR (NEW.snapshot_id IS NULL AND NOT EXISTS(SELECT 1 FROM "note_reply_requests" r,json_each(r.snapshot,'$.pendingAttachments') p
 WHERE r.request_id=NEW.request_id AND CAST(json_extract(p.value,'$.partId') AS INTEGER)=NEW.part_id
 AND CAST(json_extract(p.value,'$.sourceId') AS INTEGER)=NEW.source_id AND CAST(json_extract(p.value,'$.inputRevision') AS INTEGER)=NEW.revision))
BEGIN SELECT RAISE(ABORT,'reply source pin does not match exact captured intent'); END;
--> statement-breakpoint
CREATE TRIGGER note_reply_sources_immutable BEFORE UPDATE ON "note_reply_sources"
WHEN NEW.request_id IS NOT OLD.request_id OR NEW.part_id IS NOT OLD.part_id OR NEW.source_id IS NOT OLD.source_id OR NEW.revision IS NOT OLD.revision
 OR (OLD.snapshot_id IS NOT NULL AND NEW.snapshot_id IS NOT OLD.snapshot_id) OR (NEW.snapshot_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "note_reply_requests" r,json_each(r.snapshot,'$.messages') m,json_each(m.value,'$.attachments') p
 WHERE r.request_id=NEW.request_id AND CAST(json_extract(p.value,'$.partId') AS INTEGER)=NEW.part_id
 AND CAST(json_extract(p.value,'$.sourceId') AS INTEGER)=NEW.source_id AND CAST(json_extract(p.value,'$.revision') AS INTEGER)=NEW.revision
 AND CAST(json_extract(p.value,'$.snapshotId') AS INTEGER)=NEW.snapshot_id))
BEGIN SELECT RAISE(ABORT,'reply source identity is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER note_reply_sources_retained BEFORE DELETE ON "note_reply_sources"
WHEN EXISTS(SELECT 1 FROM "note_reply_requests" r WHERE r.request_id=OLD.request_id)
BEGIN SELECT RAISE(ABORT,'retained reply source pins require capture retirement'); END;
--> statement-breakpoint
CREATE TRIGGER document_asset_insert AFTER INSERT ON blocks WHEN new.kind='image'
BEGIN
INSERT INTO document_assets(document_id,block_id,source_id,revision)
SELECT new.document_id,new.editing_id,CAST(json_extract(new.content,'$.sourceId') AS INTEGER),json_extract(new.content,'$.revision');
END;
--> statement-breakpoint
CREATE TRIGGER document_asset_kind BEFORE INSERT ON document_assets
WHEN NOT EXISTS(SELECT 1 FROM blocks b WHERE b.document_id=new.document_id AND b.editing_id=new.block_id AND b.kind='image' AND CAST(json_extract(b.content,'$.sourceId') AS INTEGER)=new.source_id AND json_extract(b.content,'$.revision')=new.revision) OR NOT EXISTS(SELECT 1 FROM source_snapshots ss WHERE ss.source_id=new.source_id AND ss.revision=new.revision AND ss.kind='image' AND lower(ss.mime) LIKE 'image/%')
BEGIN SELECT RAISE(ABORT, 'managed image revision is unavailable'); END;
--> statement-breakpoint
CREATE TRIGGER document_asset_snapshot_delete BEFORE DELETE ON source_snapshots
WHEN EXISTS(SELECT 1 FROM document_assets a WHERE a.source_id=old.source_id AND a.revision=old.revision)
BEGIN SELECT RAISE(ABORT, 'retained document asset is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER document_asset_snapshot_update BEFORE UPDATE ON source_snapshots
WHEN EXISTS(SELECT 1 FROM document_assets a WHERE a.source_id=old.source_id AND a.revision=old.revision)
BEGIN SELECT RAISE(ABORT, 'retained document asset is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER document_asset_update AFTER UPDATE OF content,kind,editing_id,document_id ON blocks
BEGIN
DELETE FROM document_assets WHERE document_id=old.document_id AND block_id=old.editing_id;
INSERT INTO document_assets(document_id,block_id,source_id,revision)
SELECT new.document_id,new.editing_id,CAST(json_extract(new.content,'$.sourceId') AS INTEGER),json_extract(new.content,'$.revision') WHERE new.kind='image';
END;
--> statement-breakpoint
CREATE TRIGGER document_asset_update_forbidden BEFORE UPDATE ON document_assets
BEGIN SELECT RAISE(ABORT, 'asset associations follow canonical blocks'); END;
--> statement-breakpoint
CREATE TRIGGER generation_history_publication BEFORE UPDATE ON material_generation_requests WHEN EXISTS(SELECT 1 FROM material_history_requests WHERE request_id=OLD.id) AND NOT((NEW.cancelled=1 AND NEW.payload='{}' AND NEW.result_version_id IS NULL AND NEW.result_hash IS NULL) OR (NEW.result_version_id IS NULL AND NEW.result_hash IS NULL AND NEW.payload IS OLD.payload AND NEW.cancelled IS OLD.cancelled)) BEGIN SELECT RAISE(ABORT,'retired generation cannot publish'); END;
--> statement-breakpoint
CREATE TRIGGER learning_practice_control_identity
BEFORE UPDATE ON learning_practice_controls
WHEN NEW.project_id IS NOT OLD.project_id
  OR (OLD.enabled = 1 AND NEW.epoch IS NOT OLD.epoch)
  OR (OLD.enabled = 0 AND NEW.enabled = 1 AND NEW.epoch = OLD.epoch)
BEGIN SELECT RAISE(ABORT, 'practice control requires a fresh epoch'); END;
--> statement-breakpoint
CREATE TRIGGER learning_practice_control_retained
BEFORE DELETE ON learning_practice_controls
WHEN EXISTS (SELECT 1 FROM projects WHERE id = OLD.project_id)
BEGIN SELECT RAISE(ABORT, 'practice control is retained'); END;
--> statement-breakpoint
CREATE TRIGGER learning_practice_failure_clear
BEFORE UPDATE OF failure_kind ON learning_practice_slots
WHEN OLD.failure_kind IS NOT NULL AND NEW.failure_kind IS NULL
  AND NEW.generation_attempt = OLD.generation_attempt
  AND NEW.status = 'pending'
BEGIN SELECT RAISE(ABORT, 'practice failures require an explicit retry'); END;
--> statement-breakpoint
CREATE TRIGGER learning_practice_inputs_available BEFORE INSERT ON learning_practice_inputs
WHEN NEW."page_version_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "page_versions" v JOIN "pages" d ON d.id=v."page_id"
WHERE v.id=NEW."page_version_id" AND v.status='published' AND d.archived_at IS NULL
AND NOT EXISTS(SELECT 1 FROM "page_retirements" r WHERE r.version_id=v.id))
BEGIN SELECT RAISE(ABORT,'exact authored learning input is unavailable'); END;
--> statement-breakpoint
CREATE TRIGGER learning_practice_inputs_capture BEFORE INSERT ON learning_practice_inputs
WHEN NOT EXISTS(SELECT 1 FROM learning_practice_slots p WHERE p.id=NEW.slot_id AND p.status IN ('pending','ready')
 AND json_extract(p.inputs,'$['||NEW.position||'].kind')=CASE WHEN NEW."page_version_id" IS NULL THEN 'source' ELSE 'page' END
 AND json_extract(p.inputs,'$['||NEW.position||'].versionId') IS CASE WHEN NEW."page_version_id" IS NULL THEN NULL ELSE CAST(NEW."page_version_id" AS TEXT) END
 AND json_extract(p.inputs,'$['||NEW.position||'].sourceId') IS CASE WHEN NEW.source_id IS NULL THEN NULL ELSE CAST(NEW.source_id AS TEXT) END
 AND json_extract(p.inputs,'$['||NEW.position||'].revision') IS CASE WHEN NEW.source_revision IS NULL THEN NULL ELSE CAST(NEW.source_revision AS TEXT) END
 AND json_extract(p.inputs,'$['||NEW.position||'].snapshotId') IS CASE WHEN NEW.source_snapshot_id IS NULL THEN NULL ELSE CAST(NEW.source_snapshot_id AS TEXT) END)
BEGIN SELECT RAISE(ABORT,'practice evidence does not match exact capture'); END;
--> statement-breakpoint
CREATE TRIGGER learning_practice_inputs_immutable BEFORE UPDATE ON learning_practice_inputs
BEGIN SELECT RAISE(ABORT,'exact learning inputs are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER learning_practice_inputs_retained BEFORE DELETE ON learning_practice_inputs
WHEN EXISTS(SELECT 1 FROM learning_practice_slots p JOIN learning_practice_controls c ON c.project_id=p.project_id AND c.epoch=p.epoch
 WHERE p.id=OLD.slot_id AND p.status IN ('pending','ready') AND c.enabled=1)
BEGIN SELECT RAISE(ABORT,'active practice evidence is retained'); END;
--> statement-breakpoint
CREATE TRIGGER learning_practice_retry_capture
BEFORE INSERT ON learning_practice_slots
WHEN NEW.generation_attempt != 0 OR NEW.failure_kind IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'practice slots start with an unfailed first generation'); END;
--> statement-breakpoint
CREATE TRIGGER learning_practice_retry_transition
BEFORE UPDATE OF generation_attempt ON learning_practice_slots
WHEN NEW.generation_attempt IS NOT OLD.generation_attempt AND (
  OLD.status != 'pending' OR NEW.status != 'pending'
  OR OLD.failure_kind IS NULL OR NEW.failure_kind IS NOT NULL
  OR typeof(NEW.generation_attempt) != 'integer'
  OR NEW.generation_attempt != OLD.generation_attempt + 1
  OR NEW.generation_attempt > 9007199254740991
)
BEGIN SELECT RAISE(ABORT, 'practice retry must advance a failed generation exactly once'); END;
--> statement-breakpoint
CREATE TRIGGER learning_practice_selection_delete
BEFORE DELETE ON material_quiz_selections
WHEN ((EXISTS (
  SELECT 1 FROM learning_practice_slots p JOIN projects owner ON owner.id = p.project_id
  WHERE p.attempt_id = OLD.attempt_id AND p.status = 'answered'
)) AND NOT (EXISTS(SELECT 1 FROM material_deletion_members dm JOIN material_deletions d ON d.material_id=dm.deletion_id WHERE dm.material_id=(SELECT material_id FROM material_versions WHERE id=(SELECT version_id FROM material_quiz_attempts WHERE id=OLD.attempt_id)) AND d.status IN ('pending','failed')))) AND NOT (EXISTS(SELECT 1 FROM material_history_members m JOIN material_history_prunes p ON p.operation_id=m.operation_id WHERE m.version_id=(SELECT version_id FROM material_quiz_attempts WHERE id=OLD.attempt_id) AND p.status IN ('pending','failed')))
BEGIN SELECT RAISE(ABORT, 'committed practice answers are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER learning_practice_selection_insert
BEFORE INSERT ON material_quiz_selections
WHEN EXISTS (SELECT 1 FROM learning_practice_slots p WHERE p.attempt_id = NEW.attempt_id AND p.status = 'answered')
BEGIN SELECT RAISE(ABORT, 'committed practice answers are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER learning_practice_selection_update
BEFORE UPDATE ON material_quiz_selections
WHEN EXISTS (SELECT 1 FROM learning_practice_slots p WHERE p.attempt_id IN (OLD.attempt_id, NEW.attempt_id) AND p.status = 'answered')
BEGIN SELECT RAISE(ABORT, 'committed practice answers are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER learning_practice_slot_capture
BEFORE INSERT ON learning_practice_slots
WHEN NEW.status != 'pending' OR NEW.version_id IS NOT NULL OR NEW.attempt_id IS NOT NULL
  OR NEW.kind IS NOT CASE WHEN NEW.ordinal % 3 = 2 THEN 'open' ELSE 'choice' END
  OR NOT EXISTS (SELECT 1 FROM learning_practice_controls c WHERE c.project_id = NEW.project_id AND c.epoch = NEW.epoch AND c.enabled = 1)
  OR (SELECT COUNT(*) FROM learning_practice_slots p WHERE p.project_id = NEW.project_id AND p.epoch = NEW.epoch AND p.status IN ('pending','ready')) >= 2
  OR NEW.ordinal != (SELECT COALESCE(MAX(p.ordinal) + 1, 0) FROM learning_practice_slots p WHERE p.project_id = NEW.project_id AND p.epoch = NEW.epoch)
  OR json_type(NEW.inputs) IS NOT 'array' OR json_array_length(NEW.inputs) NOT BETWEEN 1 AND 20
  OR (SELECT COUNT(DISTINCT value) FROM json_each(NEW.inputs)) != json_array_length(NEW.inputs)
  OR EXISTS(SELECT 1 FROM json_each(NEW.inputs) j WHERE
    (json_extract(j.value,'$.kind')='page' AND NOT EXISTS(
      SELECT 1 FROM "page_versions" v JOIN "pages" d ON d.id=v."page_id"
      JOIN "project_pages" p ON p."page_id"=d.id AND p.project_id=NEW.project_id
      WHERE CAST(v.id AS TEXT)=json_extract(j.value,'$.versionId') AND v.status='published' AND d.archived_at IS NULL
      AND NOT EXISTS(SELECT 1 FROM "page_retirements" r WHERE r.version_id=v.id)))
    OR (json_extract(j.value,'$.kind')='source' AND NOT EXISTS(
      SELECT 1 FROM source_extraction_revisions e JOIN sources s ON s.id=e.source_id
      WHERE CAST(e.source_id AS TEXT)=json_extract(j.value,'$.sourceId') AND CAST(e.revision AS TEXT)=json_extract(j.value,'$.revision')
      AND CAST(e.snapshot_id AS TEXT)=json_extract(j.value,'$.snapshotId') AND s.project_id=NEW.project_id))
    OR json_extract(j.value,'$.kind') IS NULL OR json_extract(j.value,'$.kind') NOT IN ('source','page'))
BEGIN SELECT RAISE(ABORT, 'invalid or unbounded practice slot capture'); END;
--> statement-breakpoint
CREATE TRIGGER learning_practice_slot_immutable
BEFORE UPDATE ON learning_practice_slots
WHEN ((NEW.id IS NOT OLD.id OR NEW.project_id IS NOT OLD.project_id OR NEW.epoch IS NOT OLD.epoch
  OR NEW.ordinal IS NOT OLD.ordinal OR NEW.kind IS NOT OLD.kind OR NEW.inputs IS NOT OLD.inputs
  OR (OLD.version_id IS NOT NULL AND (NEW.version_id IS NOT OLD.version_id OR NEW.attempt_id IS NOT OLD.attempt_id))
  OR (OLD.status IN ('answered','cancelled') AND NEW.status IS NOT OLD.status)
  OR (OLD.status = 'ready' AND NEW.status NOT IN ('ready','answered','cancelled'))
  OR (OLD.status = 'pending' AND NEW.status NOT IN ('pending','ready','cancelled'))) AND NOT (EXISTS(SELECT 1 FROM material_versions v JOIN material_deletion_members d ON d.material_id=v.material_id WHERE v.id=OLD.version_id) AND NEW.status='cancelled' AND NEW.version_id IS NULL AND NEW.attempt_id IS NULL AND NEW.id IS OLD.id AND NEW.project_id IS OLD.project_id AND NEW.epoch IS OLD.epoch AND NEW.ordinal IS OLD.ordinal AND NEW.kind IS OLD.kind AND NEW.inputs IS OLD.inputs AND NEW.generation_attempt IS OLD.generation_attempt AND NEW.failure_kind IS OLD.failure_kind)) AND NOT (EXISTS(SELECT 1 FROM material_history_members h JOIN material_history_prunes p ON p.operation_id=h.operation_id WHERE h.version_id=OLD.version_id AND p.status IN ('pending','failed')) AND NEW.status='cancelled' AND NEW.version_id IS NULL AND NEW.attempt_id IS NULL AND NEW.id IS OLD.id AND NEW.project_id IS OLD.project_id AND NEW.epoch IS OLD.epoch AND NEW.ordinal IS OLD.ordinal AND NEW.kind IS OLD.kind AND NEW.inputs IS OLD.inputs AND NEW.generation_attempt IS OLD.generation_attempt AND NEW.failure_kind IS OLD.failure_kind)
BEGIN SELECT RAISE(ABORT, 'practice slot intent and receipts are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER learning_practice_slot_retained
BEFORE DELETE ON learning_practice_slots
WHEN EXISTS (SELECT 1 FROM projects WHERE id = OLD.project_id)
BEGIN SELECT RAISE(ABORT, 'practice slot is retained'); END;
--> statement-breakpoint
CREATE TRIGGER material_attempt_delete BEFORE DELETE ON material_quiz_attempts
WHEN ((old.status='completed' AND EXISTS(SELECT 1 FROM material_versions v WHERE v.id=old.version_id AND v.status='published')) AND NOT (EXISTS(SELECT 1 FROM material_deletion_members dm JOIN material_deletions d ON d.material_id=dm.deletion_id WHERE dm.material_id=(SELECT material_id FROM material_versions WHERE id=OLD.version_id) AND d.status IN ('pending','failed')))) AND NOT (EXISTS(SELECT 1 FROM material_history_members m JOIN material_history_prunes p ON p.operation_id=m.operation_id WHERE m.version_id=OLD.version_id AND p.status IN ('pending','failed')))
BEGIN SELECT RAISE(ABORT, 'completed attempts cannot be deleted'); END;
--> statement-breakpoint
CREATE TRIGGER material_attempt_identity BEFORE UPDATE ON material_quiz_attempts
WHEN old.status='completed' OR new.id IS NOT old.id OR new.version_id IS NOT old.version_id OR new.started_at IS NOT old.started_at
BEGIN SELECT RAISE(ABORT, 'completed attempts and attempt identities are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_attempt_published BEFORE INSERT ON material_quiz_attempts
WHEN NOT EXISTS(SELECT 1 FROM material_versions v WHERE v.id=new.version_id AND v.status='published') OR new.status != 'in_progress'
BEGIN SELECT RAISE(ABORT, 'quiz attempts must start on a published quiz'); END;
--> statement-breakpoint
CREATE TRIGGER material_card_identity_update BEFORE UPDATE ON material_card_identities
WHEN new.id IS NOT old.id OR new.material_id IS NOT old.material_id OR new.kind IS NOT old.kind
BEGIN SELECT RAISE(ABORT, 'card identity ownership is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_card_reviews_history_insert BEFORE INSERT ON material_card_reviews WHEN EXISTS(SELECT 1 FROM material_history_members WHERE version_id=NEW.version_id) BEGIN SELECT RAISE(ABORT,'pruned practice content is unavailable'); END;
--> statement-breakpoint
CREATE TRIGGER material_deletion_identity BEFORE UPDATE ON material_deletions
WHEN NEW.material_id IS NOT OLD.material_id OR NEW.operation_id IS NOT OLD.operation_id OR NEW.selection IS NOT OLD.selection OR NEW.created_at IS NOT OLD.created_at
 OR (OLD.status='completed' AND (NEW.status IS NOT OLD.status OR NEW.phase IS NOT OLD.phase OR NEW.attempt IS NOT OLD.attempt OR NEW.completed_at IS NOT OLD.completed_at OR NEW.error_kind IS NOT OLD.error_kind))
BEGIN SELECT RAISE(ABORT,'deletion identity is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_deletion_member_valid BEFORE INSERT ON material_deletion_members
WHEN NOT EXISTS(SELECT 1 FROM material_deletions d JOIN json_each(d.selection) i WHERE d.material_id=NEW.deletion_id AND d.status='pending' AND CAST(i.value AS INTEGER)=NEW.material_id)
BEGIN SELECT RAISE(ABORT,'deletion member requires exact accepted selection'); END;
--> statement-breakpoint
CREATE TRIGGER material_deletion_members_delete_retained BEFORE DELETE ON material_deletion_members BEGIN SELECT RAISE(ABORT,'deletion ownership is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_deletion_members_update_retained BEFORE UPDATE ON material_deletion_members BEGIN SELECT RAISE(ABORT,'deletion ownership is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_deletion_publication BEFORE UPDATE OF status ON material_versions WHEN NEW.status='published' AND OLD.status!='published' AND (EXISTS(SELECT 1 FROM material_deletion_members WHERE material_id=NEW.material_id) OR EXISTS(SELECT 1 FROM material_deletion_requests WHERE request_id=NEW.generation_request_id)) BEGIN SELECT RAISE(ABORT,'deleted learning artifact cannot publish'); END;
--> statement-breakpoint
CREATE TRIGGER material_deletion_requests_owned BEFORE INSERT ON material_deletion_requests
WHEN NOT EXISTS(SELECT 1 FROM material_deletions p WHERE p.material_id=NEW.deletion_id AND p.status='pending') OR NOT(
(NEW.kind='generation' AND EXISTS(SELECT 1 FROM material_versions v JOIN material_deletion_members m ON m.material_id=v.material_id WHERE v.generation_request_id=NEW.request_id AND m.deletion_id=NEW.deletion_id))
OR (NEW.kind='publication' AND EXISTS(SELECT 1 FROM workflow_events e JOIN material_versions v ON CAST(v.id AS TEXT)=json_extract(e.payload,'$.materialVersionId') JOIN material_deletion_members m ON m.material_id=v.material_id WHERE e.correlation_id=NEW.request_id AND e.type='MaterialPublished' AND m.deletion_id=NEW.deletion_id))
OR (NEW.kind='learning' AND (EXISTS(SELECT 1 FROM learning_practice_slots p JOIN material_versions v ON v.id=p.version_id JOIN material_deletion_members m ON m.material_id=v.material_id WHERE p.id=NEW.request_id AND m.deletion_id=NEW.deletion_id) OR EXISTS(SELECT 1 FROM workflow_events e JOIN material_quiz_attempts a ON CAST(a.id AS TEXT)=json_extract(e.payload,'$.attemptId') JOIN material_versions v ON v.id=a.version_id JOIN material_deletion_members m ON m.material_id=v.material_id WHERE e.correlation_id=NEW.request_id AND e.type='QuizAnswerSubmitted' AND m.deletion_id=NEW.deletion_id))))
BEGIN SELECT RAISE(ABORT,'retirement requires exact learning ownership'); END;
--> statement-breakpoint
CREATE TRIGGER material_deletion_requests_delete_retained BEFORE DELETE ON material_deletion_requests BEGIN SELECT RAISE(ABORT,'deletion ownership is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_deletion_requests_update_retained BEFORE UPDATE ON material_deletion_requests BEGIN SELECT RAISE(ABORT,'deletion ownership is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_deletion_retained BEFORE DELETE ON material_deletions
BEGIN SELECT RAISE(ABORT,'deletion barrier is retained'); END;
--> statement-breakpoint
CREATE TRIGGER material_deletion_title BEFORE UPDATE ON materials
WHEN EXISTS(SELECT 1 FROM material_deletion_members WHERE material_id=OLD.id) AND (NEW.title!='-' OR NEW.kind IS NOT OLD.kind OR NEW.id IS NOT OLD.id)
BEGIN SELECT RAISE(ABORT,'deleted Material metadata is unavailable'); END;
--> statement-breakpoint
CREATE TRIGGER material_deletion_version_insert BEFORE INSERT ON material_versions
WHEN EXISTS(SELECT 1 FROM material_deletion_members WHERE material_id=NEW.material_id)
BEGIN SELECT RAISE(ABORT,'deleted Material cannot create versions'); END;
--> statement-breakpoint
CREATE TRIGGER material_diagram_versions_delete_draft BEFORE DELETE ON material_diagram_versions
WHEN ((EXISTS(SELECT 1 FROM material_versions v WHERE v.id=old.version_id AND v.status='published')) AND NOT (EXISTS(SELECT 1 FROM material_deletion_members dm JOIN material_deletions d ON d.material_id=dm.deletion_id WHERE dm.material_id=(SELECT material_id FROM material_versions WHERE id=OLD.version_id) AND d.status IN ('pending','failed')))) AND NOT (EXISTS(SELECT 1 FROM material_history_members h JOIN material_history_prunes p ON p.operation_id=h.operation_id WHERE h.version_id=OLD.version_id AND p.status IN ('pending','failed')))
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_diagram_versions_deletion_insert BEFORE INSERT ON material_diagram_versions WHEN EXISTS(SELECT 1 FROM material_versions v JOIN material_deletion_members d ON d.material_id=v.material_id WHERE v.id=NEW.version_id) BEGIN SELECT RAISE(ABORT,'deleted Material cannot restore content'); END;
--> statement-breakpoint
CREATE TRIGGER material_diagram_versions_history_insert BEFORE INSERT ON material_diagram_versions WHEN EXISTS(SELECT 1 FROM material_history_members WHERE version_id=NEW.version_id) BEGIN SELECT RAISE(ABORT,'pruned version cannot restore content'); END;
--> statement-breakpoint
CREATE TRIGGER material_diagram_versions_history_update BEFORE UPDATE ON material_diagram_versions WHEN EXISTS(SELECT 1 FROM material_history_members WHERE version_id=NEW.version_id) BEGIN SELECT RAISE(ABORT,'pruned version cannot restore content'); END;
--> statement-breakpoint
CREATE TRIGGER material_diagram_versions_insert_draft BEFORE INSERT ON material_diagram_versions
WHEN EXISTS(SELECT 1 FROM material_versions v WHERE v.id=new.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_diagram_versions_update_draft BEFORE UPDATE ON material_diagram_versions
WHEN EXISTS(SELECT 1 FROM material_versions v WHERE v.id=old.version_id AND v.status='published') OR EXISTS(SELECT 1 FROM material_versions v WHERE v.id=new.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_evidence_citations_draft BEFORE INSERT ON material_evidence_citations
WHEN NOT EXISTS(SELECT 1 FROM material_versions WHERE id=NEW.version_id AND status='draft')
BEGIN SELECT RAISE(ABORT,'published learning citations are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_evidence_citations_immutable BEFORE UPDATE ON material_evidence_citations
BEGIN SELECT RAISE(ABORT,'exact learning citations are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_evidence_citations_retained BEFORE DELETE ON material_evidence_citations
WHEN EXISTS(SELECT 1 FROM material_versions WHERE id=OLD.version_id AND status='published') AND NOT (EXISTS(SELECT 1 FROM material_history_members WHERE version_id=OLD.version_id)
 OR EXISTS(SELECT 1 FROM material_versions v JOIN material_deletion_members d ON d.material_id=v.material_id WHERE v.id=OLD.version_id))
BEGIN SELECT RAISE(ABORT,'published learning citations are retained'); END;
--> statement-breakpoint
CREATE TRIGGER material_evidence_inputs_available BEFORE INSERT ON material_evidence_inputs
WHEN NEW."page_version_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "page_versions" v JOIN "pages" d ON d.id=v."page_id"
WHERE v.id=NEW."page_version_id" AND v.status='published' AND d.archived_at IS NULL
AND NOT EXISTS(SELECT 1 FROM "page_retirements" r WHERE r.version_id=v.id))
BEGIN SELECT RAISE(ABORT,'exact authored learning input is unavailable'); END;
--> statement-breakpoint
CREATE TRIGGER material_evidence_inputs_immutable BEFORE UPDATE ON material_evidence_inputs
BEGIN SELECT RAISE(ABORT,'exact learning inputs are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_evidence_inputs_owner BEFORE INSERT ON material_evidence_inputs
WHEN (NEW.version_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM material_versions v WHERE v.id=NEW.version_id AND v.status='draft' AND v.kind IN ('diagram','quiz','flashcards')))
 OR (NEW.request_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM material_generation_requests r WHERE r.id=NEW.request_id AND r.cancelled=0 AND r.result_version_id IS NULL
 AND json_extract(r.payload,'$.inputs['||NEW.position||'].kind')=CASE WHEN NEW."page_version_id" IS NULL THEN 'source' ELSE 'page' END
 AND json_extract(r.payload,'$.inputs['||NEW.position||'].versionId') IS CASE WHEN NEW."page_version_id" IS NULL THEN NULL ELSE CAST(NEW."page_version_id" AS TEXT) END
 AND json_extract(r.payload,'$.inputs['||NEW.position||'].sourceId') IS CASE WHEN NEW.source_id IS NULL THEN NULL ELSE CAST(NEW.source_id AS TEXT) END
 AND json_extract(r.payload,'$.inputs['||NEW.position||'].revision') IS CASE WHEN NEW.source_revision IS NULL THEN NULL ELSE CAST(NEW.source_revision AS TEXT) END
 AND json_extract(r.payload,'$.inputs['||NEW.position||'].snapshotId') IS CASE WHEN NEW.source_snapshot_id IS NULL THEN NULL ELSE CAST(NEW.source_snapshot_id AS TEXT) END))
BEGIN SELECT RAISE(ABORT,'exact learning input does not match its owner'); END;
--> statement-breakpoint
CREATE TRIGGER material_evidence_inputs_retained BEFORE DELETE ON material_evidence_inputs
WHEN (OLD.version_id IS NOT NULL AND EXISTS(SELECT 1 FROM material_versions WHERE id=OLD.version_id AND status='published')
 AND NOT (EXISTS(SELECT 1 FROM material_history_members WHERE version_id=OLD.version_id)
 OR EXISTS(SELECT 1 FROM material_versions v JOIN material_deletion_members d ON d.material_id=v.material_id WHERE v.id=OLD.version_id))) OR (OLD.request_id IS NOT NULL AND EXISTS(SELECT 1 FROM material_generation_requests r WHERE r.id=OLD.request_id AND r.cancelled=0))
BEGIN SELECT RAISE(ABORT,'published learning evidence is retained'); END;
--> statement-breakpoint
CREATE TRIGGER material_flashcard_entries_delete_draft BEFORE DELETE ON material_flashcard_entries
WHEN ((EXISTS(SELECT 1 FROM material_versions v WHERE v.id=old.version_id AND v.status='published')) AND NOT (EXISTS(SELECT 1 FROM material_deletion_members dm JOIN material_deletions d ON d.material_id=dm.deletion_id WHERE dm.material_id=(SELECT material_id FROM material_versions WHERE id=OLD.version_id) AND d.status IN ('pending','failed')))) AND NOT (EXISTS(SELECT 1 FROM material_history_members h JOIN material_history_prunes p ON p.operation_id=h.operation_id WHERE h.version_id=OLD.version_id AND p.status IN ('pending','failed')))
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_flashcard_entries_deletion_insert BEFORE INSERT ON material_flashcard_entries WHEN EXISTS(SELECT 1 FROM material_versions v JOIN material_deletion_members d ON d.material_id=v.material_id WHERE v.id=NEW.version_id) BEGIN SELECT RAISE(ABORT,'deleted Material cannot restore content'); END;
--> statement-breakpoint
CREATE TRIGGER material_flashcard_entries_history_insert BEFORE INSERT ON material_flashcard_entries WHEN EXISTS(SELECT 1 FROM material_history_members WHERE version_id=NEW.version_id) BEGIN SELECT RAISE(ABORT,'pruned version cannot restore content'); END;
--> statement-breakpoint
CREATE TRIGGER material_flashcard_entries_history_update BEFORE UPDATE ON material_flashcard_entries WHEN EXISTS(SELECT 1 FROM material_history_members WHERE version_id=NEW.version_id) BEGIN SELECT RAISE(ABORT,'pruned version cannot restore content'); END;
--> statement-breakpoint
CREATE TRIGGER material_flashcard_entries_insert_draft BEFORE INSERT ON material_flashcard_entries
WHEN EXISTS(SELECT 1 FROM material_versions v WHERE v.id=new.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_flashcard_entries_update_draft BEFORE UPDATE ON material_flashcard_entries
WHEN EXISTS(SELECT 1 FROM material_versions v WHERE v.id=old.version_id AND v.status='published') OR EXISTS(SELECT 1 FROM material_versions v WHERE v.id=new.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_flashcard_versions_delete_draft BEFORE DELETE ON material_flashcard_versions
WHEN ((EXISTS(SELECT 1 FROM material_versions v WHERE v.id=old.version_id AND v.status='published')) AND NOT (EXISTS(SELECT 1 FROM material_deletion_members dm JOIN material_deletions d ON d.material_id=dm.deletion_id WHERE dm.material_id=(SELECT material_id FROM material_versions WHERE id=OLD.version_id) AND d.status IN ('pending','failed')))) AND NOT (EXISTS(SELECT 1 FROM material_history_members h JOIN material_history_prunes p ON p.operation_id=h.operation_id WHERE h.version_id=OLD.version_id AND p.status IN ('pending','failed')))
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_flashcard_versions_deletion_insert BEFORE INSERT ON material_flashcard_versions WHEN EXISTS(SELECT 1 FROM material_versions v JOIN material_deletion_members d ON d.material_id=v.material_id WHERE v.id=NEW.version_id) BEGIN SELECT RAISE(ABORT,'deleted Material cannot restore content'); END;
--> statement-breakpoint
CREATE TRIGGER material_flashcard_versions_history_insert BEFORE INSERT ON material_flashcard_versions WHEN EXISTS(SELECT 1 FROM material_history_members WHERE version_id=NEW.version_id) BEGIN SELECT RAISE(ABORT,'pruned version cannot restore content'); END;
--> statement-breakpoint
CREATE TRIGGER material_flashcard_versions_history_update BEFORE UPDATE ON material_flashcard_versions WHEN EXISTS(SELECT 1 FROM material_history_members WHERE version_id=NEW.version_id) BEGIN SELECT RAISE(ABORT,'pruned version cannot restore content'); END;
--> statement-breakpoint
CREATE TRIGGER material_flashcard_versions_insert_draft BEFORE INSERT ON material_flashcard_versions
WHEN EXISTS(SELECT 1 FROM material_versions v WHERE v.id=new.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_flashcard_versions_update_draft BEFORE UPDATE ON material_flashcard_versions
WHEN EXISTS(SELECT 1 FROM material_versions v WHERE v.id=old.version_id AND v.status='published') OR EXISTS(SELECT 1 FROM material_versions v WHERE v.id=new.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_generation_binding_immutable BEFORE UPDATE OF generation_request_id ON material_versions
WHEN OLD.generation_request_id IS NOT NULL AND NEW.generation_request_id IS NOT OLD.generation_request_id
BEGIN SELECT RAISE(ABORT, 'generation binding is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_generation_cancel_fence BEFORE UPDATE ON material_generation_requests WHEN (OLD.cancelled=1 AND NEW.cancelled!=1) OR (NEW.cancelled=1 AND OLD.result_version_id IS NULL AND NEW.result_version_id IS NOT NULL) BEGIN SELECT RAISE(ABORT,'generation cancellation is permanent'); END;
--> statement-breakpoint
CREATE TRIGGER material_generation_intent_immutable BEFORE UPDATE ON material_generation_requests WHEN NEW.id IS NOT OLD.id OR NEW.project_id IS NOT OLD.project_id OR NEW.created_at IS NOT OLD.created_at OR (NEW.payload IS NOT OLD.payload AND NOT(NEW.payload='{}' AND NEW.cancelled=1 AND EXISTS(SELECT 1 FROM (SELECT request_id,kind FROM material_deletion_requests UNION ALL SELECT request_id,kind FROM material_history_requests) d WHERE d.request_id=OLD.id AND d.kind='generation'))) BEGIN SELECT RAISE(ABORT,'generation intent is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_generation_intent_insert BEFORE INSERT ON material_generation_requests
WHEN NEW.result_version_id IS NOT NULL OR NEW.result_hash IS NOT NULL
 OR json_type(NEW.payload,'$.inputs') IS NOT 'array' OR json_array_length(NEW.payload,'$.inputs') NOT BETWEEN 1 AND 20
 OR (SELECT COUNT(DISTINCT value) FROM json_each(NEW.payload,'$.inputs'))!=json_array_length(NEW.payload,'$.inputs')
 OR EXISTS(SELECT 1 FROM json_each(NEW.payload,'$.inputs') j WHERE j.type!='object'
 OR json_extract(j.value,'$.kind') IS NULL OR json_extract(j.value,'$.kind') NOT IN ('source','page')
 OR (json_extract(j.value,'$.kind')='page' AND (json_type(j.value,'$.versionId') IS NOT 'text'
 OR json_extract(j.value,'$.versionId') NOT GLOB '[1-9]*' OR json_extract(j.value,'$.versionId') GLOB '*[^0-9]*'))
 OR (json_extract(j.value,'$.kind')='source' AND (json_type(j.value,'$.sourceId') IS NOT 'text'
 OR json_extract(j.value,'$.sourceId') NOT GLOB '[1-9]*' OR json_extract(j.value,'$.sourceId') GLOB '*[^0-9]*'
 OR json_type(j.value,'$.revision') IS NOT 'text' OR json_extract(j.value,'$.revision') NOT GLOB '[1-9]*' OR json_extract(j.value,'$.revision') GLOB '*[^0-9]*'
 OR json_type(j.value,'$.snapshotId') IS NOT 'text' OR json_extract(j.value,'$.snapshotId') NOT GLOB '[1-9]*' OR json_extract(j.value,'$.snapshotId') GLOB '*[^0-9]*')))
BEGIN SELECT RAISE(ABORT,'invalid exact generation intent'); END;
--> statement-breakpoint
CREATE TRIGGER material_generation_intent_retained BEFORE DELETE ON material_generation_requests
WHEN 1
BEGIN SELECT RAISE(ABORT, 'generation intent cannot be deleted'); END;
--> statement-breakpoint
CREATE TRIGGER material_generation_publication_scope
BEFORE UPDATE OF status ON material_versions
WHEN NEW.status = 'published' AND OLD.status != 'published' AND EXISTS (
  SELECT 1 FROM material_generation_requests r
  WHERE r.id = NEW.generation_request_id AND json_extract(r.payload, '$.scopeId') IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM material_generation_scopes s
      WHERE s.id = json_extract(r.payload, '$.scopeId') AND s.project_id = r.project_id AND s.enabled = 1)
)
BEGIN SELECT RAISE(ABORT, 'generation scope is not active for publication'); END;
--> statement-breakpoint
CREATE TRIGGER material_generation_question_specification
BEFORE INSERT ON material_generation_requests
WHEN json_extract(NEW.payload, '$.questionSpec') IS NOT NULL AND (
  json_type(NEW.payload, '$.questionSpec') IS NOT 'object'
  OR json_extract(NEW.payload, '$.kind') IS NOT 'quiz'
  OR json_extract(NEW.payload, '$.questionSpec.count') IS NOT 1
  OR json_extract(NEW.payload, '$.questionSpec.kind') IS NULL
  OR json_extract(NEW.payload, '$.questionSpec.kind') NOT IN ('choice', 'open')
)
BEGIN SELECT RAISE(ABORT, 'invalid generation question specification'); END;
--> statement-breakpoint
CREATE TRIGGER material_generation_receipt_scope
BEFORE UPDATE OF result_version_id ON material_generation_requests
WHEN OLD.result_version_id IS NULL AND NEW.result_version_id IS NOT NULL
  AND json_extract(NEW.payload, '$.scopeId') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM material_generation_scopes s
    WHERE s.id = json_extract(NEW.payload, '$.scopeId') AND s.project_id = NEW.project_id AND s.enabled = 1
  )
BEGIN SELECT RAISE(ABORT, 'generation scope is not active for publication'); END;
--> statement-breakpoint
CREATE TRIGGER material_generation_request_scope
BEFORE INSERT ON material_generation_requests
WHEN json_extract(NEW.payload, '$.scopeId') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM material_generation_scopes s
  WHERE s.id = json_extract(NEW.payload, '$.scopeId') AND s.project_id = NEW.project_id AND s.enabled = 1
)
BEGIN SELECT RAISE(ABORT, 'generation scope is not active for this project'); END;
--> statement-breakpoint
CREATE TRIGGER material_generation_result_immutable BEFORE UPDATE OF result_version_id,result_hash ON material_generation_requests WHEN OLD.result_version_id IS NOT NULL AND (NEW.result_version_id IS NOT OLD.result_version_id OR NEW.result_hash IS NOT OLD.result_hash) AND NOT(NEW.result_version_id IS NULL AND NEW.result_hash IS NULL AND EXISTS(SELECT 1 FROM (SELECT request_id,kind FROM material_deletion_requests UNION ALL SELECT request_id,kind FROM material_history_requests) d WHERE d.request_id=OLD.id AND d.kind='generation')) BEGIN SELECT RAISE(ABORT,'generation result is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_generation_scope_immutable
BEFORE UPDATE ON material_generation_scopes
WHEN NEW.id IS NOT OLD.id OR NEW.project_id IS NOT OLD.project_id
  OR NEW.created_at IS NOT OLD.created_at OR (OLD.enabled = 0 AND NEW.enabled != 0)
BEGIN SELECT RAISE(ABORT, 'generation scope identity and closure are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_generation_scope_retained
BEFORE DELETE ON material_generation_scopes
WHEN EXISTS (SELECT 1 FROM projects WHERE id = OLD.project_id)
BEGIN SELECT RAISE(ABORT, 'generation scope cannot be deleted'); END;
--> statement-breakpoint
CREATE TRIGGER material_generation_active_publication BEFORE UPDATE OF status ON material_versions WHEN NEW.status='published' AND OLD.status!='published' AND EXISTS(SELECT 1 FROM material_generation_requests r WHERE r.id=NEW.generation_request_id AND r.cancelled=1) BEGIN SELECT RAISE(ABORT,'cancelled generation cannot publish'); END;
--> statement-breakpoint
CREATE TRIGGER material_generation_note_scope BEFORE INSERT ON material_generation_requests
WHEN NEW.project_id IS NULL OR json_extract(NEW.payload,'$.kind') IS NULL
 OR json_extract(NEW.payload,'$.kind') NOT IN ('diagram','quiz','flashcards')
 OR json_extract(NEW.payload,'$.documentTransform') IS NOT NULL
BEGIN SELECT RAISE(ABORT,'invalid learning generation scope'); END;
--> statement-breakpoint
CREATE TRIGGER material_history_members_delete BEFORE DELETE ON material_history_members BEGIN SELECT RAISE(ABORT,'history cleanup ownership is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_history_members_update BEFORE UPDATE ON material_history_members BEGIN SELECT RAISE(ABORT,'history cleanup ownership is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_history_members_valid BEFORE INSERT ON material_history_members WHEN NOT EXISTS(SELECT 1 FROM material_history_prunes p JOIN material_versions v ON v.material_id=p.material_id,json_each(p.selection) j WHERE p.operation_id=NEW.operation_id AND p.status='pending' AND v.id=NEW.version_id AND CAST(v.id AS TEXT)=j.value AND v.status='published' AND (SELECT count(*) FROM material_versions newer WHERE newer.material_id=v.material_id AND newer.status='published' AND newer.number>v.number AND NOT EXISTS(SELECT 1 FROM material_history_members retired WHERE retired.version_id=newer.id))>=p.keep_latest) BEGIN SELECT RAISE(ABORT,'history cannot prune protected learning versions'); END;
--> statement-breakpoint
CREATE TRIGGER material_history_prunes_identity BEFORE UPDATE ON material_history_prunes
WHEN NEW.operation_id IS NOT OLD.operation_id OR NEW.material_id IS NOT OLD.material_id OR NEW.keep_latest IS NOT OLD.keep_latest OR NEW.token IS NOT OLD.token OR NEW.selection IS NOT OLD.selection OR NEW.created_at IS NOT OLD.created_at OR OLD.status='completed'
OR NOT ((NEW.attempt=OLD.attempt AND NEW.status IN ('failed','completed')) OR (NEW.attempt=OLD.attempt+1 AND NEW.status='pending' AND OLD.status IN ('pending','failed')))
BEGIN SELECT RAISE(ABORT,'history intent and completion are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_history_prunes_retained BEFORE DELETE ON material_history_prunes BEGIN SELECT RAISE(ABORT,'history cleanup is retained'); END;
--> statement-breakpoint
CREATE TRIGGER material_history_prunes_valid BEFORE INSERT ON material_history_prunes
WHEN NEW.status!='pending' OR NEW.attempt!=1 OR EXISTS(SELECT 1 FROM material_deletion_members WHERE material_id=NEW.material_id)
OR EXISTS(SELECT 1 FROM material_history_prunes WHERE material_id=NEW.material_id AND status!='completed')
OR EXISTS(SELECT 1 FROM json_each(NEW.selection) j LEFT JOIN material_versions v ON CAST(v.id AS TEXT)=j.value WHERE v.id IS NULL OR v.material_id!=NEW.material_id)
BEGIN SELECT RAISE(ABORT,'history requires available exact scope'); END;
--> statement-breakpoint
CREATE TRIGGER material_history_requests_delete BEFORE DELETE ON material_history_requests BEGIN SELECT RAISE(ABORT,'history cleanup ownership is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_history_requests_update BEFORE UPDATE ON material_history_requests BEGIN SELECT RAISE(ABORT,'history cleanup ownership is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_history_requests_owned BEFORE INSERT ON material_history_requests
WHEN NOT EXISTS(SELECT 1 FROM material_history_prunes p WHERE p.operation_id=NEW.operation_id AND p.status='pending') OR NOT(
(NEW.kind='generation' AND EXISTS(SELECT 1 FROM material_versions v JOIN material_history_members m ON m.version_id=v.id WHERE v.generation_request_id=NEW.request_id AND m.operation_id=NEW.operation_id))
OR (NEW.kind='publication' AND EXISTS(SELECT 1 FROM workflow_events e JOIN material_versions v ON CAST(v.id AS TEXT)=json_extract(e.payload,'$.materialVersionId') JOIN material_history_members m ON m.version_id=v.id WHERE e.correlation_id=NEW.request_id AND e.type='MaterialPublished' AND m.operation_id=NEW.operation_id))
OR (NEW.kind='learning' AND (EXISTS(SELECT 1 FROM learning_practice_slots p JOIN material_versions v ON v.id=p.version_id JOIN material_history_members m ON m.version_id=v.id WHERE p.id=NEW.request_id AND m.operation_id=NEW.operation_id) OR EXISTS(SELECT 1 FROM workflow_events e JOIN material_quiz_attempts a ON CAST(a.id AS TEXT)=json_extract(e.payload,'$.attemptId') JOIN material_versions v ON v.id=a.version_id JOIN material_history_members m ON m.version_id=v.id WHERE e.correlation_id=NEW.request_id AND e.type='QuizAnswerSubmitted' AND m.operation_id=NEW.operation_id))))
BEGIN SELECT RAISE(ABORT,'retirement requires exact learning ownership'); END;
--> statement-breakpoint
CREATE TRIGGER material_identity_update BEFORE UPDATE ON materials
WHEN new.id IS NOT old.id OR new.kind IS NOT old.kind
BEGIN SELECT RAISE(ABORT, 'material ownership and kind are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_publish_flashcards BEFORE UPDATE OF status ON material_versions
WHEN new.status='published' AND new.kind='flashcards' AND NOT EXISTS(SELECT 1 FROM material_flashcard_entries WHERE version_id=new.id)
BEGIN SELECT RAISE(ABORT, 'published flashcards require at least one card'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_attempts_history_insert BEFORE INSERT ON material_quiz_attempts WHEN EXISTS(SELECT 1 FROM material_history_members WHERE version_id=NEW.version_id) BEGIN SELECT RAISE(ABORT,'pruned practice content is unavailable'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_selections_completed_delete BEFORE DELETE ON material_quiz_selections
WHEN ((EXISTS(SELECT 1 FROM material_quiz_attempts a JOIN material_versions v ON v.id=a.version_id WHERE a.id=old.attempt_id AND a.status='completed')) AND NOT (EXISTS(SELECT 1 FROM material_deletion_members dm JOIN material_deletions d ON d.material_id=dm.deletion_id WHERE dm.material_id=(SELECT material_id FROM material_versions WHERE id=(SELECT version_id FROM material_quiz_attempts WHERE id=OLD.attempt_id)) AND d.status IN ('pending','failed')))) AND NOT (EXISTS(SELECT 1 FROM material_history_members m JOIN material_history_prunes p ON p.operation_id=m.operation_id WHERE m.version_id=(SELECT version_id FROM material_quiz_attempts WHERE id=OLD.attempt_id) AND p.status IN ('pending','failed')))
BEGIN SELECT RAISE(ABORT, 'completed quiz answers are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_selections_completed_insert BEFORE INSERT ON material_quiz_selections
WHEN EXISTS(SELECT 1 FROM material_quiz_attempts a JOIN material_versions v ON v.id=a.version_id WHERE a.id=new.attempt_id AND a.status='completed')
BEGIN SELECT RAISE(ABORT, 'completed quiz answers are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_selections_completed_update BEFORE UPDATE ON material_quiz_selections
WHEN EXISTS(SELECT 1 FROM material_quiz_attempts a JOIN material_versions v ON v.id=a.version_id WHERE a.id=old.attempt_id AND a.status='completed') OR EXISTS(SELECT 1 FROM material_quiz_attempts a JOIN material_versions v ON v.id=a.version_id WHERE a.id=new.attempt_id AND a.status='completed')
BEGIN SELECT RAISE(ABORT, 'completed quiz answers are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_versions_delete_draft BEFORE DELETE ON material_quiz_versions
WHEN ((EXISTS(SELECT 1 FROM material_versions v WHERE v.id=old.version_id AND v.status='published')) AND NOT (EXISTS(SELECT 1 FROM material_deletion_members dm JOIN material_deletions d ON d.material_id=dm.deletion_id WHERE dm.material_id=(SELECT material_id FROM material_versions WHERE id=OLD.version_id) AND d.status IN ('pending','failed')))) AND NOT (EXISTS(SELECT 1 FROM material_history_members h JOIN material_history_prunes p ON p.operation_id=h.operation_id WHERE h.version_id=OLD.version_id AND p.status IN ('pending','failed')))
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_versions_deletion_insert BEFORE INSERT ON material_quiz_versions WHEN EXISTS(SELECT 1 FROM material_versions v JOIN material_deletion_members d ON d.material_id=v.material_id WHERE v.id=NEW.version_id) BEGIN SELECT RAISE(ABORT,'deleted Material cannot restore content'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_versions_history_insert BEFORE INSERT ON material_quiz_versions WHEN EXISTS(SELECT 1 FROM material_history_members WHERE version_id=NEW.version_id) BEGIN SELECT RAISE(ABORT,'pruned version cannot restore content'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_versions_history_update BEFORE UPDATE ON material_quiz_versions WHEN EXISTS(SELECT 1 FROM material_history_members WHERE version_id=NEW.version_id) BEGIN SELECT RAISE(ABORT,'pruned version cannot restore content'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_versions_insert_draft BEFORE INSERT ON material_quiz_versions
WHEN EXISTS(SELECT 1 FROM material_versions v WHERE v.id=new.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_versions_update_draft BEFORE UPDATE ON material_quiz_versions
WHEN EXISTS(SELECT 1 FROM material_versions v WHERE v.id=old.version_id AND v.status='published') OR EXISTS(SELECT 1 FROM material_versions v WHERE v.id=new.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_review_delete BEFORE DELETE ON material_card_reviews
WHEN ((EXISTS(SELECT 1 FROM material_versions v WHERE v.id=old.version_id AND v.status='published')) AND NOT (EXISTS(SELECT 1 FROM material_deletion_members dm JOIN material_deletions d ON d.material_id=dm.deletion_id WHERE dm.material_id=(SELECT material_id FROM material_versions WHERE id=OLD.version_id) AND d.status IN ('pending','failed')))) AND NOT (EXISTS(SELECT 1 FROM material_history_members m JOIN material_history_prunes p ON p.operation_id=m.operation_id WHERE m.version_id=OLD.version_id AND p.status IN ('pending','failed')))
BEGIN SELECT RAISE(ABORT, 'card reviews are append only'); END;
--> statement-breakpoint
CREATE TRIGGER material_review_published BEFORE INSERT ON material_card_reviews
WHEN NOT EXISTS(SELECT 1 FROM material_versions v WHERE v.id=new.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'card reviews require a published deck'); END;
--> statement-breakpoint
CREATE TRIGGER material_review_update BEFORE UPDATE ON material_card_reviews
WHEN EXISTS(SELECT 1 FROM material_versions v WHERE v.id=old.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'card reviews are append only'); END;
--> statement-breakpoint
CREATE TRIGGER material_version_parents_delete_draft BEFORE DELETE ON material_version_parents
WHEN EXISTS(SELECT 1 FROM material_versions v WHERE v.id=old.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_version_parents_history_capture BEFORE INSERT ON material_version_parents WHEN EXISTS(SELECT 1 FROM material_history_members WHERE version_id=NEW.parent_version_id) BEGIN SELECT RAISE(ABORT,'pruned version cannot be linked as new input'); END;
--> statement-breakpoint
CREATE TRIGGER material_version_parents_history_insert BEFORE INSERT ON material_version_parents WHEN EXISTS(SELECT 1 FROM material_history_members WHERE version_id=NEW.version_id) BEGIN SELECT RAISE(ABORT,'pruned version cannot restore content'); END;
--> statement-breakpoint
CREATE TRIGGER material_version_parents_history_update BEFORE UPDATE ON material_version_parents WHEN EXISTS(SELECT 1 FROM material_history_members WHERE version_id=NEW.version_id) BEGIN SELECT RAISE(ABORT,'pruned version cannot restore content'); END;
--> statement-breakpoint
CREATE TRIGGER material_version_parents_insert_draft BEFORE INSERT ON material_version_parents
WHEN EXISTS(SELECT 1 FROM material_versions v WHERE v.id=new.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_version_parents_target_insert BEFORE INSERT ON material_version_parents
WHEN NOT EXISTS(SELECT 1 FROM material_versions v WHERE v.id=new.parent_version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'version dependencies must already be published'); END;
--> statement-breakpoint
CREATE TRIGGER material_version_parents_target_update BEFORE UPDATE ON material_version_parents
WHEN NOT EXISTS(SELECT 1 FROM material_versions v WHERE v.id=new.parent_version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'version dependencies must already be published'); END;
--> statement-breakpoint
CREATE TRIGGER material_version_parents_update_draft BEFORE UPDATE ON material_version_parents
WHEN EXISTS(SELECT 1 FROM material_versions v WHERE v.id=old.version_id AND v.status='published') OR EXISTS(SELECT 1 FROM material_versions v WHERE v.id=new.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_versions_delete_frozen BEFORE DELETE ON material_versions
WHEN EXISTS(SELECT 1 FROM material_versions v WHERE v.id=old.id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published versions cannot be deleted'); END;
--> statement-breakpoint
CREATE TRIGGER material_versions_frozen BEFORE UPDATE ON material_versions WHEN (OLD.status='published' OR NEW.id IS NOT OLD.id OR NEW.material_id IS NOT OLD.material_id OR NEW.kind IS NOT OLD.kind OR NEW.number IS NOT OLD.number OR NEW.created_at IS NOT OLD.created_at)
AND NOT(NEW.id IS OLD.id AND NEW.material_id IS OLD.material_id AND NEW.kind IS OLD.kind AND NEW.number IS OLD.number AND NEW.status IS OLD.status AND NEW.operation IS OLD.operation AND NEW.creator IS OLD.creator AND NEW.generation_request_id IS OLD.generation_request_id AND NEW.created_at IS OLD.created_at AND NEW.published_at IS OLD.published_at AND ((NEW.instruction IS NULL AND NEW.language IS NULL AND (EXISTS(SELECT 1 FROM material_deletion_members m JOIN material_deletions d ON d.material_id=m.deletion_id WHERE m.material_id=OLD.material_id AND d.status IN('pending','failed')) OR EXISTS(SELECT 1 FROM material_history_members m JOIN material_history_prunes p ON p.operation_id=m.operation_id WHERE m.version_id=OLD.id AND p.status IN('pending','failed')))) OR (NEW.instruction IS NULL AND NEW.language IS OLD.language AND EXISTS(SELECT 1 FROM (SELECT request_id,kind FROM material_deletion_requests UNION ALL SELECT request_id,kind FROM material_history_requests) d JOIN material_generation_requests r ON r.id=d.request_id WHERE d.request_id=OLD.generation_request_id AND d.kind='generation' AND OLD.instruction IS json_extract(r.payload,'$.instruction'))))) BEGIN SELECT RAISE(ABORT,'published versions and version identities are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_versions_publish_payload BEFORE UPDATE OF status ON material_versions WHEN NEW.status='published' AND CASE NEW.kind WHEN 'diagram' THEN NOT EXISTS(SELECT 1 FROM material_diagram_versions WHERE version_id=NEW.id) WHEN 'quiz' THEN NOT EXISTS(SELECT 1 FROM material_quiz_versions WHERE version_id=NEW.id) WHEN 'flashcards' THEN NOT EXISTS(SELECT 1 FROM material_flashcard_versions WHERE version_id=NEW.id) ELSE 1 END BEGIN SELECT RAISE(ABORT,'published learning artifacts require their typed payload'); END;
--> statement-breakpoint
CREATE TRIGGER material_versions_start_draft BEFORE INSERT ON material_versions
WHEN new.status != 'draft'
BEGIN SELECT RAISE(ABORT, 'material versions must start as drafts'); END;
--> statement-breakpoint
CREATE TRIGGER message_fts_ad AFTER DELETE ON message_versions WHEN old.status = 'complete' BEGIN
    INSERT INTO message_fts (message_fts, rowid, text) VALUES ('delete', old.id, old.text);
END;
--> statement-breakpoint
CREATE TRIGGER message_fts_ai AFTER INSERT ON message_versions WHEN new.status = 'complete' BEGIN
    INSERT INTO message_fts (rowid, text) VALUES (new.id, new.text);
END;
--> statement-breakpoint
CREATE TRIGGER message_fts_finish AFTER UPDATE OF status ON message_versions
WHEN old.status != 'complete' AND new.status = 'complete' BEGIN
    INSERT INTO message_fts (rowid, text) VALUES (new.id, new.text);
END;
--> statement-breakpoint
CREATE TRIGGER recording_chunks_captured_delete BEFORE DELETE ON recording_chunks
WHEN EXISTS(SELECT 1 FROM recording_posts p JOIN "notes" sess ON sess.id=p."note_id" WHERE p.recording_id=OLD.recording_id)

BEGIN SELECT RAISE(ABORT,'captured recording PCM is retained'); END;
--> statement-breakpoint
CREATE TRIGGER recording_chunks_captured_insert BEFORE INSERT ON recording_chunks
WHEN EXISTS(SELECT 1 FROM recording_posts WHERE recording_id=NEW.recording_id) OR (SELECT COALESCE(SUM(length(pcm)),0) FROM recording_chunks WHERE recording_id=NEW.recording_id)+length(NEW.pcm)>115200000
BEGIN SELECT RAISE(ABORT,'recording is captured or exceeds its size limit'); END;
--> statement-breakpoint
CREATE TRIGGER recording_chunks_captured_update BEFORE UPDATE ON recording_chunks
WHEN EXISTS(SELECT 1 FROM recording_posts WHERE recording_id IN(OLD.recording_id,NEW.recording_id))
BEGIN SELECT RAISE(ABORT,'captured recording PCM is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER recording_posts_immutable BEFORE UPDATE ON recording_posts
WHEN (NEW.request_id IS NOT OLD.request_id OR NEW.recording_id IS NOT OLD.recording_id OR NEW."note_id" IS NOT OLD."note_id" OR NEW.name IS NOT OLD.name OR NEW.wav IS NOT OLD.wav OR NEW.duration_ms IS NOT OLD.duration_ms OR NEW.created_at IS NOT OLD.created_at OR (OLD.message_id IS NOT NULL AND (NEW.message_id IS NOT OLD.message_id OR NEW.source_id IS NOT OLD.source_id)))
BEGIN SELECT RAISE(ABORT,'recording snapshot and receipt are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER recording_posts_result_valid BEFORE UPDATE OF source_id,message_id ON recording_posts
WHEN NEW.message_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM source_recording_imports src JOIN "note_recording_posts" p ON p.request_id=src.request_id WHERE src.request_id=NEW.request_id AND src.source_id=NEW.source_id AND src.project_id IS NEW.project_id AND src."note_id"=NEW."note_id" AND p."note_id"=NEW."note_id" AND p.message_id=NEW.message_id)
BEGIN SELECT RAISE(ABORT,'recording receipt does not identify its output'); END;
--> statement-breakpoint
CREATE TRIGGER recording_posts_retain BEFORE DELETE ON recording_posts
WHEN EXISTS(SELECT 1 FROM "notes" s WHERE s.id=OLD."note_id")
BEGIN SELECT RAISE(ABORT,'recording intent is retained'); END;
--> statement-breakpoint
CREATE TRIGGER recording_posts_validate_insert BEFORE INSERT ON recording_posts
WHEN NEW.source_id IS NOT NULL OR NEW.message_id IS NOT NULL OR NOT EXISTS(SELECT 1 FROM recordings r JOIN "notes" s ON s.id=r."note_id" WHERE r.id=NEW.recording_id AND r."note_id"=NEW."note_id") OR NEW.duration_ms != CAST((length(NEW.wav)-44+16)/32 AS INTEGER)
BEGIN SELECT RAISE(ABORT,'invalid recording snapshot'); END;
--> statement-breakpoint
CREATE TRIGGER recordings_captured_update BEFORE UPDATE ON recordings
WHEN EXISTS(SELECT 1 FROM recording_posts WHERE recording_id IN(OLD.id,NEW.id))
BEGIN SELECT RAISE(ABORT,'captured recording identity is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER retired_event_insert BEFORE INSERT ON workflow_events
WHEN EXISTS(SELECT 1 FROM workflow_retired_correlations WHERE correlation_id=NEW.correlation_id AND event_type=NEW.type)
BEGIN SELECT RAISE(ABORT, 'retired workflow cannot emit'); END;
--> statement-breakpoint
CREATE TRIGGER retired_event_payload BEFORE UPDATE ON workflow_events
WHEN OLD.payload='{}' AND EXISTS(SELECT 1 FROM workflow_retired_correlations WHERE correlation_id=OLD.correlation_id AND event_type=OLD.type)
 AND NEW.payload!='{}'
BEGIN SELECT RAISE(ABORT, 'retired event cannot restore content'); END;
--> statement-breakpoint
CREATE TRIGGER retired_execution_insert BEFORE INSERT ON workflow_executions
WHEN EXISTS(SELECT 1 FROM workflow_retired_correlations WHERE correlation_id=json_extract(NEW.payload,'$.event.correlationId') AND event_type=json_extract(NEW.payload,'$.event.type'))
BEGIN SELECT RAISE(ABORT, 'retired workflow cannot restart'); END;
--> statement-breakpoint
CREATE TRIGGER retired_execution_payload BEFORE UPDATE ON workflow_executions
WHEN OLD.payload='{}' AND EXISTS(SELECT 1 FROM workflow_retired_executions WHERE execution_id=OLD.execution_id)
 AND (NEW.payload!='{}' OR NEW.result IS NOT NULL OR NEW.owner_token IS NOT NULL OR NEW.status NOT IN ('completed','cancelled'))
BEGIN SELECT RAISE(ABORT, 'retired workflow cannot restore checkpoints'); END;
--> statement-breakpoint
CREATE TRIGGER note_deletion_correlations_delete_retained BEFORE DELETE ON "note_deletion_correlations"
BEGIN SELECT RAISE(ABORT, 'retirement identities are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER note_deletion_correlations_update_retained BEFORE UPDATE ON "note_deletion_correlations"
BEGIN SELECT RAISE(ABORT, 'retirement identities are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER note_deletion_identity BEFORE UPDATE ON "note_deletions"
WHEN NEW."note_id" IS NOT OLD."note_id" OR NEW.operation_id IS NOT OLD.operation_id OR NEW.created_at IS NOT OLD.created_at
 OR (OLD.status='completed' AND (NEW.status!='completed' OR NEW.completed_at IS NOT OLD.completed_at OR NEW.error_kind IS NOT OLD.error_kind))
BEGIN SELECT RAISE(ABORT, 'deletion identity and completion are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER note_deletion_retained BEFORE DELETE ON "note_deletions"
BEGIN SELECT RAISE(ABORT, 'deletion barriers are retained'); END;
--> statement-breakpoint
CREATE TRIGGER note_id_not_reusable BEFORE INSERT ON "notes"
WHEN EXISTS(SELECT 1 FROM "note_deletions" WHERE "note_id"=NEW.id)
BEGIN SELECT RAISE(ABORT, 'deleted session identity cannot be reused'); END;
--> statement-breakpoint
CREATE TRIGGER note_retired_intent_recapture BEFORE INSERT ON "note_run_contexts"
WHEN EXISTS(SELECT 1 FROM "note_retired_intents" r WHERE r."note_id"=NEW."note_id" AND r.intent_key=NEW.intent_key)
BEGIN SELECT RAISE(ABORT,'retired intent cannot capture newer content'); END;
--> statement-breakpoint
CREATE TRIGGER note_retired_intents_delete BEFORE DELETE ON "note_retired_intents" BEGIN SELECT RAISE(ABORT,'retired intent identity is retained'); END;
--> statement-breakpoint
CREATE TRIGGER note_retired_intents_owner BEFORE INSERT ON "note_retired_intents"
WHEN NOT EXISTS(SELECT 1 FROM "note_run_contexts" c WHERE c.request_id=NEW.request_id AND c."note_id"=NEW."note_id" AND c.intent_key=NEW.intent_key)
BEGIN SELECT RAISE(ABORT,'retired intent requires its exact captured identity'); END;
--> statement-breakpoint
CREATE TRIGGER note_retired_intents_update BEFORE UPDATE ON "note_retired_intents" BEGIN SELECT RAISE(ABORT,'retired intent identity is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER note_run_contexts_immutable BEFORE UPDATE ON "note_run_contexts" BEGIN SELECT RAISE(ABORT,'captured session context is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER source_extraction_revision_owner BEFORE INSERT ON source_extraction_revisions
WHEN NOT EXISTS(SELECT 1 FROM content_snapshots WHERE id=NEW.snapshot_id AND source_id=NEW.source_id)
BEGIN SELECT RAISE(ABORT,'exact extraction must belong to its source'); END;
--> statement-breakpoint
CREATE TRIGGER source_extraction_revisions_insert AFTER INSERT ON source_processing
 WHEN NEW.document_id IS NOT NULL AND NEW.published_request_id=NEW.request_id AND EXISTS(SELECT 1 FROM source_snapshots WHERE source_id=NEW.source_id AND revision=NEW.revision)
 BEGIN INSERT OR IGNORE INTO source_extraction_revisions(source_id,revision,snapshot_id) VALUES(NEW.source_id,NEW.revision,NEW.document_id); END;
--> statement-breakpoint
CREATE TRIGGER source_extraction_revisions_update AFTER UPDATE ON source_processing
 WHEN NEW.document_id IS NOT NULL AND NEW.published_request_id=NEW.request_id AND EXISTS(SELECT 1 FROM source_snapshots WHERE source_id=NEW.source_id AND revision=NEW.revision)
 BEGIN INSERT OR IGNORE INTO source_extraction_revisions(source_id,revision,snapshot_id) VALUES(NEW.source_id,NEW.revision,NEW.document_id); END;
--> statement-breakpoint
CREATE TRIGGER source_recording_bytes_frozen BEFORE UPDATE ON source_blobs
WHEN EXISTS(SELECT 1 FROM source_recording_imports WHERE source_id IN(OLD.source_id,NEW.source_id))
BEGIN SELECT RAISE(ABORT,'imported recording bytes are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER source_recording_bytes_retained BEFORE DELETE ON source_blobs
WHEN (EXISTS(SELECT 1 FROM source_recording_imports r JOIN sources src ON src.id=r.source_id WHERE r.source_id=OLD.source_id))
BEGIN SELECT RAISE(ABORT,'imported recording bytes are retained'); END;
--> statement-breakpoint
CREATE TRIGGER source_recording_capture_frozen BEFORE UPDATE ON sources
WHEN (EXISTS(SELECT 1 FROM source_recording_imports WHERE source_id=OLD.id) AND (
 NEW.id IS NOT OLD.id OR NEW.origin IS NOT OLD.origin OR NEW.kind IS NOT OLD.kind OR NEW.mime IS NOT OLD.mime OR NEW.name IS NOT OLD.name OR NEW.size_bytes IS NOT OLD.size_bytes OR NEW.sha256 IS NOT OLD.sha256 OR NEW.uri IS NOT OLD.uri OR NEW.created_at IS NOT OLD.created_at))
BEGIN SELECT RAISE(ABORT,'imported recording metadata is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER source_recording_imports_immutable BEFORE UPDATE ON source_recording_imports
WHEN NEW.request_id IS NOT OLD.request_id OR NEW."note_id" IS NOT OLD."note_id" OR NEW.source_id IS NOT OLD.source_id OR NEW.input_hash IS NOT OLD.input_hash OR NEW.duration_ms IS NOT OLD.duration_ms
BEGIN SELECT RAISE(ABORT,'recording source receipt is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER source_recording_imports_retain BEFORE DELETE ON source_recording_imports
WHEN EXISTS(SELECT 1 FROM projects WHERE id=OLD.project_id)
BEGIN SELECT RAISE(ABORT,'recording source receipt is retained'); END;
--> statement-breakpoint
CREATE TRIGGER source_recording_imports_validate_insert BEFORE INSERT ON source_recording_imports
WHEN NOT EXISTS(SELECT 1 FROM sources src JOIN source_blobs b ON b.source_id=src.id JOIN "notes" s ON s.id=NEW."note_id" WHERE src.id=NEW.source_id AND src.project_id IS NEW.project_id AND src.origin='recording' AND src.kind='audio' AND src.mime='audio/wav' AND NEW.duration_ms=CAST((length(b.bytes)-44+16)/32 AS INTEGER))
BEGIN SELECT RAISE(ABORT,'invalid recording source receipt'); END;
--> statement-breakpoint
CREATE TRIGGER source_snapshots_published_delete BEFORE DELETE ON source_snapshots WHEN EXISTS(SELECT 1 FROM (SELECT source_id,revision,snapshot_id FROM "note_reply_sources" UNION ALL SELECT source_id,revision,snapshot_id FROM "note_context_sources" UNION ALL SELECT source_id,source_revision,source_snapshot_id FROM "page_inputs" WHERE source_id IS NOT NULL UNION ALL SELECT source_id,source_revision,source_snapshot_id FROM material_evidence_inputs WHERE source_id IS NOT NULL UNION ALL SELECT source_id,source_revision,source_snapshot_id FROM learning_practice_inputs WHERE source_id IS NOT NULL) p WHERE p.source_id=OLD.source_id AND p.revision=OLD.revision) BEGIN SELECT RAISE(ABORT,'exact input pins source revision'); END;
--> statement-breakpoint
CREATE TRIGGER source_snapshots_published_update BEFORE UPDATE ON source_snapshots WHEN EXISTS(SELECT 1 FROM source_extraction_revisions e WHERE e.source_id=OLD.source_id AND e.revision=OLD.revision) OR EXISTS(SELECT 1 FROM (SELECT source_id,revision,snapshot_id FROM "note_reply_sources" UNION ALL SELECT source_id,revision,snapshot_id FROM "note_context_sources" UNION ALL SELECT source_id,source_revision,source_snapshot_id FROM "page_inputs" WHERE source_id IS NOT NULL UNION ALL SELECT source_id,source_revision,source_snapshot_id FROM material_evidence_inputs WHERE source_id IS NOT NULL UNION ALL SELECT source_id,source_revision,source_snapshot_id FROM learning_practice_inputs WHERE source_id IS NOT NULL) p WHERE p.source_id=OLD.source_id AND p.revision=OLD.revision) BEGIN SELECT RAISE(ABORT,'retained source revision is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER page_annotation_head BEFORE UPDATE ON "page_annotations"
WHEN NEW.id!=OLD.id OR NEW."page_id"!=OLD."page_id" OR NEW.revision!=OLD.revision+1 OR NOT EXISTS(SELECT 1 FROM "page_annotation_revisions" WHERE annotation_id=NEW.id AND revision=NEW.revision)
BEGIN SELECT RAISE(ABORT,'annotation head requires exact next revision'); END;
--> statement-breakpoint
CREATE TRIGGER page_annotation_revision_owner BEFORE INSERT ON "page_annotation_revisions"
WHEN NOT EXISTS(SELECT 1 FROM "page_annotations" a JOIN "page_versions" v ON v.id=NEW.version_id AND v."page_id"=a."page_id" WHERE a.id=NEW.annotation_id AND a."page_id"=NEW."page_id" AND v.status='published' AND (NEW.revision=a.revision+1 OR (NEW.revision=1 AND a.revision=1))
AND CAST(json_extract(NEW.payload,'$.id') AS INTEGER)=NEW.annotation_id AND CAST(json_extract(NEW.payload,'$.revision') AS INTEGER)=NEW.revision AND CAST(json_extract(NEW.payload,'$.target.pageId') AS INTEGER)=NEW."page_id" AND CAST(json_extract(NEW.payload,'$.target.range.versionId') AS INTEGER)=NEW.version_id AND CAST(json_extract(NEW.payload,'$.target.range.snapshotId') AS INTEGER)=NEW.snapshot_id)
BEGIN SELECT RAISE(ABORT,'annotation revision requires exact published ownership'); END;
--> statement-breakpoint
CREATE TRIGGER page_annotation_revisions_delete BEFORE DELETE ON "page_annotation_revisions" BEGIN SELECT RAISE(ABORT,'annotation history is append-only'); END;
--> statement-breakpoint
CREATE TRIGGER page_annotation_revisions_update BEFORE UPDATE ON "page_annotation_revisions" BEGIN SELECT RAISE(ABORT,'annotation revisions are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER page_annotation_snapshot BEFORE INSERT ON "page_annotation_revisions"
WHEN NOT EXISTS(SELECT 1 FROM "page_versions" WHERE id=NEW.version_id AND "page_id"=NEW."page_id" AND content_snapshot_id=NEW.snapshot_id)
BEGIN SELECT RAISE(ABORT,'annotation target must match exact authored version'); END;
--> statement-breakpoint
CREATE TRIGGER page_annotations_delete BEFORE DELETE ON "page_annotations" BEGIN SELECT RAISE(ABORT,'annotation identity is retained'); END;
--> statement-breakpoint
CREATE TRIGGER page_blocks_delete BEFORE DELETE ON blocks WHEN EXISTS(SELECT 1 FROM "page_versions" v WHERE v.status='published' AND (v.content_snapshot_id=OLD.document_id) AND NOT EXISTS(SELECT 1 FROM "page_retirements" r WHERE r.version_id=v.id)) BEGIN SELECT RAISE(ABORT,'published document content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER page_blocks_insert BEFORE INSERT ON blocks
WHEN EXISTS (SELECT 1 FROM "page_versions" v WHERE v.status='published' AND (v.content_snapshot_id=NEW.document_id))
BEGIN SELECT RAISE(ABORT, 'published document content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER page_blocks_update BEFORE UPDATE ON blocks WHEN EXISTS(SELECT 1 FROM "page_versions" v WHERE v.status='published' AND (v.content_snapshot_id=OLD.document_id OR v.content_snapshot_id=NEW.document_id) AND NOT EXISTS(SELECT 1 FROM "page_retirements" r WHERE r.version_id=v.id)) BEGIN SELECT RAISE(ABORT,'published document content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER page_citation_assessments_immutable_update BEFORE UPDATE ON "page_citation_assessments" BEGIN SELECT RAISE(ABORT,'document evidence is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER page_citations_delete BEFORE DELETE ON "page_citations" WHEN (EXISTS(SELECT 1 FROM "page_versions" WHERE id=OLD.version_id AND status='published')) AND NOT EXISTS(SELECT 1 FROM "page_retirements" WHERE version_id=OLD.version_id) BEGIN SELECT RAISE(ABORT,'published document evidence is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER page_citations_insert BEFORE INSERT ON "page_citations" WHEN EXISTS(SELECT 1 FROM "page_versions" WHERE id=NEW.version_id AND status='published') BEGIN SELECT RAISE(ABORT,'published document evidence is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER page_citations_update BEFORE UPDATE ON "page_citations" WHEN EXISTS(SELECT 1 FROM "page_versions" WHERE id IN(OLD.version_id,NEW.version_id) AND status='published') BEGIN SELECT RAISE(ABORT,'published document evidence is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER page_content_snapshots_delete BEFORE DELETE ON content_snapshots WHEN EXISTS(SELECT 1 FROM "page_versions" v WHERE v.status='published' AND (v.content_snapshot_id=OLD.id) AND NOT EXISTS(SELECT 1 FROM "page_retirements" r WHERE r.version_id=v.id)) BEGIN SELECT RAISE(ABORT,'published document content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER page_content_snapshots_update BEFORE UPDATE ON content_snapshots WHEN EXISTS(SELECT 1 FROM "page_versions" v WHERE v.status='published' AND (v.content_snapshot_id=OLD.id OR v.content_snapshot_id=NEW.id) AND NOT EXISTS(SELECT 1 FROM "page_retirements" r WHERE r.version_id=v.id)) BEGIN SELECT RAISE(ABORT,'published document content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER page_document_assets_delete BEFORE DELETE ON document_assets WHEN EXISTS(SELECT 1 FROM "page_versions" v WHERE v.status='published' AND (v.content_snapshot_id=OLD.document_id) AND NOT EXISTS(SELECT 1 FROM "page_retirements" r WHERE r.version_id=v.id)) BEGIN SELECT RAISE(ABORT,'published document content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER page_document_assets_insert BEFORE INSERT ON document_assets
WHEN EXISTS (SELECT 1 FROM "page_versions" v WHERE v.status='published' AND (v.content_snapshot_id=NEW.document_id))
BEGIN SELECT RAISE(ABORT, 'published document content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER page_document_assets_update BEFORE UPDATE ON document_assets WHEN EXISTS(SELECT 1 FROM "page_versions" v WHERE v.status='published' AND (v.content_snapshot_id=OLD.document_id OR v.content_snapshot_id=NEW.document_id) AND NOT EXISTS(SELECT 1 FROM "page_retirements" r WHERE r.version_id=v.id)) BEGIN SELECT RAISE(ABORT,'published document content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER page_edit_receipts_delete BEFORE DELETE ON "page_edit_receipts"
BEGIN SELECT RAISE(ABORT, 'document edit receipts are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER page_edit_receipts_update BEFORE UPDATE ON "page_edit_receipts"
BEGIN SELECT RAISE(ABORT, 'document edit receipts are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER page_generation_intent BEFORE UPDATE ON "page_generation_requests"
WHEN NEW.id IS NOT OLD.id OR NEW."page_id" IS NOT OLD."page_id" OR NEW.expected_version_id IS NOT OLD.expected_version_id OR NEW.intent_hash IS NOT OLD.intent_hash OR NEW.created_at IS NOT OLD.created_at OR (NEW."note_id" IS NOT OLD."note_id" AND NEW."note_id" IS NOT NULL) OR (OLD.result_version_id IS NOT NULL AND NEW.result_version_id IS NOT OLD.result_version_id)
BEGIN SELECT RAISE(ABORT,'generation publication intent and result are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER page_input_message BEFORE INSERT ON "page_inputs"
WHEN NEW.exact_message_version_id IS NOT NULL AND NOT (
 (NEW.message_version_id=NEW.exact_message_version_id AND EXISTS(SELECT 1 FROM message_versions WHERE id=NEW.message_version_id AND status='complete')) OR
 (NEW.message_version_id IS NULL AND EXISTS(SELECT 1 FROM "page_inputs" i JOIN "page_versions" old ON old.id=i.version_id JOIN "page_versions" child ON child.id=NEW.version_id AND child."page_id"=old."page_id" WHERE i.exact_message_version_id=NEW.exact_message_version_id AND old.status='published')))
BEGIN SELECT RAISE(ABORT,'message input requires exact complete or inherited message version'); END;
--> statement-breakpoint
CREATE TRIGGER page_input_publication BEFORE UPDATE OF status ON "page_versions"
WHEN NEW.status='published' AND EXISTS(SELECT 1 FROM "page_inputs" i JOIN "page_versions" target ON target.id=i."page_version_id" WHERE i.version_id=NEW.id AND (target.status!='published' OR target.id=NEW.id OR EXISTS(SELECT 1 FROM "page_retirements" r WHERE r.version_id=target.id)))
BEGIN SELECT RAISE(ABORT,'authored publication requires retained published exact document inputs'); END;
--> statement-breakpoint
CREATE TRIGGER page_inputs_delete BEFORE DELETE ON "page_inputs" WHEN (EXISTS(SELECT 1 FROM "page_versions" WHERE id=OLD.version_id AND status='published')) AND NOT EXISTS(SELECT 1 FROM "page_retirements" WHERE version_id=OLD.version_id) BEGIN SELECT RAISE(ABORT,'published document evidence is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER page_inputs_insert BEFORE INSERT ON "page_inputs" WHEN EXISTS(SELECT 1 FROM "page_versions" WHERE id=NEW.version_id AND status='published') BEGIN SELECT RAISE(ABORT,'published document evidence is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER page_inputs_update BEFORE UPDATE ON "page_inputs" WHEN (EXISTS(SELECT 1 FROM "page_versions" WHERE id=NEW.version_id AND status='published') OR EXISTS(SELECT 1 FROM "page_versions" WHERE id=OLD.version_id AND status='published')) AND NOT (OLD.message_version_id IS NOT NULL AND NEW.message_version_id IS NULL AND NEW.id IS OLD.id AND NEW.version_id IS OLD.version_id AND NEW.request_id IS OLD.request_id AND NEW.position IS OLD.position AND NEW."page_version_id" IS OLD."page_version_id" AND NEW.source_id IS OLD.source_id AND NEW.source_revision IS OLD.source_revision AND NEW.source_snapshot_id IS OLD.source_snapshot_id AND NEW.exact_message_version_id IS OLD.exact_message_version_id) BEGIN SELECT RAISE(ABORT,'published document evidence is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER page_parents_delete BEFORE DELETE ON "page_version_parents"
WHEN EXISTS (SELECT 1 FROM "page_versions" WHERE id=OLD.version_id AND status='published')
BEGIN SELECT RAISE(ABORT, 'published document ancestry is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER page_parents_insert BEFORE INSERT ON "page_version_parents"
WHEN NOT EXISTS (SELECT 1 FROM "page_versions" child JOIN "page_versions" parent
 ON parent.id=NEW.parent_version_id WHERE child.id=NEW.version_id AND child.status='draft'
 AND parent.status='published' AND child."page_id"=NEW."page_id" AND parent."page_id"=NEW."page_id"
 AND parent.number<child.number)
BEGIN SELECT RAISE(ABORT, 'document ancestry requires an earlier published version of the same document'); END;
--> statement-breakpoint
CREATE TRIGGER page_parents_update BEFORE UPDATE ON "page_version_parents"
BEGIN SELECT RAISE(ABORT, 'document ancestry cannot be rewritten'); END;
--> statement-breakpoint
CREATE TRIGGER page_proposal_receipts_immutable_update BEFORE UPDATE ON "page_proposal_receipts" BEGIN SELECT RAISE(ABORT,'document evidence is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER page_proposals_immutable_update BEFORE UPDATE ON "page_proposals" BEGIN SELECT RAISE(ABORT,'document evidence is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER page_retirement_dependencies BEFORE INSERT ON "page_retirements"
WHEN EXISTS(SELECT 1 FROM "page_inputs" i JOIN "page_versions" v ON v.id=i.version_id JOIN "page_versions" target ON target.id=NEW.version_id WHERE i."page_version_id"=NEW.version_id AND v."page_id"!=target."page_id" AND NOT EXISTS(SELECT 1 FROM "page_retirements" r WHERE r.version_id=v.id))
 OR EXISTS(SELECT 1 FROM "page_inputs" WHERE "page_version_id"=NEW.version_id AND request_id IS NOT NULL)
 OR EXISTS(SELECT 1 FROM "note_context_pages" WHERE version_id=NEW.version_id)
 OR EXISTS(SELECT 1 FROM material_evidence_inputs WHERE "page_version_id"=NEW.version_id)
 OR EXISTS(SELECT 1 FROM learning_practice_inputs WHERE "page_version_id"=NEW.version_id)
BEGIN SELECT RAISE(ABORT,'exact authored inputs protect referenced bodies'); END;
--> statement-breakpoint
CREATE TRIGGER page_retirements_delete BEFORE DELETE ON "page_retirements" BEGIN SELECT RAISE(ABORT,'document retirement is permanent'); END;
--> statement-breakpoint
CREATE TRIGGER page_retirements_update BEFORE UPDATE ON "page_retirements" BEGIN SELECT RAISE(ABORT,'document retirement is permanent'); END;
--> statement-breakpoint
CREATE TRIGGER page_source_input BEFORE INSERT ON "page_inputs"
WHEN NEW.source_snapshot_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM content_snapshots WHERE id=NEW.source_snapshot_id AND source_id=NEW.source_id)
BEGIN SELECT RAISE(ABORT,'source snapshot must belong to exact source'); END;
--> statement-breakpoint
CREATE TRIGGER page_transform_intent_immutable BEFORE UPDATE ON "page_transform_requests" WHEN NEW.id IS NOT OLD.id OR NEW.context_request_id IS NOT OLD.context_request_id OR NEW.request IS NOT OLD.request OR NEW.intent_hash IS NOT OLD.intent_hash OR NEW.instruction IS NOT OLD.instruction OR NEW.created_at IS NOT OLD.created_at OR (NEW."note_id" IS NOT OLD."note_id" AND NEW."note_id" IS NOT NULL) OR (OLD.cancelled=1 AND NEW.cancelled!=1) OR (OLD.result_version_id IS NOT NULL AND (NEW.result_version_id IS NOT OLD.result_version_id OR NEW.report IS NOT OLD.report OR NEW.result_hash IS NOT OLD.result_hash OR NEW.event_id IS NOT OLD.event_id)) BEGIN SELECT RAISE(ABORT,'document transform intent and publication are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER page_transform_publication_owner BEFORE UPDATE OF result_version_id ON "page_transform_requests" WHEN NEW.result_version_id IS NOT NULL AND (NEW.report IS NULL OR NEW.result_hash IS NULL OR NOT EXISTS(SELECT 1 FROM "page_generation_requests" p WHERE p.id=NEW.id AND p.result_version_id=NEW.result_version_id)) BEGIN SELECT RAISE(ABORT,'document transform requires its exact authored publication receipt'); END;
--> statement-breakpoint
CREATE TRIGGER page_versions_draft_identity BEFORE UPDATE ON "page_versions"
WHEN NEW.id!=OLD.id OR NEW."page_id"!=OLD."page_id" OR NEW.number!=OLD.number
 OR NEW.content_snapshot_id!=OLD.content_snapshot_id OR NEW.created_at!=OLD.created_at
BEGIN SELECT RAISE(ABORT, 'document version identity is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER page_versions_draft_insert BEFORE INSERT ON "page_versions"
WHEN NEW.status != 'draft' BEGIN SELECT RAISE(ABORT, 'document versions must begin as drafts'); END;
--> statement-breakpoint
CREATE TRIGGER page_versions_publish BEFORE UPDATE OF status ON "page_versions"
WHEN NEW.status='published' AND (
 NOT EXISTS (SELECT 1 FROM blocks WHERE document_id=NEW.content_snapshot_id)
 OR NOT EXISTS (SELECT 1 FROM content_snapshots WHERE id=NEW.content_snapshot_id AND source_id IS NULL)
 OR EXISTS (SELECT 1 FROM "page_version_parents" p JOIN "page_versions" v ON v.id=p.parent_version_id
  WHERE p.version_id=NEW.id AND (v.status!='published' OR v.number>=NEW.number OR v."page_id"!=NEW."page_id"))
) BEGIN SELECT RAISE(ABORT, 'document publication requires complete owned content and published ancestry'); END;
--> statement-breakpoint
CREATE TRIGGER page_versions_sealed_delete BEFORE DELETE ON "page_versions"
WHEN OLD.status='published' BEGIN SELECT RAISE(ABORT, 'published document versions are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER page_versions_sealed_update BEFORE UPDATE ON "page_versions"
WHEN OLD.status='published' BEGIN SELECT RAISE(ABORT, 'published document versions are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER page_versions_snapshot_owner BEFORE INSERT ON "page_versions"
WHEN NOT EXISTS (SELECT 1 FROM content_snapshots c WHERE c.id=NEW.content_snapshot_id AND c.source_id IS NULL)
BEGIN SELECT RAISE(ABORT, 'authored document snapshot ownership is invalid'); END;
--> statement-breakpoint
CREATE TRIGGER workflow_activities_retired_insert BEFORE INSERT ON workflow_activities
WHEN EXISTS(SELECT 1 FROM workflow_retired_executions WHERE execution_id=NEW.execution_id)
BEGIN SELECT RAISE(ABORT, 'retired workflow cannot checkpoint'); END;
--> statement-breakpoint
CREATE TRIGGER workflow_clocks_retired_insert BEFORE INSERT ON workflow_clocks
WHEN EXISTS(SELECT 1 FROM workflow_retired_executions WHERE execution_id=NEW.execution_id)
BEGIN SELECT RAISE(ABORT, 'retired workflow cannot checkpoint'); END;
--> statement-breakpoint
CREATE TRIGGER workflow_configuration_waits_retired_insert BEFORE INSERT ON workflow_configuration_waits
WHEN EXISTS(SELECT 1 FROM workflow_retired_executions WHERE execution_id=NEW.execution_id)
BEGIN SELECT RAISE(ABORT, 'retired workflow cannot checkpoint'); END;
--> statement-breakpoint
CREATE TRIGGER workflow_deferreds_retired_insert BEFORE INSERT ON workflow_deferreds
WHEN EXISTS(SELECT 1 FROM workflow_retired_executions WHERE execution_id=NEW.execution_id)
BEGIN SELECT RAISE(ABORT, 'retired workflow cannot checkpoint'); END;
--> statement-breakpoint
CREATE TRIGGER workflow_retired_correlations_delete_retained BEFORE DELETE ON workflow_retired_correlations
BEGIN SELECT RAISE(ABORT, 'retirement identities are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER workflow_retired_correlations_update_retained BEFORE UPDATE ON workflow_retired_correlations
BEGIN SELECT RAISE(ABORT, 'retirement identities are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER workflow_retired_executions_delete_retained BEFORE DELETE ON workflow_retired_executions
BEGIN SELECT RAISE(ABORT, 'retirement identities are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER workflow_retired_executions_update_retained BEFORE UPDATE ON workflow_retired_executions
BEGIN SELECT RAISE(ABORT, 'retirement identities are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER page_retained_content_snapshots_insert BEFORE INSERT ON content_snapshots
WHEN EXISTS(SELECT 1 FROM "page_versions" v WHERE (v.content_snapshot_id=NEW.id) AND (EXISTS(SELECT 1 FROM "page_edit_receipts" r WHERE r.submitted_version_id=v.id) OR EXISTS(SELECT 1 FROM "page_proposals" p WHERE p.proposed_version_id=v.id) OR EXISTS(SELECT 1 FROM "page_generation_requests" g WHERE g.result_version_id=v.id))
AND NOT EXISTS(SELECT 1 FROM "page_retirements" retired WHERE retired.version_id=v.id))
BEGIN SELECT RAISE(ABORT,'retained authored alternatives are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER page_retained_content_snapshots_update BEFORE UPDATE ON content_snapshots
WHEN EXISTS(SELECT 1 FROM "page_versions" v WHERE (v.content_snapshot_id=OLD.id OR v.content_snapshot_id=NEW.id) AND (EXISTS(SELECT 1 FROM "page_edit_receipts" r WHERE r.submitted_version_id=v.id) OR EXISTS(SELECT 1 FROM "page_proposals" p WHERE p.proposed_version_id=v.id) OR EXISTS(SELECT 1 FROM "page_generation_requests" g WHERE g.result_version_id=v.id))
AND NOT EXISTS(SELECT 1 FROM "page_retirements" retired WHERE retired.version_id=v.id))
BEGIN SELECT RAISE(ABORT,'retained authored alternatives are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER page_retained_content_snapshots_delete BEFORE DELETE ON content_snapshots
WHEN EXISTS(SELECT 1 FROM "page_versions" v WHERE (v.content_snapshot_id=OLD.id) AND (EXISTS(SELECT 1 FROM "page_edit_receipts" r WHERE r.submitted_version_id=v.id) OR EXISTS(SELECT 1 FROM "page_proposals" p WHERE p.proposed_version_id=v.id) OR EXISTS(SELECT 1 FROM "page_generation_requests" g WHERE g.result_version_id=v.id))
AND NOT EXISTS(SELECT 1 FROM "page_retirements" retired WHERE retired.version_id=v.id))
BEGIN SELECT RAISE(ABORT,'retained authored alternatives are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER page_retained_blocks_insert BEFORE INSERT ON blocks
WHEN EXISTS(SELECT 1 FROM "page_versions" v WHERE (v.content_snapshot_id=NEW.document_id) AND (EXISTS(SELECT 1 FROM "page_edit_receipts" r WHERE r.submitted_version_id=v.id) OR EXISTS(SELECT 1 FROM "page_proposals" p WHERE p.proposed_version_id=v.id) OR EXISTS(SELECT 1 FROM "page_generation_requests" g WHERE g.result_version_id=v.id))
AND NOT EXISTS(SELECT 1 FROM "page_retirements" retired WHERE retired.version_id=v.id))
BEGIN SELECT RAISE(ABORT,'retained authored alternatives are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER page_retained_blocks_update BEFORE UPDATE ON blocks
WHEN EXISTS(SELECT 1 FROM "page_versions" v WHERE (v.content_snapshot_id=OLD.document_id OR v.content_snapshot_id=NEW.document_id) AND (EXISTS(SELECT 1 FROM "page_edit_receipts" r WHERE r.submitted_version_id=v.id) OR EXISTS(SELECT 1 FROM "page_proposals" p WHERE p.proposed_version_id=v.id) OR EXISTS(SELECT 1 FROM "page_generation_requests" g WHERE g.result_version_id=v.id))
AND NOT EXISTS(SELECT 1 FROM "page_retirements" retired WHERE retired.version_id=v.id))
BEGIN SELECT RAISE(ABORT,'retained authored alternatives are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER page_retained_blocks_delete BEFORE DELETE ON blocks
WHEN EXISTS(SELECT 1 FROM "page_versions" v WHERE (v.content_snapshot_id=OLD.document_id) AND (EXISTS(SELECT 1 FROM "page_edit_receipts" r WHERE r.submitted_version_id=v.id) OR EXISTS(SELECT 1 FROM "page_proposals" p WHERE p.proposed_version_id=v.id) OR EXISTS(SELECT 1 FROM "page_generation_requests" g WHERE g.result_version_id=v.id))
AND NOT EXISTS(SELECT 1 FROM "page_retirements" retired WHERE retired.version_id=v.id))
BEGIN SELECT RAISE(ABORT,'retained authored alternatives are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER page_retained_document_assets_insert BEFORE INSERT ON document_assets
WHEN EXISTS(SELECT 1 FROM "page_versions" v WHERE (v.content_snapshot_id=NEW.document_id) AND (EXISTS(SELECT 1 FROM "page_edit_receipts" r WHERE r.submitted_version_id=v.id) OR EXISTS(SELECT 1 FROM "page_proposals" p WHERE p.proposed_version_id=v.id) OR EXISTS(SELECT 1 FROM "page_generation_requests" g WHERE g.result_version_id=v.id))
AND NOT EXISTS(SELECT 1 FROM "page_retirements" retired WHERE retired.version_id=v.id))
BEGIN SELECT RAISE(ABORT,'retained authored alternatives are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER page_retained_document_assets_update BEFORE UPDATE ON document_assets
WHEN EXISTS(SELECT 1 FROM "page_versions" v WHERE (v.content_snapshot_id=OLD.document_id OR v.content_snapshot_id=NEW.document_id) AND (EXISTS(SELECT 1 FROM "page_edit_receipts" r WHERE r.submitted_version_id=v.id) OR EXISTS(SELECT 1 FROM "page_proposals" p WHERE p.proposed_version_id=v.id) OR EXISTS(SELECT 1 FROM "page_generation_requests" g WHERE g.result_version_id=v.id))
AND NOT EXISTS(SELECT 1 FROM "page_retirements" retired WHERE retired.version_id=v.id))
BEGIN SELECT RAISE(ABORT,'retained authored alternatives are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER page_retained_document_assets_delete BEFORE DELETE ON document_assets
WHEN EXISTS(SELECT 1 FROM "page_versions" v WHERE (v.content_snapshot_id=OLD.document_id) AND (EXISTS(SELECT 1 FROM "page_edit_receipts" r WHERE r.submitted_version_id=v.id) OR EXISTS(SELECT 1 FROM "page_proposals" p WHERE p.proposed_version_id=v.id) OR EXISTS(SELECT 1 FROM "page_generation_requests" g WHERE g.result_version_id=v.id))
AND NOT EXISTS(SELECT 1 FROM "page_retirements" retired WHERE retired.version_id=v.id))
BEGIN SELECT RAISE(ABORT,'retained authored alternatives are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER page_retained_page_versions_update BEFORE UPDATE ON "page_versions"
WHEN EXISTS(SELECT 1 FROM "page_versions" v WHERE (v.id=OLD.id OR v.id=NEW.id) AND (EXISTS(SELECT 1 FROM "page_edit_receipts" r WHERE r.submitted_version_id=v.id) OR EXISTS(SELECT 1 FROM "page_proposals" p WHERE p.proposed_version_id=v.id) OR EXISTS(SELECT 1 FROM "page_generation_requests" g WHERE g.result_version_id=v.id))
AND NOT EXISTS(SELECT 1 FROM "page_retirements" retired WHERE retired.version_id=v.id))
BEGIN SELECT RAISE(ABORT,'retained authored alternatives are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER page_retained_page_versions_delete BEFORE DELETE ON "page_versions"
WHEN EXISTS(SELECT 1 FROM "page_versions" v WHERE (v.id=OLD.id) AND (EXISTS(SELECT 1 FROM "page_edit_receipts" r WHERE r.submitted_version_id=v.id) OR EXISTS(SELECT 1 FROM "page_proposals" p WHERE p.proposed_version_id=v.id) OR EXISTS(SELECT 1 FROM "page_generation_requests" g WHERE g.result_version_id=v.id))
AND NOT EXISTS(SELECT 1 FROM "page_retirements" retired WHERE retired.version_id=v.id))
BEGIN SELECT RAISE(ABORT,'retained authored alternatives are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER page_retained_page_version_parents_insert BEFORE INSERT ON "page_version_parents"
WHEN EXISTS(SELECT 1 FROM "page_versions" v WHERE (v.id=NEW.version_id) AND (EXISTS(SELECT 1 FROM "page_edit_receipts" r WHERE r.submitted_version_id=v.id) OR EXISTS(SELECT 1 FROM "page_proposals" p WHERE p.proposed_version_id=v.id) OR EXISTS(SELECT 1 FROM "page_generation_requests" g WHERE g.result_version_id=v.id))
AND NOT EXISTS(SELECT 1 FROM "page_retirements" retired WHERE retired.version_id=v.id))
BEGIN SELECT RAISE(ABORT,'retained authored alternatives are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER page_retained_page_version_parents_update BEFORE UPDATE ON "page_version_parents"
WHEN EXISTS(SELECT 1 FROM "page_versions" v WHERE (v.id=OLD.version_id OR v.id=NEW.version_id) AND (EXISTS(SELECT 1 FROM "page_edit_receipts" r WHERE r.submitted_version_id=v.id) OR EXISTS(SELECT 1 FROM "page_proposals" p WHERE p.proposed_version_id=v.id) OR EXISTS(SELECT 1 FROM "page_generation_requests" g WHERE g.result_version_id=v.id))
AND NOT EXISTS(SELECT 1 FROM "page_retirements" retired WHERE retired.version_id=v.id))
BEGIN SELECT RAISE(ABORT,'retained authored alternatives are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER page_retained_page_version_parents_delete BEFORE DELETE ON "page_version_parents"
WHEN EXISTS(SELECT 1 FROM "page_versions" v WHERE (v.id=OLD.version_id) AND (EXISTS(SELECT 1 FROM "page_edit_receipts" r WHERE r.submitted_version_id=v.id) OR EXISTS(SELECT 1 FROM "page_proposals" p WHERE p.proposed_version_id=v.id) OR EXISTS(SELECT 1 FROM "page_generation_requests" g WHERE g.result_version_id=v.id))
AND NOT EXISTS(SELECT 1 FROM "page_retirements" retired WHERE retired.version_id=v.id))
BEGIN SELECT RAISE(ABORT,'retained authored alternatives are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER page_retained_page_inputs_insert BEFORE INSERT ON "page_inputs"
WHEN EXISTS(SELECT 1 FROM "page_versions" v WHERE (v.id=NEW.version_id) AND (EXISTS(SELECT 1 FROM "page_edit_receipts" r WHERE r.submitted_version_id=v.id) OR EXISTS(SELECT 1 FROM "page_proposals" p WHERE p.proposed_version_id=v.id) OR EXISTS(SELECT 1 FROM "page_generation_requests" g WHERE g.result_version_id=v.id))
AND NOT EXISTS(SELECT 1 FROM "page_retirements" retired WHERE retired.version_id=v.id))
BEGIN SELECT RAISE(ABORT,'retained authored alternatives are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER page_retained_page_inputs_update BEFORE UPDATE ON "page_inputs"
WHEN EXISTS(SELECT 1 FROM "page_versions" v WHERE (v.id=OLD.version_id OR v.id=NEW.version_id) AND (EXISTS(SELECT 1 FROM "page_edit_receipts" r WHERE r.submitted_version_id=v.id) OR EXISTS(SELECT 1 FROM "page_proposals" p WHERE p.proposed_version_id=v.id) OR EXISTS(SELECT 1 FROM "page_generation_requests" g WHERE g.result_version_id=v.id))
AND NOT EXISTS(SELECT 1 FROM "page_retirements" retired WHERE retired.version_id=v.id)) AND NOT(OLD.message_version_id IS NOT NULL AND NEW.message_version_id IS NULL AND NEW.id IS OLD.id AND NEW.version_id IS OLD.version_id AND NEW.request_id IS OLD.request_id AND NEW.position IS OLD.position AND NEW."page_version_id" IS OLD."page_version_id" AND NEW.source_id IS OLD.source_id AND NEW.source_revision IS OLD.source_revision AND NEW.source_snapshot_id IS OLD.source_snapshot_id AND NEW.exact_message_version_id IS OLD.exact_message_version_id)
BEGIN SELECT RAISE(ABORT,'retained authored alternatives are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER page_retained_page_inputs_delete BEFORE DELETE ON "page_inputs"
WHEN EXISTS(SELECT 1 FROM "page_versions" v WHERE (v.id=OLD.version_id) AND (EXISTS(SELECT 1 FROM "page_edit_receipts" r WHERE r.submitted_version_id=v.id) OR EXISTS(SELECT 1 FROM "page_proposals" p WHERE p.proposed_version_id=v.id) OR EXISTS(SELECT 1 FROM "page_generation_requests" g WHERE g.result_version_id=v.id))
AND NOT EXISTS(SELECT 1 FROM "page_retirements" retired WHERE retired.version_id=v.id))
BEGIN SELECT RAISE(ABORT,'retained authored alternatives are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER page_retained_page_citations_insert BEFORE INSERT ON "page_citations"
WHEN EXISTS(SELECT 1 FROM "page_versions" v WHERE (v.id=NEW.version_id) AND (EXISTS(SELECT 1 FROM "page_edit_receipts" r WHERE r.submitted_version_id=v.id) OR EXISTS(SELECT 1 FROM "page_proposals" p WHERE p.proposed_version_id=v.id) OR EXISTS(SELECT 1 FROM "page_generation_requests" g WHERE g.result_version_id=v.id))
AND NOT EXISTS(SELECT 1 FROM "page_retirements" retired WHERE retired.version_id=v.id))
BEGIN SELECT RAISE(ABORT,'retained authored alternatives are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER page_retained_page_citations_update BEFORE UPDATE ON "page_citations"
WHEN EXISTS(SELECT 1 FROM "page_versions" v WHERE (v.id=OLD.version_id OR v.id=NEW.version_id) AND (EXISTS(SELECT 1 FROM "page_edit_receipts" r WHERE r.submitted_version_id=v.id) OR EXISTS(SELECT 1 FROM "page_proposals" p WHERE p.proposed_version_id=v.id) OR EXISTS(SELECT 1 FROM "page_generation_requests" g WHERE g.result_version_id=v.id))
AND NOT EXISTS(SELECT 1 FROM "page_retirements" retired WHERE retired.version_id=v.id))
BEGIN SELECT RAISE(ABORT,'retained authored alternatives are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER page_retained_page_citations_delete BEFORE DELETE ON "page_citations"
WHEN EXISTS(SELECT 1 FROM "page_versions" v WHERE (v.id=OLD.version_id) AND (EXISTS(SELECT 1 FROM "page_edit_receipts" r WHERE r.submitted_version_id=v.id) OR EXISTS(SELECT 1 FROM "page_proposals" p WHERE p.proposed_version_id=v.id) OR EXISTS(SELECT 1 FROM "page_generation_requests" g WHERE g.result_version_id=v.id))
AND NOT EXISTS(SELECT 1 FROM "page_retirements" retired WHERE retired.version_id=v.id))
BEGIN SELECT RAISE(ABORT,'retained authored alternatives are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER note_reply_requests_active_insert BEFORE INSERT ON "note_reply_requests" WHEN EXISTS(SELECT 1 FROM "note_retired_intents" r WHERE r.request_id=NEW.request_id) OR EXISTS(SELECT 1 FROM workflow_retired_correlations r WHERE r.correlation_id=NEW.request_id AND r.event_type='NoteGenerationRequested') BEGIN SELECT RAISE(ABORT,'retired reply cannot restore captured content'); END;
--> statement-breakpoint
CREATE TRIGGER note_reply_requests_active_update BEFORE UPDATE ON "note_reply_requests" WHEN EXISTS(SELECT 1 FROM "note_retired_intents" r WHERE r.request_id=NEW.request_id) OR EXISTS(SELECT 1 FROM workflow_retired_correlations r WHERE r.correlation_id=NEW.request_id AND r.event_type='NoteGenerationRequested') BEGIN SELECT RAISE(ABORT,'retired reply cannot restore captured content'); END;
--> statement-breakpoint
CREATE TRIGGER note_run_contexts_active_request BEFORE INSERT ON "note_run_contexts" WHEN EXISTS(SELECT 1 FROM "note_retired_intents" r WHERE r.request_id=NEW.request_id) OR EXISTS(SELECT 1 FROM workflow_retired_correlations r WHERE r.correlation_id=NEW.request_id AND r.event_type='NoteGenerationRequested') BEGIN SELECT RAISE(ABORT,'retired context cannot capture newer content'); END;
--> statement-breakpoint
CREATE TRIGGER note_reply_version_active_insert BEFORE INSERT ON message_versions WHEN EXISTS(SELECT 1 FROM workflow_retired_correlations r WHERE r.event_type='NoteGenerationRequested' AND (r.correlation_id=NEW.generation_request_id OR EXISTS(SELECT 1 FROM "note_reply_requests" captured WHERE captured.version_id=NEW.id AND captured.request_id=r.correlation_id))) BEGIN SELECT RAISE(ABORT,'retired reply cannot publish'); END;
--> statement-breakpoint
CREATE TRIGGER note_reply_version_active_update BEFORE UPDATE OF status,text ON message_versions WHEN EXISTS(SELECT 1 FROM workflow_retired_correlations r WHERE r.event_type='NoteGenerationRequested' AND (r.correlation_id=NEW.generation_request_id OR EXISTS(SELECT 1 FROM "note_reply_requests" captured WHERE captured.version_id=NEW.id AND captured.request_id=r.correlation_id))) BEGIN SELECT RAISE(ABORT,'retired reply cannot publish'); END;
--> statement-breakpoint
CREATE TRIGGER note_selection_exact_inputs BEFORE UPDATE OF selection ON "notes"
WHEN EXISTS(SELECT 1 FROM json_each(NEW.selection) j WHERE
 json_extract(j.value,'$.input.kind') IS NULL OR json_extract(j.value,'$.input.kind') NOT IN('page','source')
 OR (json_extract(j.value,'$.input.kind')='page' AND NOT EXISTS(SELECT 1 FROM "page_versions" v WHERE CAST(v.id AS TEXT)=CAST(json_extract(j.value,'$.input.versionId') AS TEXT) AND v.status='published' AND NOT EXISTS(SELECT 1 FROM "page_retirements" r WHERE r.version_id=v.id) AND NOT EXISTS(SELECT 1 FROM "page_deletions" d WHERE d."page_id"=v."page_id")))
 OR (json_extract(j.value,'$.input.kind')='source' AND NOT EXISTS(SELECT 1 FROM source_extraction_revisions e WHERE CAST(e.source_id AS TEXT)=CAST(json_extract(j.value,'$.input.sourceId') AS TEXT) AND CAST(e.revision AS TEXT)=CAST(json_extract(j.value,'$.input.revision') AS TEXT) AND CAST(e.snapshot_id AS TEXT)=CAST(json_extract(j.value,'$.input.snapshotId') AS TEXT))))
BEGIN SELECT RAISE(ABORT,'session selection requires available exact domain inputs'); END;
--> statement-breakpoint
CREATE TRIGGER page_citation_assessments_retained BEFORE DELETE ON "page_citation_assessments"
WHEN NOT EXISTS(SELECT 1 FROM "page_retirements" r WHERE r.version_id=OLD.version_id)
BEGIN SELECT RAISE(ABORT,'user judgments require explicit body retirement'); END;
--> statement-breakpoint
CREATE TRIGGER page_citation_assessments_exact_user_insert BEFORE INSERT ON "page_citation_assessments"
WHEN json_type(NEW.payload,'$.independentVerification') IS NOT 'false'
 OR json_extract(NEW.payload,'$.suppliedBy') IS NOT 'user'
 OR json_type(NEW.payload,'$.note') IS NOT 'text'
 OR json_type(NEW.payload,'$.judgment') IS NOT 'text'
 OR json_type(NEW.payload,'$.evidenceRange') IS NOT 'object'
 OR json_extract(NEW.payload,'$.judgment') NOT IN('supports','contradicts','uncertain')
 OR NOT EXISTS(SELECT 1 FROM "page_versions" v
 JOIN "page_citations" c ON c.version_id=v.id AND c.marker=NEW.marker
 JOIN "page_inputs" i ON i.id=c.input_id AND i.version_id=v.id
 WHERE v.id=NEW.version_id AND v.status='published'
 AND NOT EXISTS(SELECT 1 FROM "page_retirements" r WHERE r.version_id=v.id)
 AND CAST(json_extract(NEW.payload,'$.claim.pageId') AS INTEGER)=v."page_id"
 AND CAST(json_extract(NEW.payload,'$.claim.range.versionId') AS INTEGER)=v.id
 AND CAST(json_extract(NEW.payload,'$.claim.range.snapshotId') AS INTEGER)=v.content_snapshot_id
 AND json_extract(NEW.payload,'$.claim.range.start')>=0 AND json_extract(NEW.payload,'$.claim.range.end')>json_extract(NEW.payload,'$.claim.range.start')
 AND EXISTS(SELECT 1 FROM blocks b WHERE b.document_id=v.content_snapshot_id AND b.editing_id=json_extract(NEW.payload,'$.claim.range.blockId'))
 AND json_extract(NEW.payload,'$.marker')=NEW.marker AND json_extract(NEW.payload,'$.citation.marker')=NEW.marker
 AND json_extract(NEW.payload,'$.citation.quote') IS c.quote
 AND json_extract(c.target,'$.blockId') IS NOT NULL
 AND json_extract(NEW.payload,'$.citation.target.blockId') IS json_extract(c.target,'$.blockId')
 AND json_extract(NEW.payload,'$.citation.target.start') IS json_extract(c.target,'$.start')
 AND json_extract(NEW.payload,'$.citation.target.end') IS json_extract(c.target,'$.end')
 AND NOT EXISTS(SELECT fullkey,type,atom FROM json_tree(json_extract(NEW.payload,'$.citation.anchor')) EXCEPT SELECT fullkey,type,atom FROM json_tree(c.anchor))
 AND NOT EXISTS(SELECT fullkey,type,atom FROM json_tree(c.anchor) EXCEPT SELECT fullkey,type,atom FROM json_tree(json_extract(NEW.payload,'$.citation.anchor')))

 AND json_extract(NEW.payload,'$.evidenceRange.blockId') IS json_extract(c.target,'$.blockId')
 AND json_extract(NEW.payload,'$.evidenceRange.start') IS json_extract(c.target,'$.start')
 AND json_extract(NEW.payload,'$.evidenceRange.end') IS json_extract(c.target,'$.end')
 AND ((i."page_version_id" IS NOT NULL AND json_extract(NEW.payload,'$.evidence.kind')='page'
   AND CAST(json_extract(NEW.payload,'$.evidence.versionId') AS INTEGER)=i."page_version_id"
   AND json_extract(NEW.payload,'$.citation.input.kind')='page'
   AND CAST(json_extract(NEW.payload,'$.citation.input.versionId') AS INTEGER)=i."page_version_id")
 OR (i.source_id IS NOT NULL AND i.source_snapshot_id IS NOT NULL AND json_extract(NEW.payload,'$.evidence.kind')='source'
   AND CAST(json_extract(NEW.payload,'$.evidence.sourceId') AS INTEGER)=i.source_id
   AND CAST(json_extract(NEW.payload,'$.evidence.revision') AS INTEGER)=i.source_revision
   AND CAST(json_extract(NEW.payload,'$.evidence.snapshotId') AS INTEGER)=i.source_snapshot_id
   AND json_extract(NEW.payload,'$.citation.input.kind')='source'
   AND CAST(json_extract(NEW.payload,'$.citation.input.sourceId') AS INTEGER)=i.source_id
   AND CAST(json_extract(NEW.payload,'$.citation.input.revision') AS INTEGER)=i.source_revision
   AND CAST(json_extract(NEW.payload,'$.citation.input.snapshotId') AS INTEGER)=i.source_snapshot_id)))
BEGIN SELECT RAISE(ABORT,'judgments require an exact declared citation and remain user supplied'); END;
--> statement-breakpoint
CREATE TRIGGER source_extraction_blocks_insert BEFORE INSERT ON blocks
WHEN EXISTS(SELECT 1 FROM source_extraction_revisions WHERE snapshot_id=NEW.document_id)
BEGIN SELECT RAISE(ABORT,'retained source extraction is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER source_extraction_blocks_update BEFORE UPDATE ON blocks
WHEN EXISTS(SELECT 1 FROM source_extraction_revisions WHERE snapshot_id=OLD.document_id) OR EXISTS(SELECT 1 FROM source_extraction_revisions WHERE snapshot_id=NEW.document_id)
BEGIN SELECT RAISE(ABORT,'retained source extraction is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER source_extraction_blocks_delete BEFORE DELETE ON blocks
WHEN EXISTS(SELECT 1 FROM source_extraction_revisions WHERE snapshot_id=OLD.document_id)
BEGIN SELECT RAISE(ABORT,'retained source extraction is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER source_extraction_document_assets_insert BEFORE INSERT ON document_assets
WHEN EXISTS(SELECT 1 FROM source_extraction_revisions WHERE snapshot_id=NEW.document_id)
BEGIN SELECT RAISE(ABORT,'retained source extraction is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER source_extraction_document_assets_update BEFORE UPDATE ON document_assets
WHEN EXISTS(SELECT 1 FROM source_extraction_revisions WHERE snapshot_id=OLD.document_id) OR EXISTS(SELECT 1 FROM source_extraction_revisions WHERE snapshot_id=NEW.document_id)
BEGIN SELECT RAISE(ABORT,'retained source extraction is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER source_extraction_document_assets_delete BEFORE DELETE ON document_assets
WHEN EXISTS(SELECT 1 FROM source_extraction_revisions WHERE snapshot_id=OLD.document_id)
BEGIN SELECT RAISE(ABORT,'retained source extraction is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER source_extraction_content_snapshots_update BEFORE UPDATE ON content_snapshots
WHEN EXISTS(SELECT 1 FROM source_extraction_revisions WHERE snapshot_id=OLD.id) OR EXISTS(SELECT 1 FROM source_extraction_revisions WHERE snapshot_id=NEW.id)
BEGIN SELECT RAISE(ABORT,'retained source extraction is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER source_extraction_content_snapshots_delete BEFORE DELETE ON content_snapshots
WHEN EXISTS(SELECT 1 FROM source_extraction_revisions WHERE snapshot_id=OLD.id)
BEGIN SELECT RAISE(ABORT,'retained source extraction is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER source_extraction_identity_update BEFORE UPDATE ON source_extraction_revisions BEGIN SELECT RAISE(ABORT,'retained extraction identity is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_generation_input_project BEFORE INSERT ON material_evidence_inputs WHEN NEW.request_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM material_generation_requests r WHERE r.id=NEW.request_id AND ((NEW."page_version_id" IS NOT NULL AND EXISTS(SELECT 1 FROM "page_versions" v JOIN "pages" d ON d.id=v."page_id" JOIN "project_pages" p ON p."page_id"=d.id WHERE v.id=NEW."page_version_id" AND v.status='published' AND d.archived_at IS NULL AND p.project_id=r.project_id AND NOT EXISTS(SELECT 1 FROM "page_retirements" x WHERE x.version_id=v.id))) OR (NEW.source_id IS NOT NULL AND EXISTS(SELECT 1 FROM sources s JOIN source_extraction_revisions e ON e.source_id=s.id WHERE s.id=NEW.source_id AND s.project_id=r.project_id AND e.revision=NEW.source_revision AND e.snapshot_id=NEW.source_snapshot_id)))) BEGIN SELECT RAISE(ABORT,'exact learning input is outside its project'); END;
--> statement-breakpoint
CREATE TRIGGER material_generation_publication_input_project BEFORE UPDATE OF status ON material_versions
WHEN NEW.status='published' AND OLD.status!='published' AND NEW.generation_request_id IS NOT NULL AND EXISTS(SELECT 1 FROM material_generation_requests r JOIN material_evidence_inputs i ON i.request_id=r.id WHERE r.id=NEW.generation_request_id AND NOT ((i."page_version_id" IS NOT NULL AND EXISTS(SELECT 1 FROM "page_versions" v JOIN "pages" d ON d.id=v."page_id" JOIN "project_pages" p ON p."page_id"=d.id WHERE v.id=i."page_version_id" AND v.status='published' AND d.archived_at IS NULL AND p.project_id=r.project_id AND NOT EXISTS(SELECT 1 FROM "page_retirements" x WHERE x.version_id=v.id))) OR (i.source_id IS NOT NULL AND EXISTS(SELECT 1 FROM sources s JOIN source_extraction_revisions e ON e.source_id=s.id WHERE s.id=i.source_id AND s.project_id=r.project_id AND e.revision=i.source_revision AND e.snapshot_id=i.source_snapshot_id))))
BEGIN SELECT RAISE(ABORT,'exact learning input is outside its project'); END;
--> statement-breakpoint
CREATE TRIGGER material_generation_receipt_input_project BEFORE UPDATE OF result_version_id ON material_generation_requests
WHEN OLD.result_version_id IS NULL AND NEW.result_version_id IS NOT NULL AND EXISTS(SELECT 1 FROM material_generation_requests r JOIN material_evidence_inputs i ON i.request_id=r.id WHERE r.id=NEW.id AND NOT ((i."page_version_id" IS NOT NULL AND EXISTS(SELECT 1 FROM "page_versions" v JOIN "pages" d ON d.id=v."page_id" JOIN "project_pages" p ON p."page_id"=d.id WHERE v.id=i."page_version_id" AND v.status='published' AND d.archived_at IS NULL AND p.project_id=r.project_id AND NOT EXISTS(SELECT 1 FROM "page_retirements" x WHERE x.version_id=v.id))) OR (i.source_id IS NOT NULL AND EXISTS(SELECT 1 FROM sources s JOIN source_extraction_revisions e ON e.source_id=s.id WHERE s.id=i.source_id AND s.project_id=r.project_id AND e.revision=i.source_revision AND e.snapshot_id=i.source_snapshot_id))))
BEGIN SELECT RAISE(ABORT,'exact learning input is outside its project'); END;
--> statement-breakpoint
CREATE TRIGGER page_publication_locations BEFORE UPDATE OF status ON "page_versions"
WHEN NEW.status='published' AND OLD.status!='published' AND EXISTS(SELECT 1 FROM blocks b WHERE b.document_id=NEW.content_snapshot_id AND NOT (CASE WHEN json_valid(b.anchor) THEN coalesce(
    json_type(b.anchor) = 'object' AND CASE json_extract(b.anchor, '$.type')
    WHEN 'authored' THEN 1
    WHEN 'time' THEN json_type(b.anchor, '$.startMs') = 'integer' AND json_extract(b.anchor, '$.startMs') >= 0
      AND json_type(b.anchor, '$.endMs') = 'integer' AND json_extract(b.anchor, '$.endMs') >= json_extract(b.anchor, '$.startMs')
    WHEN 'page' THEN json_type(b.anchor, '$.page') = 'integer' AND json_extract(b.anchor, '$.page') >= 1
    WHEN 'paragraph' THEN json_type(b.anchor, '$.index') = 'integer' AND json_extract(b.anchor, '$.index') >= 0
    WHEN 'slide' THEN json_type(b.anchor, '$.index') = 'integer' AND json_extract(b.anchor, '$.index') >= 0
    WHEN 'url' THEN json_type(b.anchor, '$.url') = 'text' AND length(trim(json_extract(b.anchor, '$.url'))) > 0
      AND json_type(b.anchor, '$.fragment') IN ('null', 'text')
    WHEN 'text' THEN json_type(b.anchor, '$.lineStart') = 'integer' AND json_extract(b.anchor, '$.lineStart') >= 0
      AND json_type(b.anchor, '$.lineEnd') = 'integer' AND json_extract(b.anchor, '$.lineEnd') >= json_extract(b.anchor, '$.lineStart')
      AND json_type(b.anchor, '$.start') = 'integer' AND json_extract(b.anchor, '$.start') >= 0
      AND json_type(b.anchor, '$.end') = 'integer' AND json_extract(b.anchor, '$.end') >= json_extract(b.anchor, '$.start')
    ELSE 0 END, 0) ELSE 0 END))
BEGIN SELECT RAISE(ABORT,'document publication requires canonical block locations'); END;
--> statement-breakpoint
CREATE TRIGGER page_generation_base_insert BEFORE INSERT ON "page_generation_requests"
WHEN (1) AND NEW.expected_version_id IS NOT NULL AND NOT (EXISTS(SELECT 1 FROM "page_versions" b WHERE b.id=NEW.expected_version_id AND b."page_id"=NEW."page_id" AND b.status='published' AND NOT EXISTS(SELECT 1 FROM "page_retirements" x WHERE x.version_id=b.id)))
BEGIN SELECT RAISE(ABORT,'generation requires its exact retained authored base'); END;
--> statement-breakpoint
CREATE TRIGGER page_generation_base_update BEFORE UPDATE OF result_version_id ON "page_generation_requests"
WHEN (OLD.result_version_id IS NULL AND NEW.result_version_id IS NOT NULL) AND NEW.expected_version_id IS NOT NULL AND NOT (EXISTS(SELECT 1 FROM "page_versions" b WHERE b.id=NEW.expected_version_id AND b."page_id"=NEW."page_id" AND b.status='published' AND NOT EXISTS(SELECT 1 FROM "page_retirements" x WHERE x.version_id=b.id)))
BEGIN SELECT RAISE(ABORT,'generation requires its exact retained authored base'); END;
--> statement-breakpoint
CREATE TRIGGER page_proposal_exact_owner BEFORE INSERT ON "page_proposals"
WHEN NOT (EXISTS(SELECT 1 FROM "page_generation_requests" r JOIN "page_versions" b ON b.id=NEW.base_version_id JOIN "page_versions" p ON p.id=NEW.proposed_version_id
 WHERE r.id=NEW.request_id AND r."page_id"=b."page_id" AND r.expected_version_id=b.id AND b.status='published'
 AND p."page_id"=b."page_id" AND p.status='draft' AND p.creator='agent' AND p.operation IN ('generate','summarize','translate')
 AND (r.result_version_id IS NULL OR r.result_version_id=p.id)
 AND NOT EXISTS(SELECT 1 FROM "page_retirements" x WHERE x.version_id IN (b.id,p.id))))
BEGIN SELECT RAISE(ABORT,'proposal requires its exact authored request and target'); END;
--> statement-breakpoint
CREATE TRIGGER page_generation_requests_retained_delete BEFORE DELETE ON "page_generation_requests"
WHEN 1
BEGIN SELECT RAISE(ABORT,'authored generation identities are retained'); END;
--> statement-breakpoint
CREATE TRIGGER page_proposals_retained_delete BEFORE DELETE ON "page_proposals"
WHEN 1
BEGIN SELECT RAISE(ABORT,'authored generation identities are retained'); END;
--> statement-breakpoint
CREATE TRIGGER page_proposal_receipt_exact_owner BEFORE INSERT ON "page_proposal_receipts"
WHEN NOT (EXISTS(SELECT 1 FROM "page_proposals" p JOIN "page_versions" base ON base.id=p.base_version_id JOIN "page_versions" proposed ON proposed.id=p.proposed_version_id JOIN "page_versions" current ON current.id=NEW.current_version_id
 WHERE p.request_id=NEW.request_id AND current."page_id"=base."page_id" AND current.status='published'
 AND NOT EXISTS(SELECT 1 FROM "page_retirements" x WHERE x.version_id IN (base.id,proposed.id,current.id))
 AND NOT EXISTS(SELECT 1 FROM "page_transform_requests" t WHERE t.id=p.request_id AND (t.cancelled=1 OR t."note_id" IS NULL OR EXISTS(SELECT 1 FROM "note_deletions" d WHERE d."note_id"=t."note_id")))
 AND NOT EXISTS(SELECT 1 FROM "page_proposal_receipts" old WHERE old.request_id=NEW.request_id AND old.operation=NEW.operation AND old.result_version_id IS NOT NULL)
 AND ((NEW.outcome='conflict' AND NOT EXISTS(SELECT 1 FROM "page_versions" newer WHERE newer."page_id"=current."page_id" AND newer.status='published' AND newer.number>current.number))
 OR EXISTS(SELECT 1 FROM "page_versions" result WHERE result.id=NEW.result_version_id AND result.status='published'
 AND NOT EXISTS(SELECT 1 FROM "page_retirements" x WHERE x.version_id=result.id)
 AND NOT EXISTS(SELECT position,"page_version_id",source_id,source_revision,source_snapshot_id,exact_message_version_id FROM "page_inputs" WHERE version_id=proposed.id EXCEPT SELECT position,"page_version_id",source_id,source_revision,source_snapshot_id,exact_message_version_id FROM "page_inputs" WHERE version_id=result.id) AND NOT EXISTS(SELECT position,"page_version_id",source_id,source_revision,source_snapshot_id,exact_message_version_id FROM "page_inputs" WHERE version_id=result.id EXCEPT SELECT position,"page_version_id",source_id,source_revision,source_snapshot_id,exact_message_version_id FROM "page_inputs" WHERE version_id=proposed.id) AND NOT EXISTS(SELECT c.marker,c.quote,i.position,i."page_version_id",i.source_id,i.source_revision,i.source_snapshot_id,i.exact_message_version_id FROM "page_citations" c JOIN "page_inputs" i ON i.id=c.input_id WHERE c.version_id=proposed.id EXCEPT SELECT c.marker,c.quote,i.position,i."page_version_id",i.source_id,i.source_revision,i.source_snapshot_id,i.exact_message_version_id FROM "page_citations" c JOIN "page_inputs" i ON i.id=c.input_id WHERE c.version_id=result.id) AND NOT EXISTS(SELECT c.marker,c.quote,i.position,i."page_version_id",i.source_id,i.source_revision,i.source_snapshot_id,i.exact_message_version_id FROM "page_citations" c JOIN "page_inputs" i ON i.id=c.input_id WHERE c.version_id=result.id EXCEPT SELECT c.marker,c.quote,i.position,i."page_version_id",i.source_id,i.source_revision,i.source_snapshot_id,i.exact_message_version_id FROM "page_citations" c JOIN "page_inputs" i ON i.id=c.input_id WHERE c.version_id=proposed.id) AND NOT EXISTS(SELECT 1 FROM "page_citations" ca JOIN "page_citations" cb ON cb.version_id=result.id AND cb.marker=ca.marker WHERE ca.version_id=proposed.id AND (NOT (ca.anchor IS cb.anchor OR (ca.anchor IS NOT NULL AND cb.anchor IS NOT NULL AND NOT EXISTS(SELECT fullkey,type,atom FROM json_tree(ca.anchor) EXCEPT SELECT fullkey,type,atom FROM json_tree(cb.anchor)) AND NOT EXISTS(SELECT fullkey,type,atom FROM json_tree(cb.anchor) EXCEPT SELECT fullkey,type,atom FROM json_tree(ca.anchor)))) OR NOT (ca.target IS cb.target OR (ca.target IS NOT NULL AND cb.target IS NOT NULL AND NOT EXISTS(SELECT fullkey,type,atom FROM json_tree(ca.target) EXCEPT SELECT fullkey,type,atom FROM json_tree(cb.target)) AND NOT EXISTS(SELECT fullkey,type,atom FROM json_tree(cb.target) EXCEPT SELECT fullkey,type,atom FROM json_tree(ca.target))))))
 AND ((NEW.outcome='applied' AND result."page_id"=base."page_id" AND current.id=base.id AND result.creator='user' AND result.operation='edit'
 AND result.instruction IS proposed.instruction AND result.language IS proposed.language
 AND EXISTS(SELECT 1 FROM "page_version_parents" parent WHERE parent.version_id=result.id AND parent.parent_version_id=base.id)
 AND NOT EXISTS(SELECT 1 FROM "page_version_parents" parent WHERE parent.version_id=result.id AND parent.parent_version_id!=base.id)
 AND NOT EXISTS(SELECT 1 FROM "page_versions" middle WHERE middle."page_id"=base."page_id" AND middle.status='published' AND middle.number>base.number AND middle.number<result.number)
 AND ((SELECT meta FROM content_snapshots WHERE id=proposed.content_snapshot_id) IS (SELECT meta FROM content_snapshots WHERE id=result.content_snapshot_id) OR ((SELECT meta FROM content_snapshots WHERE id=proposed.content_snapshot_id) IS NOT NULL AND (SELECT meta FROM content_snapshots WHERE id=result.content_snapshot_id) IS NOT NULL AND NOT EXISTS(SELECT fullkey,type,atom FROM json_tree((SELECT meta FROM content_snapshots WHERE id=proposed.content_snapshot_id)) EXCEPT SELECT fullkey,type,atom FROM json_tree((SELECT meta FROM content_snapshots WHERE id=result.content_snapshot_id))) AND NOT EXISTS(SELECT fullkey,type,atom FROM json_tree((SELECT meta FROM content_snapshots WHERE id=result.content_snapshot_id)) EXCEPT SELECT fullkey,type,atom FROM json_tree((SELECT meta FROM content_snapshots WHERE id=proposed.content_snapshot_id)))))
 AND (SELECT COUNT(*) FROM blocks WHERE document_id=proposed.content_snapshot_id)=(SELECT COUNT(*) FROM blocks WHERE document_id=result.content_snapshot_id)
 AND NOT EXISTS(SELECT 1 FROM blocks ob WHERE ob.document_id=proposed.content_snapshot_id AND NOT EXISTS(SELECT 1 FROM blocks nb WHERE nb.document_id=result.content_snapshot_id
 AND nb.ordinal=ob.ordinal AND nb.kind=ob.kind AND nb.text=ob.text AND nb.editing_id=ob.editing_id
 AND (ob.content IS nb.content OR (ob.content IS NOT NULL AND nb.content IS NOT NULL AND NOT EXISTS(SELECT fullkey,type,atom FROM json_tree(ob.content) EXCEPT SELECT fullkey,type,atom FROM json_tree(nb.content)) AND NOT EXISTS(SELECT fullkey,type,atom FROM json_tree(nb.content) EXCEPT SELECT fullkey,type,atom FROM json_tree(ob.content)))) AND (ob.anchor IS nb.anchor OR (ob.anchor IS NOT NULL AND nb.anchor IS NOT NULL AND NOT EXISTS(SELECT fullkey,type,atom FROM json_tree(ob.anchor) EXCEPT SELECT fullkey,type,atom FROM json_tree(nb.anchor)) AND NOT EXISTS(SELECT fullkey,type,atom FROM json_tree(nb.anchor) EXCEPT SELECT fullkey,type,atom FROM json_tree(ob.anchor)))))))
 OR (NEW.outcome='kept' AND result."page_id"!=base."page_id" AND result.number=1 AND result.creator='agent'
 AND result.operation=CASE WHEN proposed.operation='translate' THEN 'translate' ELSE 'generate' END
 AND result.instruction=coalesce(proposed.instruction,'Retained proposal') AND result.language IS proposed.language
 AND NOT EXISTS(SELECT 1 FROM "page_version_parents" parent WHERE parent.version_id=result.id)
 AND NOT EXISTS(SELECT 1 FROM "page_versions" newer WHERE newer."page_id"=current."page_id" AND newer.status='published' AND newer.number>current.number)
 AND NOT EXISTS(SELECT 1 FROM blocks old JOIN blocks fresh ON fresh.editing_id=old.editing_id WHERE old.document_id=proposed.content_snapshot_id AND fresh.document_id=result.content_snapshot_id)
 AND ((SELECT meta FROM content_snapshots WHERE id=proposed.content_snapshot_id) IS (SELECT meta FROM content_snapshots WHERE id=result.content_snapshot_id) OR ((SELECT meta FROM content_snapshots WHERE id=proposed.content_snapshot_id) IS NOT NULL AND (SELECT meta FROM content_snapshots WHERE id=result.content_snapshot_id) IS NOT NULL AND NOT EXISTS(SELECT fullkey,type,atom FROM json_tree((SELECT meta FROM content_snapshots WHERE id=proposed.content_snapshot_id)) EXCEPT SELECT fullkey,type,atom FROM json_tree((SELECT meta FROM content_snapshots WHERE id=result.content_snapshot_id))) AND NOT EXISTS(SELECT fullkey,type,atom FROM json_tree((SELECT meta FROM content_snapshots WHERE id=result.content_snapshot_id)) EXCEPT SELECT fullkey,type,atom FROM json_tree((SELECT meta FROM content_snapshots WHERE id=proposed.content_snapshot_id)))))
 AND (SELECT COUNT(*) FROM blocks WHERE document_id=proposed.content_snapshot_id)=(SELECT COUNT(*) FROM blocks WHERE document_id=result.content_snapshot_id)
 AND NOT EXISTS(SELECT 1 FROM blocks ob WHERE ob.document_id=proposed.content_snapshot_id AND NOT EXISTS(SELECT 1 FROM blocks nb WHERE nb.document_id=result.content_snapshot_id
 AND nb.ordinal=ob.ordinal AND nb.kind=ob.kind AND nb.text=ob.text AND nb.editing_id!=ob.editing_id
 AND (ob.content IS nb.content OR (ob.content IS NOT NULL AND nb.content IS NOT NULL AND NOT EXISTS(SELECT fullkey,type,atom FROM json_tree(ob.content) EXCEPT SELECT fullkey,type,atom FROM json_tree(nb.content)) AND NOT EXISTS(SELECT fullkey,type,atom FROM json_tree(nb.content) EXCEPT SELECT fullkey,type,atom FROM json_tree(ob.content)))) AND (ob.anchor IS nb.anchor OR (ob.anchor IS NOT NULL AND nb.anchor IS NOT NULL AND NOT EXISTS(SELECT fullkey,type,atom FROM json_tree(ob.anchor) EXCEPT SELECT fullkey,type,atom FROM json_tree(nb.anchor)) AND NOT EXISTS(SELECT fullkey,type,atom FROM json_tree(nb.anchor) EXCEPT SELECT fullkey,type,atom FROM json_tree(ob.anchor))))))))))))
BEGIN SELECT RAISE(ABORT,'proposal receipt requires its exact retained result and target'); END;
--> statement-breakpoint
CREATE TRIGGER page_proposal_receipts_retained_delete BEFORE DELETE ON "page_proposal_receipts"
WHEN 1
BEGIN SELECT RAISE(ABORT,'authored proposal receipts are retained'); END;
--> statement-breakpoint
CREATE TRIGGER source_extraction_citation_retained BEFORE DELETE ON source_extraction_revisions
WHEN EXISTS(SELECT 1 FROM citations c WHERE c.document_id=OLD.snapshot_id)
BEGIN SELECT RAISE(ABORT,'raw citations retain exact source extraction'); END;
--> statement-breakpoint
CREATE TRIGGER source_citation_retained BEFORE DELETE ON sources
WHEN EXISTS(SELECT 1 FROM citations c JOIN content_snapshots body ON body.id=c.document_id WHERE body.source_id=OLD.id)
BEGIN SELECT RAISE(ABORT,'raw citations retain exact source bytes and extraction'); END;
--> statement-breakpoint
CREATE TRIGGER page_citation_retained BEFORE INSERT ON "page_retirements"
WHEN EXISTS(SELECT 1 FROM citations c JOIN "page_versions" v ON v.id=NEW.version_id WHERE c.authored_version_id=v.id OR c.document_id=v.content_snapshot_id)
BEGIN SELECT RAISE(ABORT,'raw citations retain exact authored bodies'); END;
--> statement-breakpoint
CREATE TRIGGER page_generation_result_insert BEFORE INSERT ON "page_generation_requests"
WHEN NEW.result_version_id IS NOT NULL AND (NOT (EXISTS(SELECT 1 FROM "page_versions" v WHERE v.id=NEW.result_version_id AND v."page_id"=NEW."page_id" AND v.creator='agent' AND v.operation IN ('generate','summarize','translate')
 AND NOT EXISTS(SELECT 1 FROM "page_retirements" x WHERE x.version_id=v.id)
 AND ((NEW.expected_version_id IS NULL AND v.status='published' AND v.number=1)
 OR (NEW.expected_version_id IS NOT NULL
  AND (SELECT COUNT(*) FROM "page_version_parents" p WHERE p.version_id=v.id)=1
  AND EXISTS(SELECT 1 FROM "page_version_parents" p WHERE p.version_id=v.id AND p.parent_version_id=NEW.expected_version_id AND p."page_id"=NEW."page_id")
  AND (v.status='published' OR EXISTS(SELECT 1 FROM "page_proposals" p WHERE p.request_id=NEW.id AND p.base_version_id=NEW.expected_version_id AND p.proposed_version_id=v.id)))))) OR NOT (NOT EXISTS(SELECT 1 FROM "page_transform_requests" WHERE id=NEW.id) OR EXISTS(
 SELECT 1 FROM "page_transform_requests" tr
 JOIN "page_versions" v ON v.id=NEW.result_version_id
 JOIN "pages" output ON output.id=v."page_id"
 WHERE tr.id=NEW.id AND tr."note_id" IS NULL AND NEW."note_id" IS NULL
 AND NEW.expected_version_id IS NULL AND tr.cancelled=0
 AND json_type(tr.request,'$.merge')='object'
 AND json_extract(tr.request,'$.contextRequestId')=tr.context_request_id
 AND tr.context_request_id='merge/' || json_extract(tr.request,'$.merge.key')
 AND json_extract(tr.request,'$.editTargetVersionId') IS NULL
 AND json_extract(tr.request,'$.title')=json_extract(tr.request,'$.merge.title')
 AND output.title=json_extract(tr.request,'$.title')
 AND v.operation='generate' AND v.language IS json_extract(tr.request,'$.merge.language')
 AND v.instruction=CASE WHEN tr.instruction!='' THEN tr.instruction ELSE (SELECT group_concat(value,', ') FROM json_each(tr.request,'$.operations')) END
 AND NOT EXISTS(SELECT 1 FROM workflow_retired_correlations r WHERE r.correlation_id IN (tr.id,tr.context_request_id))
 AND NOT EXISTS(SELECT 1 FROM workflow_executions e WHERE e.status='cancelled' AND json_extract(e.payload,'$.event.correlationId') IN (tr.id,tr.context_request_id))
 AND json_type(tr.request,'$.merge.versions')='array'
 AND json_array_length(tr.request,'$.merge.versions') BETWEEN 2 AND 20
 AND (SELECT COUNT(*) FROM "page_inputs" i WHERE i.version_id=v.id)=json_array_length(tr.request,'$.merge.versions')
 AND (SELECT COUNT(DISTINCT b."page_id") FROM json_each(tr.request,'$.merge.versions') j
      JOIN "page_versions" b ON CAST(b.id AS TEXT)=j.value)=json_array_length(tr.request,'$.merge.versions')
 AND NOT EXISTS(
   SELECT 1 FROM json_each(tr.request,'$.merge.versions') j WHERE NOT EXISTS(
     SELECT 1 FROM "page_versions" b
     JOIN "pages" d ON d.id=b."page_id"
     JOIN "page_inputs" i ON i.version_id=v.id AND i."page_version_id"=b.id AND i.position=CAST(j.key AS INTEGER)
     WHERE CAST(b.id AS TEXT)=j.value AND b.status='published'
     AND b."page_id"!=v."page_id" AND d.archived_at IS NULL
     AND NOT EXISTS(SELECT 1 FROM "page_versions" newer WHERE newer."page_id"=b."page_id" AND newer.status='published' AND newer.number>b.number)
     AND NOT EXISTS(SELECT 1 FROM "page_retirements" r WHERE r.version_id=b.id)
     AND NOT EXISTS(SELECT 1 FROM "page_deletions" x WHERE x."page_id"=b."page_id")
   )
 )
) OR EXISTS(
 SELECT 1 FROM "page_transform_requests" tr JOIN "note_run_contexts" c ON c.request_id=tr.context_request_id JOIN "page_versions" v ON v.id=NEW.result_version_id
 WHERE tr.id=NEW.id AND (NEW."note_id" IS NULL OR NEW."note_id"=tr."note_id") AND tr.cancelled=0 AND tr."note_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "note_deletions" d WHERE d."note_id"=tr."note_id")
 AND NOT EXISTS(SELECT 1 FROM workflow_retired_correlations r WHERE r.correlation_id IN (tr.id,tr.context_request_id))
 AND NOT EXISTS(SELECT 1 FROM workflow_executions e WHERE e.status='cancelled' AND json_extract(e.payload,'$.event.correlationId') IN (tr.id,tr.context_request_id))
 AND tr.context_request_id=c.request_id AND c."note_id"=tr."note_id"
 AND json_extract(c.snapshot,'$.requestId')=c.request_id AND json_extract(c.snapshot,'$.noteId')=CAST(c."note_id" AS TEXT)
 AND json_extract(tr.request,'$.contextRequestId')=tr.context_request_id
 AND json_extract(tr.request,'$.editTargetVersionId') IS CASE WHEN NEW.expected_version_id IS NULL THEN NULL ELSE CAST(NEW.expected_version_id AS TEXT) END
 AND (NEW.expected_version_id IS NULL OR EXISTS(SELECT 1 FROM json_each(c.snapshot,'$.inputs') j JOIN "page_versions" b ON CAST(json_extract(j.value,'$.input.versionId') AS INTEGER)=b.id
  WHERE json_extract(j.value,'$.input.kind')='page' AND b.id=NEW.expected_version_id
   AND json_extract(j.value,'$.scope.kind')='document' AND json_extract(j.value,'$.snapshotId')=CAST(b.content_snapshot_id AS TEXT)))
 AND NOT EXISTS(SELECT 1 FROM json_each(c.snapshot,'$.inputs') j WHERE
  (json_extract(j.value,'$.input.kind')='page' AND NOT EXISTS(SELECT 1 FROM "page_versions" b JOIN "note_context_pages" p ON p.version_id=b.id AND p.request_id=c.request_id
   WHERE b.id=CAST(json_extract(j.value,'$.input.versionId') AS INTEGER) AND CAST(b.content_snapshot_id AS TEXT)=json_extract(j.value,'$.snapshotId')))
  OR (json_extract(j.value,'$.input.kind')='source' AND NOT EXISTS(SELECT 1 FROM "note_context_sources" p WHERE p.request_id=c.request_id
   AND CAST(p.source_id AS TEXT)=json_extract(j.value,'$.input.sourceId') AND CAST(p.revision AS TEXT)=json_extract(j.value,'$.input.revision')
   AND CAST(p.snapshot_id AS TEXT)=json_extract(j.value,'$.input.snapshotId') AND CAST(p.snapshot_id AS TEXT)=json_extract(j.value,'$.snapshotId')))
  OR json_extract(j.value,'$.input.kind') IS NULL OR json_extract(j.value,'$.input.kind') NOT IN ('page','source'))
 AND (SELECT COUNT(*) FROM "page_inputs" i WHERE i.version_id=NEW.result_version_id)=
  (SELECT COUNT(*) FROM "note_context_pages" WHERE request_id=c.request_id)+(SELECT COUNT(*) FROM "note_context_sources" WHERE request_id=c.request_id)+json_array_length(c.snapshot,'$.messages')
 AND NOT EXISTS(SELECT version_id FROM "note_context_pages" WHERE request_id=c.request_id EXCEPT SELECT "page_version_id" FROM "page_inputs" WHERE version_id=NEW.result_version_id AND "page_version_id" IS NOT NULL)
 AND NOT EXISTS(SELECT "page_version_id" FROM "page_inputs" WHERE version_id=NEW.result_version_id AND "page_version_id" IS NOT NULL EXCEPT SELECT version_id FROM "note_context_pages" WHERE request_id=c.request_id)
 AND NOT EXISTS(SELECT source_id,revision,snapshot_id FROM "note_context_sources" WHERE request_id=c.request_id EXCEPT SELECT source_id,source_revision,source_snapshot_id FROM "page_inputs" WHERE version_id=NEW.result_version_id AND source_id IS NOT NULL)
 AND NOT EXISTS(SELECT source_id,source_revision,source_snapshot_id FROM "page_inputs" WHERE version_id=NEW.result_version_id AND source_id IS NOT NULL EXCEPT SELECT source_id,revision,snapshot_id FROM "note_context_sources" WHERE request_id=c.request_id)
 AND NOT EXISTS(SELECT CAST(json_extract(j.value,'$.versionId') AS INTEGER) FROM json_each(c.snapshot,'$.messages') j EXCEPT SELECT exact_message_version_id FROM "page_inputs" WHERE version_id=NEW.result_version_id AND exact_message_version_id IS NOT NULL)
 AND NOT EXISTS(SELECT exact_message_version_id FROM "page_inputs" WHERE version_id=NEW.result_version_id AND exact_message_version_id IS NOT NULL EXCEPT SELECT CAST(json_extract(j.value,'$.versionId') AS INTEGER) FROM json_each(c.snapshot,'$.messages') j)
 AND v.instruction=CASE WHEN tr.instruction!='' THEN tr.instruction ELSE (SELECT group_concat(value,', ') FROM json_each(tr.request,'$.operations')) END
 AND v.operation=CASE WHEN EXISTS(SELECT 1 FROM json_each(tr.request,'$.operations') WHERE value='translate') THEN 'translate' WHEN EXISTS(SELECT 1 FROM json_each(tr.request,'$.operations') WHERE value='summarize') THEN 'summarize' ELSE 'generate' END
 AND (NEW.expected_version_id IS NOT NULL OR (SELECT title FROM "pages" WHERE id=v."page_id")=json_extract(tr.request,'$.title')))))
BEGIN SELECT RAISE(ABORT,'authored generation result does not match its exact retained authority'); END;
--> statement-breakpoint
CREATE TRIGGER page_generation_result_update BEFORE UPDATE OF result_version_id ON "page_generation_requests"
WHEN NEW.result_version_id IS NOT NULL AND OLD.result_version_id IS NULL AND (NOT (EXISTS(SELECT 1 FROM "page_versions" v WHERE v.id=NEW.result_version_id AND v."page_id"=NEW."page_id" AND v.creator='agent' AND v.operation IN ('generate','summarize','translate')
 AND NOT EXISTS(SELECT 1 FROM "page_retirements" x WHERE x.version_id=v.id)
 AND ((NEW.expected_version_id IS NULL AND v.status='published' AND v.number=1)
 OR (NEW.expected_version_id IS NOT NULL
  AND (SELECT COUNT(*) FROM "page_version_parents" p WHERE p.version_id=v.id)=1
  AND EXISTS(SELECT 1 FROM "page_version_parents" p WHERE p.version_id=v.id AND p.parent_version_id=NEW.expected_version_id AND p."page_id"=NEW."page_id")
  AND (v.status='published' OR EXISTS(SELECT 1 FROM "page_proposals" p WHERE p.request_id=NEW.id AND p.base_version_id=NEW.expected_version_id AND p.proposed_version_id=v.id)))))) OR NOT (NOT EXISTS(SELECT 1 FROM "page_transform_requests" WHERE id=NEW.id) OR EXISTS(
 SELECT 1 FROM "page_transform_requests" tr
 JOIN "page_versions" v ON v.id=NEW.result_version_id
 JOIN "pages" output ON output.id=v."page_id"
 WHERE tr.id=NEW.id AND tr."note_id" IS NULL AND NEW."note_id" IS NULL
 AND NEW.expected_version_id IS NULL AND tr.cancelled=0
 AND json_type(tr.request,'$.merge')='object'
 AND json_extract(tr.request,'$.contextRequestId')=tr.context_request_id
 AND tr.context_request_id='merge/' || json_extract(tr.request,'$.merge.key')
 AND json_extract(tr.request,'$.editTargetVersionId') IS NULL
 AND json_extract(tr.request,'$.title')=json_extract(tr.request,'$.merge.title')
 AND output.title=json_extract(tr.request,'$.title')
 AND v.operation='generate' AND v.language IS json_extract(tr.request,'$.merge.language')
 AND v.instruction=CASE WHEN tr.instruction!='' THEN tr.instruction ELSE (SELECT group_concat(value,', ') FROM json_each(tr.request,'$.operations')) END
 AND NOT EXISTS(SELECT 1 FROM workflow_retired_correlations r WHERE r.correlation_id IN (tr.id,tr.context_request_id))
 AND NOT EXISTS(SELECT 1 FROM workflow_executions e WHERE e.status='cancelled' AND json_extract(e.payload,'$.event.correlationId') IN (tr.id,tr.context_request_id))
 AND json_type(tr.request,'$.merge.versions')='array'
 AND json_array_length(tr.request,'$.merge.versions') BETWEEN 2 AND 20
 AND (SELECT COUNT(*) FROM "page_inputs" i WHERE i.version_id=v.id)=json_array_length(tr.request,'$.merge.versions')
 AND (SELECT COUNT(DISTINCT b."page_id") FROM json_each(tr.request,'$.merge.versions') j
      JOIN "page_versions" b ON CAST(b.id AS TEXT)=j.value)=json_array_length(tr.request,'$.merge.versions')
 AND NOT EXISTS(
   SELECT 1 FROM json_each(tr.request,'$.merge.versions') j WHERE NOT EXISTS(
     SELECT 1 FROM "page_versions" b
     JOIN "pages" d ON d.id=b."page_id"
     JOIN "page_inputs" i ON i.version_id=v.id AND i."page_version_id"=b.id AND i.position=CAST(j.key AS INTEGER)
     WHERE CAST(b.id AS TEXT)=j.value AND b.status='published'
     AND b."page_id"!=v."page_id" AND d.archived_at IS NULL
     AND NOT EXISTS(SELECT 1 FROM "page_versions" newer WHERE newer."page_id"=b."page_id" AND newer.status='published' AND newer.number>b.number)
     AND NOT EXISTS(SELECT 1 FROM "page_retirements" r WHERE r.version_id=b.id)
     AND NOT EXISTS(SELECT 1 FROM "page_deletions" x WHERE x."page_id"=b."page_id")
   )
 )
) OR EXISTS(
 SELECT 1 FROM "page_transform_requests" tr JOIN "note_run_contexts" c ON c.request_id=tr.context_request_id JOIN "page_versions" v ON v.id=NEW.result_version_id
 WHERE tr.id=NEW.id AND (NEW."note_id" IS NULL OR NEW."note_id"=tr."note_id") AND tr.cancelled=0 AND tr."note_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "note_deletions" d WHERE d."note_id"=tr."note_id")
 AND NOT EXISTS(SELECT 1 FROM workflow_retired_correlations r WHERE r.correlation_id IN (tr.id,tr.context_request_id))
 AND NOT EXISTS(SELECT 1 FROM workflow_executions e WHERE e.status='cancelled' AND json_extract(e.payload,'$.event.correlationId') IN (tr.id,tr.context_request_id))
 AND tr.context_request_id=c.request_id AND c."note_id"=tr."note_id"
 AND json_extract(c.snapshot,'$.requestId')=c.request_id AND json_extract(c.snapshot,'$.noteId')=CAST(c."note_id" AS TEXT)
 AND json_extract(tr.request,'$.contextRequestId')=tr.context_request_id
 AND json_extract(tr.request,'$.editTargetVersionId') IS CASE WHEN NEW.expected_version_id IS NULL THEN NULL ELSE CAST(NEW.expected_version_id AS TEXT) END
 AND (NEW.expected_version_id IS NULL OR EXISTS(SELECT 1 FROM json_each(c.snapshot,'$.inputs') j JOIN "page_versions" b ON CAST(json_extract(j.value,'$.input.versionId') AS INTEGER)=b.id
  WHERE json_extract(j.value,'$.input.kind')='page' AND b.id=NEW.expected_version_id
   AND json_extract(j.value,'$.scope.kind')='document' AND json_extract(j.value,'$.snapshotId')=CAST(b.content_snapshot_id AS TEXT)))
 AND NOT EXISTS(SELECT 1 FROM json_each(c.snapshot,'$.inputs') j WHERE
  (json_extract(j.value,'$.input.kind')='page' AND NOT EXISTS(SELECT 1 FROM "page_versions" b JOIN "note_context_pages" p ON p.version_id=b.id AND p.request_id=c.request_id
   WHERE b.id=CAST(json_extract(j.value,'$.input.versionId') AS INTEGER) AND CAST(b.content_snapshot_id AS TEXT)=json_extract(j.value,'$.snapshotId')))
  OR (json_extract(j.value,'$.input.kind')='source' AND NOT EXISTS(SELECT 1 FROM "note_context_sources" p WHERE p.request_id=c.request_id
   AND CAST(p.source_id AS TEXT)=json_extract(j.value,'$.input.sourceId') AND CAST(p.revision AS TEXT)=json_extract(j.value,'$.input.revision')
   AND CAST(p.snapshot_id AS TEXT)=json_extract(j.value,'$.input.snapshotId') AND CAST(p.snapshot_id AS TEXT)=json_extract(j.value,'$.snapshotId')))
  OR json_extract(j.value,'$.input.kind') IS NULL OR json_extract(j.value,'$.input.kind') NOT IN ('page','source'))
 AND (SELECT COUNT(*) FROM "page_inputs" i WHERE i.version_id=NEW.result_version_id)=
  (SELECT COUNT(*) FROM "note_context_pages" WHERE request_id=c.request_id)+(SELECT COUNT(*) FROM "note_context_sources" WHERE request_id=c.request_id)+json_array_length(c.snapshot,'$.messages')
 AND NOT EXISTS(SELECT version_id FROM "note_context_pages" WHERE request_id=c.request_id EXCEPT SELECT "page_version_id" FROM "page_inputs" WHERE version_id=NEW.result_version_id AND "page_version_id" IS NOT NULL)
 AND NOT EXISTS(SELECT "page_version_id" FROM "page_inputs" WHERE version_id=NEW.result_version_id AND "page_version_id" IS NOT NULL EXCEPT SELECT version_id FROM "note_context_pages" WHERE request_id=c.request_id)
 AND NOT EXISTS(SELECT source_id,revision,snapshot_id FROM "note_context_sources" WHERE request_id=c.request_id EXCEPT SELECT source_id,source_revision,source_snapshot_id FROM "page_inputs" WHERE version_id=NEW.result_version_id AND source_id IS NOT NULL)
 AND NOT EXISTS(SELECT source_id,source_revision,source_snapshot_id FROM "page_inputs" WHERE version_id=NEW.result_version_id AND source_id IS NOT NULL EXCEPT SELECT source_id,revision,snapshot_id FROM "note_context_sources" WHERE request_id=c.request_id)
 AND NOT EXISTS(SELECT CAST(json_extract(j.value,'$.versionId') AS INTEGER) FROM json_each(c.snapshot,'$.messages') j EXCEPT SELECT exact_message_version_id FROM "page_inputs" WHERE version_id=NEW.result_version_id AND exact_message_version_id IS NOT NULL)
 AND NOT EXISTS(SELECT exact_message_version_id FROM "page_inputs" WHERE version_id=NEW.result_version_id AND exact_message_version_id IS NOT NULL EXCEPT SELECT CAST(json_extract(j.value,'$.versionId') AS INTEGER) FROM json_each(c.snapshot,'$.messages') j)
 AND v.instruction=CASE WHEN tr.instruction!='' THEN tr.instruction ELSE (SELECT group_concat(value,', ') FROM json_each(tr.request,'$.operations')) END
 AND v.operation=CASE WHEN EXISTS(SELECT 1 FROM json_each(tr.request,'$.operations') WHERE value='translate') THEN 'translate' WHEN EXISTS(SELECT 1 FROM json_each(tr.request,'$.operations') WHERE value='summarize') THEN 'summarize' ELSE 'generate' END
 AND (NEW.expected_version_id IS NOT NULL OR (SELECT title FROM "pages" WHERE id=v."page_id")=json_extract(tr.request,'$.title')))))
BEGIN SELECT RAISE(ABORT,'authored generation result does not match its exact retained authority'); END;
--> statement-breakpoint
CREATE TRIGGER page_transform_result_hash BEFORE UPDATE OF result_version_id ON "page_transform_requests"
WHEN OLD.result_version_id IS NULL AND NEW.result_version_id IS NOT NULL AND (NEW.result_hash IS NULL OR length(NEW.result_hash)!=64 OR NEW.result_hash GLOB '*[^0-9a-f]*' OR NEW.cancelled=1 OR (NEW."note_id" IS NULL AND json_type(NEW.request,'$.merge') IS NOT 'object') OR EXISTS(SELECT 1 FROM "note_deletions" WHERE "note_id"=NEW."note_id"))
BEGIN SELECT RAISE(ABORT,'authored transform cannot complete outside its retained authority'); END;
--> statement-breakpoint
CREATE TRIGGER material_generation_publish BEFORE UPDATE OF status ON material_versions
WHEN NEW.status='published' AND NEW.creator='agent' AND NEW.operation='generate' AND NOT EXISTS(SELECT 1 FROM material_generation_requests r JOIN material_versions v ON v.generation_request_id=r.id JOIN materials m ON m.id=v.material_id
 WHERE v.id=NEW.id AND r.cancelled=0 AND v.kind IN ('diagram','quiz','flashcards') AND json_extract(r.payload,'$.kind')=v.kind
 AND ((json_type(r.payload,'$.autoTitle')='true' AND length(m.title) BETWEEN 1 AND 200 AND m.title=trim(m.title)) OR (coalesce(json_type(r.payload,'$.autoTitle'),'false')!='true' AND json_extract(r.payload,'$.title')=m.title)) AND json_extract(r.payload,'$.instruction') IS v.instruction
 AND EXISTS(SELECT 1 FROM project_materials p WHERE p.material_id=v.material_id AND p.project_id=r.project_id)
 AND json_array_length(r.payload,'$.inputs') BETWEEN 1 AND 20
 AND (SELECT COUNT(*) FROM material_evidence_inputs WHERE request_id=r.id)=json_array_length(r.payload,'$.inputs')
 AND NOT EXISTS(SELECT position,"page_version_id",source_id,source_revision,source_snapshot_id FROM material_evidence_inputs WHERE request_id=r.id
 EXCEPT SELECT position,"page_version_id",source_id,source_revision,source_snapshot_id FROM material_evidence_inputs WHERE version_id=v.id)
 AND NOT EXISTS(SELECT position,"page_version_id",source_id,source_revision,source_snapshot_id FROM material_evidence_inputs WHERE version_id=v.id
 EXCEPT SELECT position,"page_version_id",source_id,source_revision,source_snapshot_id FROM material_evidence_inputs WHERE request_id=r.id))
BEGIN SELECT RAISE(ABORT,'generated publication does not match exact request'); END;
--> statement-breakpoint
CREATE TRIGGER material_generation_receipt_valid BEFORE UPDATE OF result_version_id,result_hash ON material_generation_requests
WHEN OLD.result_version_id IS NULL AND NEW.result_version_id IS NOT NULL AND (length(NEW.result_hash)!=64 OR NEW.result_hash GLOB '*[^0-9a-f]*'
 OR NOT EXISTS(SELECT 1 FROM material_generation_requests r JOIN material_versions v ON v.generation_request_id=r.id JOIN materials m ON m.id=v.material_id
 WHERE v.id=NEW.result_version_id AND r.cancelled=0 AND v.kind IN ('diagram','quiz','flashcards') AND json_extract(r.payload,'$.kind')=v.kind
 AND ((json_type(r.payload,'$.autoTitle')='true' AND length(m.title) BETWEEN 1 AND 200 AND m.title=trim(m.title)) OR (coalesce(json_type(r.payload,'$.autoTitle'),'false')!='true' AND json_extract(r.payload,'$.title')=m.title)) AND json_extract(r.payload,'$.instruction') IS v.instruction
 AND EXISTS(SELECT 1 FROM project_materials p WHERE p.material_id=v.material_id AND p.project_id=r.project_id)
 AND json_array_length(r.payload,'$.inputs') BETWEEN 1 AND 20
 AND (SELECT COUNT(*) FROM material_evidence_inputs WHERE request_id=r.id)=json_array_length(r.payload,'$.inputs')
 AND NOT EXISTS(SELECT position,"page_version_id",source_id,source_revision,source_snapshot_id FROM material_evidence_inputs WHERE request_id=r.id
 EXCEPT SELECT position,"page_version_id",source_id,source_revision,source_snapshot_id FROM material_evidence_inputs WHERE version_id=v.id)
 AND NOT EXISTS(SELECT position,"page_version_id",source_id,source_revision,source_snapshot_id FROM material_evidence_inputs WHERE version_id=v.id
 EXCEPT SELECT position,"page_version_id",source_id,source_revision,source_snapshot_id FROM material_evidence_inputs WHERE request_id=r.id) AND r.id=NEW.id AND v.status='published'))
BEGIN SELECT RAISE(ABORT,'generated receipt does not match exact publication'); END;
--> statement-breakpoint
CREATE TRIGGER material_generation_auto_title_specification
BEFORE INSERT ON material_generation_requests
WHEN json_type(NEW.payload, '$.autoTitle') IS NOT NULL
  AND json_type(NEW.payload, '$.autoTitle') NOT IN ('true', 'false', 'null')
BEGIN SELECT RAISE(ABORT, 'invalid automatic generation title specification'); END;
--> statement-breakpoint
CREATE TRIGGER catalog_native_material_delete BEFORE DELETE ON materials BEGIN DELETE FROM catalog_fts WHERE kind='material' AND target_id=old.id; DELETE FROM catalog_fts WHERE kind='question' AND target_id IN (SELECT q.id FROM material_quiz_questions q JOIN material_versions v ON v.id=q.version_id WHERE v.material_id=old.id); END;
--> statement-breakpoint
CREATE TRIGGER catalog_native_material_update AFTER UPDATE OF title,archived_at ON materials WHEN NOT EXISTS(SELECT 1 FROM material_deletion_members WHERE material_id=NEW.id)
BEGIN
 DELETE FROM catalog_fts WHERE kind='material' AND target_id=new.id;
 DELETE FROM catalog_fts WHERE kind='question' AND target_id IN (SELECT q.id FROM material_quiz_questions q JOIN material_versions v ON v.id=q.version_id WHERE v.material_id=new.id);
 INSERT INTO catalog_fts SELECT m.title,'material',m.id,NULL FROM materials m WHERE m.id=new.id AND m.archived_at IS NULL AND EXISTS (SELECT 1 FROM material_versions v WHERE v.material_id=m.id AND v.status='published');
 INSERT INTO catalog_fts SELECT q.prompt,'question',q.id,NULL FROM materials m JOIN material_versions v ON v.material_id=m.id JOIN material_quiz_questions q ON q.version_id=v.id WHERE m.id=new.id AND m.archived_at IS NULL AND v.status='published' AND v.number=(SELECT max(h.number) FROM material_versions h WHERE h.material_id=m.id AND h.status='published');
END;
--> statement-breakpoint
CREATE TRIGGER catalog_native_question_delete BEFORE DELETE ON material_quiz_questions BEGIN DELETE FROM catalog_fts WHERE kind='question' AND target_id=old.id; END;
--> statement-breakpoint
CREATE TRIGGER catalog_native_version_delete AFTER DELETE ON material_versions WHEN NOT EXISTS(SELECT 1 FROM material_deletion_members WHERE material_id=OLD.material_id)
BEGIN
 DELETE FROM catalog_fts WHERE kind='material' AND target_id=old.material_id;
 DELETE FROM catalog_fts WHERE kind='question' AND target_id IN (SELECT q.id FROM material_quiz_questions q JOIN material_versions v ON v.id=q.version_id WHERE v.material_id=old.material_id);
 INSERT INTO catalog_fts SELECT m.title,'material',m.id,NULL FROM materials m WHERE m.id=old.material_id AND m.archived_at IS NULL AND EXISTS (SELECT 1 FROM material_versions v WHERE v.material_id=m.id AND v.status='published');
 INSERT INTO catalog_fts SELECT q.prompt,'question',q.id,NULL FROM materials m JOIN material_versions v ON v.material_id=m.id JOIN material_quiz_questions q ON q.version_id=v.id WHERE m.id=old.material_id AND m.archived_at IS NULL AND v.status='published' AND v.number=(SELECT max(h.number) FROM material_versions h WHERE h.material_id=m.id AND h.status='published');
END;
--> statement-breakpoint
CREATE TRIGGER catalog_native_version_insert AFTER INSERT ON material_versions WHEN NOT EXISTS(SELECT 1 FROM material_deletion_members WHERE material_id=NEW.material_id)
BEGIN
 DELETE FROM catalog_fts WHERE kind='material' AND target_id=new.material_id;
 DELETE FROM catalog_fts WHERE kind='question' AND target_id IN (SELECT q.id FROM material_quiz_questions q JOIN material_versions v ON v.id=q.version_id WHERE v.material_id=new.material_id);
 INSERT INTO catalog_fts SELECT m.title,'material',m.id,NULL FROM materials m WHERE m.id=new.material_id AND m.archived_at IS NULL AND EXISTS (SELECT 1 FROM material_versions v WHERE v.material_id=m.id AND v.status='published');
 INSERT INTO catalog_fts SELECT q.prompt,'question',q.id,NULL FROM materials m JOIN material_versions v ON v.material_id=m.id JOIN material_quiz_questions q ON q.version_id=v.id WHERE m.id=new.material_id AND m.archived_at IS NULL AND v.status='published' AND v.number=(SELECT max(h.number) FROM material_versions h WHERE h.material_id=m.id AND h.status='published');
END;
--> statement-breakpoint
CREATE TRIGGER catalog_native_version_update AFTER UPDATE OF status,number ON material_versions WHEN NOT EXISTS(SELECT 1 FROM material_deletion_members WHERE material_id=NEW.material_id)
BEGIN
 DELETE FROM catalog_fts WHERE kind='material' AND target_id=new.material_id;
 DELETE FROM catalog_fts WHERE kind='question' AND target_id IN (SELECT q.id FROM material_quiz_questions q JOIN material_versions v ON v.id=q.version_id WHERE v.material_id=new.material_id);
 INSERT INTO catalog_fts SELECT m.title,'material',m.id,NULL FROM materials m WHERE m.id=new.material_id AND m.archived_at IS NULL AND EXISTS (SELECT 1 FROM material_versions v WHERE v.material_id=m.id AND v.status='published');
 INSERT INTO catalog_fts SELECT q.prompt,'question',q.id,NULL FROM materials m JOIN material_versions v ON v.material_id=m.id JOIN material_quiz_questions q ON q.version_id=v.id WHERE m.id=new.material_id AND m.archived_at IS NULL AND v.status='published' AND v.number=(SELECT max(h.number) FROM material_versions h WHERE h.material_id=m.id AND h.status='published');
END;
--> statement-breakpoint
CREATE TRIGGER learning_practice_answer_immutable
BEFORE UPDATE OF answer ON material_quiz_responses
WHEN NEW.answer IS NOT OLD.answer AND EXISTS (
  SELECT 1 FROM learning_practice_slots p JOIN projects owner ON owner.id = p.project_id
  WHERE p.attempt_id = OLD.attempt_id AND p.status = 'answered'
)
BEGIN SELECT RAISE(ABORT, 'committed practice answers are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER learning_practice_slot_answer
BEFORE UPDATE OF status ON learning_practice_slots
WHEN NEW.status = 'answered' AND OLD.status != 'answered' AND NOT EXISTS (
  SELECT 1 FROM material_quiz_responses r WHERE r.attempt_id = NEW.attempt_id AND r.version_id = NEW.version_id
)
BEGIN SELECT RAISE(ABORT, 'practice answer requires a canonical response'); END;
--> statement-breakpoint
CREATE TRIGGER learning_practice_slot_publication
BEFORE UPDATE OF version_id,attempt_id,status ON learning_practice_slots
WHEN OLD.version_id IS NULL AND NEW.version_id IS NOT NULL AND (
  NEW.status != 'ready' OR NOT EXISTS (
    SELECT 1 FROM learning_practice_controls c JOIN material_generation_scopes g ON g.id = c.epoch AND g.project_id = c.project_id
    JOIN material_versions v ON v.id = NEW.version_id AND EXISTS(SELECT 1 FROM project_materials pm WHERE pm.material_id=v.material_id AND pm.project_id=c.project_id)
    JOIN material_generation_requests r ON r.id = NEW.id AND r.project_id = c.project_id AND r.result_version_id = v.id
    JOIN material_quiz_attempts a ON a.id = NEW.attempt_id AND a.version_id = v.id
    WHERE c.project_id = NEW.project_id AND c.epoch = NEW.epoch AND c.enabled = 1 AND g.enabled = 1
      AND v.status = 'published' AND v.kind = 'quiz' AND v.generation_request_id = NEW.id
      AND json_extract(r.payload, '$.scopeId') = NEW.epoch
      AND json_extract(r.payload, '$.questionSpec.count') = 1 AND json_extract(r.payload, '$.questionSpec.kind') = NEW.kind
      AND json_extract(r.payload, '$.inputs') = json(NEW.inputs)
      AND (SELECT COUNT(*) FROM material_quiz_questions q WHERE q.version_id = v.id) = 1
      AND NOT EXISTS (SELECT 1 FROM material_quiz_questions q WHERE q.version_id = v.id AND ((NEW.kind = 'open' AND q.kind != 'open') OR (NEW.kind = 'choice' AND q.kind NOT IN ('single_choice','multiple_choice'))))
  )
)
BEGIN SELECT RAISE(ABORT, 'practice publication does not match its slot'); END;
--> statement-breakpoint
CREATE TRIGGER material_attempt_complete_answers BEFORE UPDATE OF status ON material_quiz_attempts
WHEN new.status='completed' AND EXISTS(SELECT 1 FROM material_quiz_responses r WHERE r.attempt_id=new.id AND r.question_kind IN ('single_choice','multiple_choice','true_false') AND NOT EXISTS(SELECT 1 FROM material_quiz_selections s WHERE s.attempt_id=r.attempt_id AND s.question_id=r.question_id))
BEGIN SELECT RAISE(ABORT, 'choice responses require a selection before completion'); END;
--> statement-breakpoint
CREATE TRIGGER material_deletion_search AFTER INSERT ON material_deletion_members BEGIN DELETE FROM catalog_fts WHERE (kind='material' AND target_id=NEW.material_id) OR (kind='question' AND target_id IN(SELECT q.id FROM material_quiz_questions q JOIN material_versions v ON v.id=q.version_id WHERE v.material_id=NEW.material_id)); END;
--> statement-breakpoint
CREATE TRIGGER material_generation_question_publication
BEFORE UPDATE OF status ON material_versions
WHEN NEW.status = 'published' AND OLD.status != 'published' AND EXISTS (
  SELECT 1 FROM material_generation_requests r WHERE r.id = NEW.generation_request_id
    AND json_extract(r.payload, '$.questionSpec') IS NOT NULL AND (
      NEW.kind != 'quiz'
      OR (SELECT COUNT(*) FROM material_quiz_questions q WHERE q.version_id = NEW.id) != 1
      OR EXISTS (SELECT 1 FROM material_quiz_questions q WHERE q.version_id = NEW.id AND (
        (json_extract(r.payload, '$.questionSpec.kind') = 'open' AND q.kind != 'open')
        OR (json_extract(r.payload, '$.questionSpec.kind') = 'choice' AND q.kind NOT IN ('single_choice', 'multiple_choice'))
      ))
    )
)
BEGIN SELECT RAISE(ABORT, 'generated quiz does not match its captured question specification'); END;
--> statement-breakpoint
CREATE TRIGGER material_publish_quiz BEFORE UPDATE OF status ON material_versions
WHEN new.status='published' AND new.kind='quiz' AND (
      NOT EXISTS(SELECT 1 FROM material_quiz_questions WHERE version_id=new.id)
      OR EXISTS(SELECT 1 FROM material_quiz_questions q WHERE q.version_id=new.id AND (
        (q.kind='ordering' AND (SELECT count(*) FROM material_quiz_ordering_items i WHERE i.question_id=q.id) NOT BETWEEN 2 AND 10)
        OR (q.kind='true_false' AND ((SELECT count(*) FROM material_quiz_choices c WHERE c.question_id=q.id) != 2 OR NOT EXISTS(SELECT 1 FROM material_quiz_choices c WHERE c.question_id=q.id AND c.text='true') OR NOT EXISTS(SELECT 1 FROM material_quiz_choices c WHERE c.question_id=q.id AND c.text='false')))
        OR (q.kind IN ('open','fill_blank') AND NOT EXISTS(SELECT 1 FROM material_quiz_open_answers a WHERE a.question_id=q.id))
        OR (q.kind IN ('single_choice','multiple_choice','true_false') AND (
          (SELECT count(*) FROM material_quiz_choices c WHERE c.question_id=q.id) NOT BETWEEN 2 AND 100
          OR (q.kind IN ('single_choice','true_false') AND (SELECT count(*) FROM material_quiz_choices c WHERE c.question_id=q.id AND c.is_correct=1) != 1)
          OR (q.kind='multiple_choice' AND NOT EXISTS(SELECT 1 FROM material_quiz_choices c WHERE c.question_id=q.id AND c.is_correct=1))
        ))
      )))
BEGIN SELECT RAISE(ABORT, 'published quizzes require complete questions and correct answers'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_choices_delete_draft BEFORE DELETE ON material_quiz_choices
WHEN ((EXISTS(SELECT 1 FROM material_versions v WHERE v.id=(SELECT version_id FROM material_quiz_questions WHERE id=old.question_id) AND v.status='published')) AND NOT (EXISTS(SELECT 1 FROM material_deletion_members dm JOIN material_deletions d ON d.material_id=dm.deletion_id WHERE dm.material_id=(SELECT material_id FROM material_versions WHERE id=(SELECT version_id FROM material_quiz_questions WHERE id=OLD.question_id)) AND d.status IN ('pending','failed')))) AND NOT (EXISTS(SELECT 1 FROM material_history_members h JOIN material_history_prunes p ON p.operation_id=h.operation_id WHERE h.version_id=(SELECT version_id FROM material_quiz_questions WHERE id=OLD.question_id) AND p.status IN ('pending','failed')))
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_choices_insert_draft BEFORE INSERT ON material_quiz_choices
WHEN EXISTS(SELECT 1 FROM material_versions v WHERE v.id=(SELECT version_id FROM material_quiz_questions WHERE id=new.question_id) AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_choices_update_draft BEFORE UPDATE ON material_quiz_choices
WHEN EXISTS(SELECT 1 FROM material_versions v WHERE v.id=(SELECT version_id FROM material_quiz_questions WHERE id=old.question_id) AND v.status='published') OR EXISTS(SELECT 1 FROM material_versions v WHERE v.id=(SELECT version_id FROM material_quiz_questions WHERE id=new.question_id) AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_open_answers_delete_draft BEFORE DELETE ON material_quiz_open_answers
WHEN ((EXISTS(SELECT 1 FROM material_versions v WHERE v.id=(SELECT version_id FROM material_quiz_questions WHERE id=old.question_id) AND v.status='published')) AND NOT (EXISTS(SELECT 1 FROM material_deletion_members dm JOIN material_deletions d ON d.material_id=dm.deletion_id WHERE dm.material_id=(SELECT material_id FROM material_versions WHERE id=(SELECT version_id FROM material_quiz_questions WHERE id=OLD.question_id)) AND d.status IN ('pending','failed')))) AND NOT (EXISTS(SELECT 1 FROM material_history_members h JOIN material_history_prunes p ON p.operation_id=h.operation_id WHERE h.version_id=(SELECT version_id FROM material_quiz_questions WHERE id=OLD.question_id) AND p.status IN ('pending','failed')))
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_open_answers_insert_draft BEFORE INSERT ON material_quiz_open_answers
WHEN EXISTS(SELECT 1 FROM material_versions v WHERE v.id=(SELECT version_id FROM material_quiz_questions WHERE id=new.question_id) AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_open_answers_update_draft BEFORE UPDATE ON material_quiz_open_answers
WHEN EXISTS(SELECT 1 FROM material_versions v WHERE v.id=(SELECT version_id FROM material_quiz_questions WHERE id=old.question_id) AND v.status='published') OR EXISTS(SELECT 1 FROM material_versions v WHERE v.id=(SELECT version_id FROM material_quiz_questions WHERE id=new.question_id) AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_questions_delete_draft BEFORE DELETE ON material_quiz_questions
WHEN ((EXISTS(SELECT 1 FROM material_versions v WHERE v.id=old.version_id AND v.status='published')) AND NOT (EXISTS(SELECT 1 FROM material_deletion_members dm JOIN material_deletions d ON d.material_id=dm.deletion_id WHERE dm.material_id=(SELECT material_id FROM material_versions WHERE id=OLD.version_id) AND d.status IN ('pending','failed')))) AND NOT (EXISTS(SELECT 1 FROM material_history_members h JOIN material_history_prunes p ON p.operation_id=h.operation_id WHERE h.version_id=OLD.version_id AND p.status IN ('pending','failed')))
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_questions_deletion_insert BEFORE INSERT ON material_quiz_questions WHEN EXISTS(SELECT 1 FROM material_versions v JOIN material_deletion_members d ON d.material_id=v.material_id WHERE v.id=NEW.version_id) BEGIN SELECT RAISE(ABORT,'deleted Material cannot restore content'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_questions_history_insert BEFORE INSERT ON material_quiz_questions WHEN EXISTS(SELECT 1 FROM material_history_members WHERE version_id=NEW.version_id) BEGIN SELECT RAISE(ABORT,'pruned version cannot restore content'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_questions_history_update BEFORE UPDATE ON material_quiz_questions WHEN EXISTS(SELECT 1 FROM material_history_members WHERE version_id=NEW.version_id) BEGIN SELECT RAISE(ABORT,'pruned version cannot restore content'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_questions_insert_draft BEFORE INSERT ON material_quiz_questions
WHEN EXISTS(SELECT 1 FROM material_versions v WHERE v.id=new.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_questions_update_draft BEFORE UPDATE ON material_quiz_questions
WHEN EXISTS(SELECT 1 FROM material_versions v WHERE v.id=old.version_id AND v.status='published') OR EXISTS(SELECT 1 FROM material_versions v WHERE v.id=new.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_responses_completed_delete BEFORE DELETE ON material_quiz_responses
WHEN ((EXISTS(SELECT 1 FROM material_quiz_attempts a JOIN material_versions v ON v.id=a.version_id WHERE a.id=old.attempt_id AND a.status='completed')) AND NOT (EXISTS(SELECT 1 FROM material_deletion_members dm JOIN material_deletions d ON d.material_id=dm.deletion_id WHERE dm.material_id=(SELECT material_id FROM material_versions WHERE id=OLD.version_id) AND d.status IN ('pending','failed')))) AND NOT (EXISTS(SELECT 1 FROM material_history_members m JOIN material_history_prunes p ON p.operation_id=m.operation_id WHERE m.version_id=OLD.version_id AND p.status IN ('pending','failed')))
BEGIN SELECT RAISE(ABORT, 'completed quiz answers are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_responses_completed_insert BEFORE INSERT ON material_quiz_responses
WHEN EXISTS(SELECT 1 FROM material_quiz_attempts a JOIN material_versions v ON v.id=a.version_id WHERE a.id=new.attempt_id AND a.status='completed')
BEGIN SELECT RAISE(ABORT, 'completed quiz answers are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_responses_completed_update BEFORE UPDATE ON material_quiz_responses
WHEN (EXISTS(SELECT 1 FROM material_quiz_attempts WHERE id=OLD.attempt_id AND status='completed')
 OR EXISTS(SELECT 1 FROM material_quiz_attempts WHERE id=NEW.attempt_id AND status='completed'))
 AND NOT (
   OLD.question_kind IN ('open','fill_blank') AND OLD.score IS NULL AND NEW.score IS NOT NULL
   AND NEW.score BETWEEN 0 AND 1
   AND NEW.attempt_id IS OLD.attempt_id
   AND NEW.version_id IS OLD.version_id
   AND NEW.question_id IS OLD.question_id
   AND NEW.question_kind IS OLD.question_kind
   AND NEW.answer IS OLD.answer
 )
BEGIN SELECT RAISE(ABORT, 'completed quiz answers are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_selection_single_insert BEFORE INSERT ON material_quiz_selections
WHEN (SELECT question_kind FROM material_quiz_responses WHERE attempt_id=new.attempt_id AND question_id=new.question_id) IN ('single_choice','true_false')
          AND EXISTS(SELECT 1 FROM material_quiz_selections s WHERE s.attempt_id=new.attempt_id AND s.question_id=new.question_id )
BEGIN SELECT RAISE(ABORT, 'single choice answers may select exactly one choice'); END;
--> statement-breakpoint
CREATE TRIGGER material_selection_single_update BEFORE UPDATE ON material_quiz_selections
WHEN (SELECT question_kind FROM material_quiz_responses WHERE attempt_id=new.attempt_id AND question_id=new.question_id) IN ('single_choice','true_false')
          AND EXISTS(SELECT 1 FROM material_quiz_selections s WHERE s.attempt_id=new.attempt_id AND s.question_id=new.question_id AND (s.attempt_id != old.attempt_id OR s.question_id != old.question_id OR s.choice_id != old.choice_id))
BEGIN SELECT RAISE(ABORT, 'single choice answers may select exactly one choice'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_ordering_items_delete_draft BEFORE DELETE ON material_quiz_ordering_items
WHEN ((EXISTS(SELECT 1 FROM material_versions v WHERE v.id=(SELECT version_id FROM material_quiz_questions WHERE id=old.question_id) AND v.status='published')) AND NOT (EXISTS(SELECT 1 FROM material_deletion_members dm JOIN material_deletions d ON d.material_id=dm.deletion_id WHERE dm.material_id=(SELECT material_id FROM material_versions WHERE id=(SELECT version_id FROM material_quiz_questions WHERE id=OLD.question_id)) AND d.status IN ('pending','failed')))) AND NOT (EXISTS(SELECT 1 FROM material_history_members h JOIN material_history_prunes p ON p.operation_id=h.operation_id WHERE h.version_id=(SELECT version_id FROM material_quiz_questions WHERE id=OLD.question_id) AND p.status IN ('pending','failed')))
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_ordering_items_insert_draft BEFORE INSERT ON material_quiz_ordering_items
WHEN EXISTS(SELECT 1 FROM material_versions v WHERE v.id=(SELECT version_id FROM material_quiz_questions WHERE id=new.question_id) AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_ordering_items_update_draft BEFORE UPDATE ON material_quiz_ordering_items
WHEN EXISTS(SELECT 1 FROM material_versions v WHERE v.id=(SELECT version_id FROM material_quiz_questions WHERE id=old.question_id) AND v.status='published') OR EXISTS(SELECT 1 FROM material_versions v WHERE v.id=(SELECT version_id FROM material_quiz_questions WHERE id=new.question_id) AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_ordering_response_insert BEFORE INSERT ON material_quiz_responses
WHEN NEW.question_kind='ordering' AND (CASE WHEN json_valid(NEW.answer) THEN
  json_extract(NEW.answer,'$.type') IS NOT 'ordering'
  OR json_type(NEW.answer,'$.itemIds') IS NOT 'array'
  OR json_array_length(NEW.answer,'$.itemIds') != (SELECT count(*) FROM material_quiz_ordering_items WHERE question_id=NEW.question_id)
  OR (SELECT count(DISTINCT value) FROM json_each(NEW.answer,'$.itemIds')) != json_array_length(NEW.answer,'$.itemIds')
  OR EXISTS(SELECT 1 FROM json_each(NEW.answer,'$.itemIds') j WHERE j.type != 'text' OR NOT EXISTS(SELECT 1 FROM material_quiz_ordering_items i WHERE i.question_id=NEW.question_id AND CAST(i.id AS TEXT)=j.value))
  ELSE 1 END)
BEGIN SELECT RAISE(ABORT, 'invalid ordering permutation'); END;
--> statement-breakpoint
CREATE TRIGGER material_ordering_response_update BEFORE UPDATE ON material_quiz_responses
WHEN NEW.question_kind='ordering' AND (CASE WHEN json_valid(NEW.answer) THEN
  json_extract(NEW.answer,'$.type') IS NOT 'ordering'
  OR json_type(NEW.answer,'$.itemIds') IS NOT 'array'
  OR json_array_length(NEW.answer,'$.itemIds') != (SELECT count(*) FROM material_quiz_ordering_items WHERE question_id=NEW.question_id)
  OR (SELECT count(DISTINCT value) FROM json_each(NEW.answer,'$.itemIds')) != json_array_length(NEW.answer,'$.itemIds')
  OR EXISTS(SELECT 1 FROM json_each(NEW.answer,'$.itemIds') j WHERE j.type != 'text' OR NOT EXISTS(SELECT 1 FROM material_quiz_ordering_items i WHERE i.question_id=NEW.question_id AND CAST(i.id AS TEXT)=j.value))
  ELSE 1 END)
BEGIN SELECT RAISE(ABORT, 'invalid ordering permutation'); END;
--> statement-breakpoint
CREATE TRIGGER material_matching_pairs_insert BEFORE INSERT ON material_quiz_questions
WHEN NEW.kind='matching' AND (
  json_type(NEW.matching_pairs) != 'array'
  OR EXISTS(SELECT 1 FROM json_each(NEW.matching_pairs) p WHERE
    coalesce(json_type(p.value,'$.termId'),'') != 'text' OR length(json_extract(p.value,'$.termId')) != 36
    OR coalesce(json_type(p.value,'$.definitionId'),'') != 'text' OR length(json_extract(p.value,'$.definitionId')) != 36
    OR coalesce(json_type(p.value,'$.term'),'') != 'text' OR length(trim(json_extract(p.value,'$.term'))) = 0
    OR coalesce(json_type(p.value,'$.definition'),'') != 'text' OR length(trim(json_extract(p.value,'$.definition'))) = 0)
  OR (SELECT count(DISTINCT json_extract(value,'$.termId')) FROM json_each(NEW.matching_pairs)) != json_array_length(NEW.matching_pairs)
  OR (SELECT count(DISTINCT json_extract(value,'$.definitionId')) FROM json_each(NEW.matching_pairs)) != json_array_length(NEW.matching_pairs)
  OR (SELECT count(DISTINCT lower(trim(json_extract(value,'$.term')))) FROM json_each(NEW.matching_pairs)) != json_array_length(NEW.matching_pairs)
  OR (SELECT count(DISTINCT lower(trim(json_extract(value,'$.definition')))) FROM json_each(NEW.matching_pairs)) != json_array_length(NEW.matching_pairs)
  OR EXISTS(SELECT 1 FROM json_each(NEW.matching_pairs) t JOIN json_each(NEW.matching_pairs) d ON json_extract(t.value,'$.termId')=json_extract(d.value,'$.definitionId'))
)
BEGIN SELECT RAISE(ABORT, 'matching pairs require distinct identities, terms and definitions'); END;
--> statement-breakpoint
CREATE TRIGGER material_matching_answer_insert BEFORE INSERT ON material_quiz_responses
WHEN NEW.question_kind='matching' AND (
  NOT EXISTS(SELECT 1 FROM material_quiz_questions q WHERE q.id=NEW.question_id AND q.kind='matching' AND json_array_length(q.matching_pairs)=json_array_length(NEW.answer))
  OR json_type(NEW.answer) != 'array'
  OR (SELECT count(DISTINCT json_extract(value,'$.termId')) FROM json_each(NEW.answer)) != json_array_length(NEW.answer)
  OR (SELECT count(DISTINCT json_extract(value,'$.definitionId')) FROM json_each(NEW.answer)) != json_array_length(NEW.answer)
  OR EXISTS(SELECT 1 FROM json_each(NEW.answer) a WHERE
    NOT EXISTS(SELECT 1 FROM material_quiz_questions q, json_each(q.matching_pairs) p WHERE q.id=NEW.question_id AND json_extract(p.value,'$.termId')=json_extract(a.value,'$.termId'))
    OR NOT EXISTS(SELECT 1 FROM material_quiz_questions q, json_each(q.matching_pairs) p WHERE q.id=NEW.question_id AND json_extract(p.value,'$.definitionId')=json_extract(a.value,'$.definitionId')))
)
BEGIN SELECT RAISE(ABORT, 'matching answers require a complete question-owned permutation'); END;
--> statement-breakpoint
CREATE TRIGGER material_matching_order_insert BEFORE INSERT ON material_quiz_attempt_questions
WHEN (SELECT kind FROM material_quiz_questions WHERE id=NEW.question_id)='matching' AND (
  NEW.matching_order IS NULL OR NOT json_valid(NEW.matching_order)
  OR json_type(NEW.matching_order) != 'array'
  OR json_array_length(NEW.matching_order) != (SELECT json_array_length(matching_pairs) FROM material_quiz_questions WHERE id=NEW.question_id)
  OR (SELECT count(DISTINCT value) FROM json_each(NEW.matching_order)) != json_array_length(NEW.matching_order)
  OR EXISTS(SELECT 1 FROM json_each(NEW.matching_order) o WHERE NOT EXISTS(SELECT 1 FROM material_quiz_questions q, json_each(q.matching_pairs) p WHERE q.id=NEW.question_id AND json_extract(p.value,'$.definitionId')=o.value))
)
BEGIN SELECT RAISE(ABORT, 'matching attempt order must contain every definition exactly once'); END;
--> statement-breakpoint
CREATE TRIGGER material_matching_pairs_update BEFORE UPDATE ON material_quiz_questions
WHEN NEW.kind='matching' AND (
  json_type(NEW.matching_pairs) != 'array'
  OR EXISTS(SELECT 1 FROM json_each(NEW.matching_pairs) p WHERE
    coalesce(json_type(p.value,'$.termId'),'') != 'text' OR length(json_extract(p.value,'$.termId')) != 36
    OR coalesce(json_type(p.value,'$.definitionId'),'') != 'text' OR length(json_extract(p.value,'$.definitionId')) != 36
    OR coalesce(json_type(p.value,'$.term'),'') != 'text' OR length(trim(json_extract(p.value,'$.term'))) = 0
    OR coalesce(json_type(p.value,'$.definition'),'') != 'text' OR length(trim(json_extract(p.value,'$.definition'))) = 0)
  OR (SELECT count(DISTINCT json_extract(value,'$.termId')) FROM json_each(NEW.matching_pairs)) != json_array_length(NEW.matching_pairs)
  OR (SELECT count(DISTINCT json_extract(value,'$.definitionId')) FROM json_each(NEW.matching_pairs)) != json_array_length(NEW.matching_pairs)
  OR (SELECT count(DISTINCT lower(trim(json_extract(value,'$.term')))) FROM json_each(NEW.matching_pairs)) != json_array_length(NEW.matching_pairs)
  OR (SELECT count(DISTINCT lower(trim(json_extract(value,'$.definition')))) FROM json_each(NEW.matching_pairs)) != json_array_length(NEW.matching_pairs)
  OR EXISTS(SELECT 1 FROM json_each(NEW.matching_pairs) t JOIN json_each(NEW.matching_pairs) d ON json_extract(t.value,'$.termId')=json_extract(d.value,'$.definitionId'))
)
BEGIN SELECT RAISE(ABORT, 'matching pairs require distinct identities, terms and definitions'); END;
--> statement-breakpoint
CREATE TRIGGER material_matching_answer_update BEFORE UPDATE ON material_quiz_responses
WHEN NEW.question_kind='matching' AND (
  NOT EXISTS(SELECT 1 FROM material_quiz_questions q WHERE q.id=NEW.question_id AND q.kind='matching' AND json_array_length(q.matching_pairs)=json_array_length(NEW.answer))
  OR json_type(NEW.answer) != 'array'
  OR (SELECT count(DISTINCT json_extract(value,'$.termId')) FROM json_each(NEW.answer)) != json_array_length(NEW.answer)
  OR (SELECT count(DISTINCT json_extract(value,'$.definitionId')) FROM json_each(NEW.answer)) != json_array_length(NEW.answer)
  OR EXISTS(SELECT 1 FROM json_each(NEW.answer) a WHERE
    NOT EXISTS(SELECT 1 FROM material_quiz_questions q, json_each(q.matching_pairs) p WHERE q.id=NEW.question_id AND json_extract(p.value,'$.termId')=json_extract(a.value,'$.termId'))
    OR NOT EXISTS(SELECT 1 FROM material_quiz_questions q, json_each(q.matching_pairs) p WHERE q.id=NEW.question_id AND json_extract(p.value,'$.definitionId')=json_extract(a.value,'$.definitionId')))
)
BEGIN SELECT RAISE(ABORT, 'matching answers require a complete question-owned permutation'); END;
--> statement-breakpoint
CREATE TRIGGER material_matching_order_update BEFORE UPDATE ON material_quiz_attempt_questions
WHEN (SELECT kind FROM material_quiz_questions WHERE id=NEW.question_id)='matching' AND (
  NEW.matching_order IS NULL OR NOT json_valid(NEW.matching_order)
  OR json_type(NEW.matching_order) != 'array'
  OR json_array_length(NEW.matching_order) != (SELECT json_array_length(matching_pairs) FROM material_quiz_questions WHERE id=NEW.question_id)
  OR (SELECT count(DISTINCT value) FROM json_each(NEW.matching_order)) != json_array_length(NEW.matching_order)
  OR EXISTS(SELECT 1 FROM json_each(NEW.matching_order) o WHERE NOT EXISTS(SELECT 1 FROM material_quiz_questions q, json_each(q.matching_pairs) p WHERE q.id=NEW.question_id AND json_extract(p.value,'$.definitionId')=o.value))
)
BEGIN SELECT RAISE(ABORT, 'matching attempt order must contain every definition exactly once'); END;
--> statement-breakpoint
CREATE TRIGGER material_matching_order_immutable BEFORE UPDATE OF matching_order ON material_quiz_attempt_questions
WHEN OLD.matching_order IS NOT NULL AND NEW.matching_order IS NOT OLD.matching_order
BEGIN SELECT RAISE(ABORT, 'matching attempt definition order is immutable'); END;
