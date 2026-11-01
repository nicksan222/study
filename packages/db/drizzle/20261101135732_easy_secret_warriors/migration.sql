-- Suspend invariant and FTS triggers while Drizzle rebuilds referenced tables.
DROP TRIGGER IF EXISTS "catalog_project_delete";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "catalog_project_insert";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "catalog_project_update";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "catalog_session_delete";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "catalog_session_insert";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "catalog_session_update";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "catalog_source_delete";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "catalog_source_insert";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "catalog_source_update";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "chunks_fts_ad";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "chunks_fts_ai";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "chunks_fts_au";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_identity_update";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_versions_start_draft";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_versions_delete_frozen";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_file_versions_insert_draft";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_file_versions_update_draft";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_file_versions_delete_draft";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_audio_versions_insert_draft";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_audio_versions_update_draft";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_audio_versions_delete_draft";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_video_versions_insert_draft";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_video_versions_update_draft";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_video_versions_delete_draft";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_image_versions_insert_draft";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_image_versions_update_draft";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_image_versions_delete_draft";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_link_versions_insert_draft";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_link_versions_update_draft";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_link_versions_delete_draft";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_document_versions_insert_draft";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_document_versions_update_draft";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_document_versions_delete_draft";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_diagram_versions_insert_draft";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_diagram_versions_update_draft";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_diagram_versions_delete_draft";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_quiz_versions_insert_draft";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_quiz_versions_update_draft";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_quiz_versions_delete_draft";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_flashcard_versions_insert_draft";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_flashcard_versions_update_draft";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_flashcard_versions_delete_draft";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_quiz_questions_insert_draft";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_quiz_questions_update_draft";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_quiz_questions_delete_draft";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_quiz_choices_insert_draft";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_quiz_choices_update_draft";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_quiz_choices_delete_draft";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_quiz_open_answers_insert_draft";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_quiz_open_answers_update_draft";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_quiz_open_answers_delete_draft";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_flashcard_entries_insert_draft";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_flashcard_entries_update_draft";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_flashcard_entries_delete_draft";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_version_citations_insert_draft";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_version_citations_update_draft";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_version_citations_delete_draft";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_version_parents_insert_draft";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_version_parents_update_draft";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_version_parents_delete_draft";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_version_parents_target_insert";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_version_parents_target_update";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_version_inputs_insert_draft";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_version_inputs_update_draft";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_version_inputs_delete_draft";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_version_inputs_target_insert";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_version_inputs_target_update";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_versions_publish_payload";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_publish_document";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_publish_quiz";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_publish_flashcards";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "documents_material_insert";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "documents_material_update";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "documents_material_delete";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "blocks_material_insert";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "blocks_material_update";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "blocks_material_delete";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "sources_material_insert";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "sources_material_delete";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "source_blobs_material_insert";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "source_blobs_material_delete";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_card_identity_update";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_attempt_published";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_attempt_identity";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_attempt_delete";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_quiz_responses_completed_insert";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_quiz_responses_completed_update";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_quiz_responses_completed_delete";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_quiz_selections_completed_insert";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_quiz_selections_completed_update";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_quiz_selections_completed_delete";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_selection_single_insert";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_selection_single_update";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_attempt_complete_answers";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_review_published";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_review_update";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_review_delete";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_document_cleanup";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_file_source_owner_insert";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_file_source_owner_update";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_audio_source_owner_insert";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_audio_source_owner_update";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_video_source_owner_insert";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_video_source_owner_update";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_image_source_owner_insert";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_image_source_owner_update";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_link_source_owner_insert";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_link_source_owner_update";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_document_source_owner_insert";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_document_source_owner_update";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_document_source_reassignment";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_source_project_reassignment";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_document_canonical_shape";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "sources_material_update";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "source_blobs_material_update";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "source_snapshots_published_update";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_source_snapshots_published_delete";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "source_snapshots_published_delete";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_source_snapshots_published_insert";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_source_snapshots_match_insert";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_source_snapshots_match_update";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_source_snapshots_published_update";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_publish_file";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_publish_audio";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_publish_video";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_publish_image";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_publish_link";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_generation_result_immutable";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_versions_frozen";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_generation_intent_immutable";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_generation_intent_retained";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_generation_input_immutable";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_generation_input_retained";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_generation_input_captured";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_generation_intent_insert";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_generation_binding_immutable";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_generation_publish";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_generation_receipt_valid";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "conversation_recording_posts_immutable";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "conversation_recording_posts_retain";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "source_recording_imports_validate_insert";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "source_recording_imports_immutable";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "source_recording_imports_retain";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "recording_posts_validate_insert";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "recording_posts_immutable";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "recording_posts_result_valid";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "recording_posts_retain";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "recording_chunks_captured_insert";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "recording_chunks_captured_update";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "recording_chunks_captured_delete";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "source_recording_capture_frozen";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "source_recording_bytes_frozen";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "recordings_captured_update";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "source_recording_bytes_retained";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "message_fts_ad";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "message_fts_ai";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "message_fts_finish";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "conversation_recording_posts_validate_insert";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "catalog_native_material_update";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "catalog_native_version_insert";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "catalog_native_version_update";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "catalog_native_version_delete";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "catalog_native_question_delete";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "catalog_native_material_delete";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "message_parts_project_insert";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "message_parts_project_update";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "messages_attachment_project_update";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "sessions_attachment_project_update";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "sources_attachment_project_update";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_generation_scope_immutable";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_generation_scope_retained";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_generation_request_scope";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_generation_receipt_scope";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_generation_publication_scope";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_generation_question_specification";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_generation_question_publication";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "learning_practice_control_identity";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "learning_practice_control_retained";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "learning_practice_slot_capture";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "learning_practice_slot_immutable";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "learning_practice_slot_publication";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "learning_practice_slot_answer";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "learning_practice_slot_retained";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "learning_practice_answer_immutable";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "learning_practice_selection_insert";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "learning_practice_selection_update";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "learning_practice_selection_delete";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "learning_practice_retry_capture";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "learning_practice_retry_transition";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "learning_practice_failure_clear";
--> statement-breakpoint
CREATE TABLE `project_materials` (
	`project_id` integer NOT NULL,
	`material_id` integer NOT NULL,
	CONSTRAINT `project_materials_pk` PRIMARY KEY(`project_id`, `material_id`),
	CONSTRAINT `fk_project_materials_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_project_materials_material_id_materials_id_fk` FOREIGN KEY (`material_id`) REFERENCES `materials`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `project_sessions` (
	`project_id` integer NOT NULL,
	`session_id` integer NOT NULL,
	CONSTRAINT `project_sessions_pk` PRIMARY KEY(`project_id`, `session_id`),
	CONSTRAINT `fk_project_sessions_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_project_sessions_session_id_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;
--> statement-breakpoint
INSERT OR IGNORE INTO project_materials(project_id,material_id) SELECT project_id,id FROM materials;
--> statement-breakpoint
INSERT OR IGNORE INTO project_sessions(project_id,session_id) SELECT project_id,id FROM sessions;
--> statement-breakpoint
CREATE TABLE `__new_material_generation_inputs` (
	`request_id` text NOT NULL,
	`version_id` integer NOT NULL,
	`position` integer NOT NULL,
	CONSTRAINT `material_generation_inputs_pk` PRIMARY KEY(`request_id`, `version_id`),
	CONSTRAINT `fk_material_generation_inputs_request_id_material_generation_requests_id_fk` FOREIGN KEY (`request_id`) REFERENCES `material_generation_requests`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_material_generation_inputs_version_id_material_versions_id_fk` FOREIGN KEY (`version_id`) REFERENCES `material_versions`(`id`),
	CONSTRAINT "material_generation_inputs_position_check" CHECK("position" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_material_generation_inputs`(`request_id`, `version_id`, `position`) SELECT `request_id`, `version_id`, `position` FROM `material_generation_inputs`;
--> statement-breakpoint
DROP TABLE `material_generation_inputs`;
--> statement-breakpoint
ALTER TABLE `__new_material_generation_inputs` RENAME TO `material_generation_inputs`;
--> statement-breakpoint
PRAGMA foreign_keys=ON;
--> statement-breakpoint
PRAGMA foreign_keys=OFF;
--> statement-breakpoint
CREATE TABLE `__new_material_generation_requests` (
	`id` text PRIMARY KEY,
	`project_id` integer NOT NULL,
	`payload` text NOT NULL,
	`result_version_id` integer,
	`result_hash` text,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_material_generation_requests_result_version_id_material_versions_id_fk` FOREIGN KEY (`result_version_id`) REFERENCES `material_versions`(`id`),
	CONSTRAINT "material_generation_payload_check" CHECK(json_valid("payload")),
	CONSTRAINT "material_generation_result_pair_check" CHECK(("result_version_id" IS NULL) = ("result_hash" IS NULL))
);
--> statement-breakpoint
INSERT INTO `__new_material_generation_requests`(`id`, `project_id`, `payload`, `result_version_id`, `result_hash`, `created_at`) SELECT `id`, `project_id`, `payload`, `result_version_id`, `result_hash`, `created_at` FROM `material_generation_requests`;
--> statement-breakpoint
DROP TABLE `material_generation_requests`;
--> statement-breakpoint
ALTER TABLE `__new_material_generation_requests` RENAME TO `material_generation_requests`;
--> statement-breakpoint
PRAGMA foreign_keys=ON;
--> statement-breakpoint
PRAGMA foreign_keys=OFF;
--> statement-breakpoint
CREATE TABLE `__new_material_version_inputs` (
	`version_id` integer NOT NULL,
	`input_version_id` integer NOT NULL,
	CONSTRAINT `material_version_inputs_pk` PRIMARY KEY(`version_id`, `input_version_id`),
	CONSTRAINT `fk_material_version_inputs_version_id_material_versions_id_fk` FOREIGN KEY (`version_id`) REFERENCES `material_versions`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_material_version_inputs_input_version_id_material_versions_id_fk` FOREIGN KEY (`input_version_id`) REFERENCES `material_versions`(`id`) ON DELETE CASCADE,
	CONSTRAINT "material_version_inputs_distinct_check" CHECK(version_id != input_version_id)
);
--> statement-breakpoint
INSERT INTO `__new_material_version_inputs`(`version_id`, `input_version_id`) SELECT `version_id`, `input_version_id` FROM `material_version_inputs`;
--> statement-breakpoint
DROP TABLE `material_version_inputs`;
--> statement-breakpoint
ALTER TABLE `__new_material_version_inputs` RENAME TO `material_version_inputs`;
--> statement-breakpoint
PRAGMA foreign_keys=ON;
--> statement-breakpoint
PRAGMA foreign_keys=OFF;
--> statement-breakpoint
CREATE TABLE `__new_material_versions` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`material_id` integer NOT NULL,
	`kind` text NOT NULL,
	`number` integer NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`operation` text DEFAULT 'original' NOT NULL,
	`creator` text DEFAULT 'user' NOT NULL,
	`instruction` text,
	`generation_request_id` text,
	`language` text,
	`created_at` integer NOT NULL,
	`published_at` integer,
	CONSTRAINT `fk_material_versions_generation_request_id_material_generation_requests_id_fk` FOREIGN KEY (`generation_request_id`) REFERENCES `material_generation_requests`(`id`),
	CONSTRAINT `fk_material_versions_material_id_kind_materials_id_kind_fk` FOREIGN KEY (`material_id`,`kind`) REFERENCES `materials`(`id`,`kind`) ON DELETE CASCADE,
	CONSTRAINT "material_versions_identity_check" CHECK(id > 0 AND typeof(number) = 'integer' AND number > 0),
	CONSTRAINT "material_versions_status_check" CHECK(status IN ('draft','published') AND ((status = 'published') = (published_at IS NOT NULL))),
	CONSTRAINT "material_versions_operation_check" CHECK(operation IN ('original','edit','summarize','translate','generate','extract','transcribe')),
	CONSTRAINT "material_versions_creator_check" CHECK(creator IN ('user','agent','import')),
	CONSTRAINT "material_versions_language_check" CHECK(language IS NULL OR length(trim(language)) BETWEEN 1 AND 64),
	CONSTRAINT "material_versions_instruction_check" CHECK(instruction IS NULL OR length(trim(instruction)) BETWEEN 1 AND 100000),
	CONSTRAINT "material_versions_times_check" CHECK(typeof(created_at) = 'integer' AND created_at >= 0 AND (published_at IS NULL OR (typeof(published_at) = 'integer' AND published_at >= created_at)))
);
--> statement-breakpoint
INSERT INTO `__new_material_versions`(`id`, `material_id`, `kind`, `number`, `status`, `operation`, `creator`, `instruction`, `generation_request_id`, `language`, `created_at`, `published_at`) SELECT `id`, `material_id`, `kind`, `number`, `status`, `operation`, `creator`, `instruction`, `generation_request_id`, `language`, `created_at`, `published_at` FROM `material_versions`;
--> statement-breakpoint
DROP TABLE `material_versions`;
--> statement-breakpoint
ALTER TABLE `__new_material_versions` RENAME TO `material_versions`;
--> statement-breakpoint
PRAGMA foreign_keys=ON;
--> statement-breakpoint
PRAGMA foreign_keys=OFF;
--> statement-breakpoint
CREATE TABLE `__new_session_materials` (
	`session_id` integer NOT NULL,
	`material_id` integer NOT NULL,
	`position` integer NOT NULL,
	CONSTRAINT `session_materials_pk` PRIMARY KEY(`session_id`, `material_id`),
	CONSTRAINT `fk_session_materials_session_id_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_session_materials_material_id_materials_id_fk` FOREIGN KEY (`material_id`) REFERENCES `materials`(`id`) ON DELETE CASCADE,
	CONSTRAINT "session_materials_position_check" CHECK(typeof(position) = 'integer' AND position >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_session_materials`(`session_id`, `material_id`, `position`) SELECT `session_id`, `material_id`, `position` FROM `session_materials`;
--> statement-breakpoint
DROP TABLE `session_materials`;
--> statement-breakpoint
ALTER TABLE `__new_session_materials` RENAME TO `session_materials`;
--> statement-breakpoint
PRAGMA foreign_keys=ON;
--> statement-breakpoint
PRAGMA foreign_keys=OFF;
--> statement-breakpoint
CREATE TABLE `__new_sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`title` text NOT NULL,
	`context_revision` integer DEFAULT '0' NOT NULL,
	`title_source` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_sessions_title_source_codes_title_source_code_fk` FOREIGN KEY (`title_source`) REFERENCES `codes_title_source`(`code`),
	CONSTRAINT "sessions_check_1" CHECK(length(trim(title)) > 0 AND length(title) <= 200)
);
--> statement-breakpoint
INSERT INTO `__new_sessions`(`id`, `title`, `context_revision`, `title_source`, `created_at`, `updated_at`) SELECT `id`, `title`, `context_revision`, `title_source`, `created_at`, `updated_at` FROM `sessions`;
--> statement-breakpoint
DROP TABLE `sessions`;
--> statement-breakpoint
ALTER TABLE `__new_sessions` RENAME TO `sessions`;
--> statement-breakpoint
PRAGMA foreign_keys=ON;
--> statement-breakpoint
PRAGMA foreign_keys=OFF;
--> statement-breakpoint
CREATE TABLE `__new_materials` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`archived_at` integer,
	CONSTRAINT "materials_kind_check" CHECK(kind IN ('file','audio','video','image','link','document','diagram','quiz','flashcards')),
	CONSTRAINT "materials_title_check" CHECK(length(trim(title)) BETWEEN 1 AND 200),
	CONSTRAINT "materials_times_check" CHECK(id > 0 AND typeof(created_at) = 'integer' AND typeof(updated_at) = 'integer' AND created_at >= 0 AND updated_at >= created_at AND (archived_at IS NULL OR (typeof(archived_at) = 'integer' AND archived_at >= created_at)))
);
--> statement-breakpoint
INSERT INTO `__new_materials`(`id`, `kind`, `title`, `created_at`, `updated_at`, `archived_at`) SELECT `id`, `kind`, `title`, `created_at`, `updated_at`, `archived_at` FROM `materials`;
--> statement-breakpoint
DROP TABLE `materials`;
--> statement-breakpoint
ALTER TABLE `__new_materials` RENAME TO `materials`;
--> statement-breakpoint
PRAGMA foreign_keys=ON;
--> statement-breakpoint
PRAGMA foreign_keys=OFF;
--> statement-breakpoint
CREATE TABLE `__new_source_recording_imports` (
	`request_id` text PRIMARY KEY,
	`project_id` integer,
	`session_id` integer NOT NULL,
	`source_id` integer NOT NULL,
	`input_hash` blob NOT NULL,
	`duration_ms` integer NOT NULL,
	CONSTRAINT `fk_source_recording_imports_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE SET NULL,
	CONSTRAINT "source_recording_imports_request_check" CHECK(length(request_id) > 0),
	CONSTRAINT "source_recording_imports_hash_check" CHECK(length(input_hash) = 32),
	CONSTRAINT "source_recording_imports_duration_check" CHECK(duration_ms >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_source_recording_imports`(`request_id`, `project_id`, `session_id`, `source_id`, `input_hash`, `duration_ms`) SELECT `request_id`, `project_id`, `session_id`, `source_id`, `input_hash`, `duration_ms` FROM `source_recording_imports`;
--> statement-breakpoint
DROP TABLE `source_recording_imports`;
--> statement-breakpoint
ALTER TABLE `__new_source_recording_imports` RENAME TO `source_recording_imports`;
--> statement-breakpoint
PRAGMA foreign_keys=ON;
--> statement-breakpoint
PRAGMA foreign_keys=OFF;
--> statement-breakpoint
CREATE TABLE `__new_recording_posts` (
	`request_id` text PRIMARY KEY,
	`recording_id` integer NOT NULL,
	`session_id` integer NOT NULL,
	`project_id` integer,
	`name` text NOT NULL,
	`wav` blob NOT NULL,
	`duration_ms` integer NOT NULL,
	`source_id` integer,
	`message_id` integer,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_recording_posts_recording_id_recordings_id_fk` FOREIGN KEY (`recording_id`) REFERENCES `recordings`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_recording_posts_session_id_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_recording_posts_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE SET NULL,
	CONSTRAINT "recording_posts_request_check" CHECK(length(trim("request_id")) > 0),
	CONSTRAINT "recording_posts_name_check" CHECK(length(trim("name")) BETWEEN 1 AND 255),
	CONSTRAINT "recording_posts_wav_check" CHECK(length("wav") BETWEEN 46 AND 115200044),
	CONSTRAINT "recording_posts_duration_check" CHECK("duration_ms" BETWEEN 0 AND 3600000),
	CONSTRAINT "recording_posts_result_pair_check" CHECK(("source_id" IS NULL) = ("message_id" IS NULL))
);
--> statement-breakpoint
INSERT INTO `__new_recording_posts`(`request_id`, `recording_id`, `session_id`, `project_id`, `name`, `wav`, `duration_ms`, `source_id`, `message_id`, `created_at`) SELECT `request_id`, `recording_id`, `session_id`, `project_id`, `name`, `wav`, `duration_ms`, `source_id`, `message_id`, `created_at` FROM `recording_posts`;
--> statement-breakpoint
DROP TABLE `recording_posts`;
--> statement-breakpoint
ALTER TABLE `__new_recording_posts` RENAME TO `recording_posts`;
--> statement-breakpoint
PRAGMA foreign_keys=ON;
--> statement-breakpoint
PRAGMA foreign_keys=OFF;
--> statement-breakpoint
CREATE TABLE `__new_sources` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`project_id` integer,
	`origin` text NOT NULL,
	`kind` text NOT NULL,
	`mime` text NOT NULL,
	`name` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`sha256` blob NOT NULL,
	`uri` text,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_sources_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_sources_origin_codes_source_origin_code_fk` FOREIGN KEY (`origin`) REFERENCES `codes_source_origin`(`code`),
	CONSTRAINT `fk_sources_kind_codes_source_kind_code_fk` FOREIGN KEY (`kind`) REFERENCES `codes_source_kind`(`code`),
	CONSTRAINT "sources_check_1" CHECK(length(mime) > 0),
	CONSTRAINT "sources_check_2" CHECK(length(trim(name)) > 0),
	CONSTRAINT "sources_check_3" CHECK(size_bytes BETWEEN 1 AND 536870912),
	CONSTRAINT "sources_check_4" CHECK(length(sha256) = 32),
	CONSTRAINT "sources_check_5" CHECK(uri IS NULL OR length(uri) > 0)
);
--> statement-breakpoint
INSERT INTO `__new_sources`(`id`, `project_id`, `origin`, `kind`, `mime`, `name`, `size_bytes`, `sha256`, `uri`, `created_at`) SELECT `id`, `project_id`, `origin`, `kind`, `mime`, `name`, `size_bytes`, `sha256`, `uri`, `created_at` FROM `sources`;
--> statement-breakpoint
DROP TABLE `sources`;
--> statement-breakpoint
ALTER TABLE `__new_sources` RENAME TO `sources`;
--> statement-breakpoint
PRAGMA foreign_keys=ON;
--> statement-breakpoint
DROP INDEX IF EXISTS `sessions_project_idx`;
--> statement-breakpoint
DROP INDEX IF EXISTS `sessions_id_project_unique`;
--> statement-breakpoint
DROP INDEX IF EXISTS `material_version_inputs_project_idx`;
--> statement-breakpoint
DROP INDEX IF EXISTS `material_versions_id_project_unique`;
--> statement-breakpoint
DROP INDEX IF EXISTS `material_versions_project_idx`;
--> statement-breakpoint
DROP INDEX IF EXISTS `materials_id_project_kind_unique`;
--> statement-breakpoint
DROP INDEX IF EXISTS `materials_id_project_unique`;
--> statement-breakpoint
DROP INDEX IF EXISTS `materials_project_updated_idx`;
--> statement-breakpoint
DROP INDEX IF EXISTS `session_materials_project_idx`;
--> statement-breakpoint
CREATE UNIQUE INDEX `material_generation_inputs_position_unique` ON `material_generation_inputs` (`request_id`,`position`);
--> statement-breakpoint
CREATE UNIQUE INDEX `material_generation_requests_id_project_unique` ON `material_generation_requests` (`id`,`project_id`);
--> statement-breakpoint
CREATE INDEX `material_version_inputs_input_idx` ON `material_version_inputs` (`input_version_id`,`version_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `material_versions_generation_request_unique` ON `material_versions` (`generation_request_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `material_versions_number_unique` ON `material_versions` (`material_id`,`number`);
--> statement-breakpoint
CREATE UNIQUE INDEX `material_versions_id_kind_unique` ON `material_versions` (`id`,`kind`);
--> statement-breakpoint
CREATE UNIQUE INDEX `material_versions_id_material_kind_unique` ON `material_versions` (`id`,`material_id`,`kind`);
--> statement-breakpoint
CREATE UNIQUE INDEX `material_versions_id_material_unique` ON `material_versions` (`id`,`material_id`);
--> statement-breakpoint
CREATE INDEX `material_versions_heads_idx` ON `material_versions` (`material_id`,`status`,"number" desc);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_materials_position_unique` ON `session_materials` (`session_id`,`position`);
--> statement-breakpoint
CREATE INDEX `session_materials_material_idx` ON `session_materials` (`material_id`,`session_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `materials_id_kind_unique` ON `materials` (`id`,`kind`);
--> statement-breakpoint
CREATE UNIQUE INDEX `recording_posts_recording_unique` ON `recording_posts` (`recording_id`);
--> statement-breakpoint
CREATE INDEX `sources_sha256_idx` ON `sources` (`sha256`);
--> statement-breakpoint
CREATE INDEX `sources_project_idx` ON `sources` (`project_id`);
--> statement-breakpoint
CREATE INDEX `project_materials_material_idx` ON `project_materials` (`material_id`);
--> statement-breakpoint
CREATE INDEX `project_sessions_session_idx` ON `project_sessions` (`session_id`);
--> statement-breakpoint
-- Restore content invariants independently of collection ownership.
CREATE TRIGGER catalog_project_delete AFTER DELETE ON projects BEGIN DELETE FROM catalog_fts WHERE kind='project' AND target_id=old.id; END;
--> statement-breakpoint
CREATE TRIGGER catalog_project_insert AFTER INSERT ON projects BEGIN INSERT INTO catalog_fts VALUES(new.name, 'project', new.id, new.id); END;
--> statement-breakpoint
CREATE TRIGGER catalog_project_update AFTER UPDATE OF name ON projects BEGIN DELETE FROM catalog_fts WHERE kind='project' AND target_id=old.id; INSERT INTO catalog_fts VALUES(new.name, 'project', new.id, new.id); END;
--> statement-breakpoint
CREATE TRIGGER catalog_session_delete AFTER DELETE ON sessions BEGIN
    DELETE FROM catalog_fts WHERE kind = 'session' AND target_id = old.id;
END;
--> statement-breakpoint
CREATE TRIGGER catalog_session_insert AFTER INSERT ON sessions BEGIN
    INSERT INTO catalog_fts VALUES (new.title, 'session', new.id, NULL);
END;
--> statement-breakpoint
CREATE TRIGGER catalog_session_update AFTER UPDATE OF title ON sessions BEGIN
    DELETE FROM catalog_fts WHERE kind = 'session' AND target_id = old.id;
    INSERT INTO catalog_fts VALUES (new.title, 'session', new.id, NULL);
END;
--> statement-breakpoint
CREATE TRIGGER catalog_source_delete AFTER DELETE ON sources BEGIN DELETE FROM catalog_fts WHERE kind='source' AND target_id=old.id; END;
--> statement-breakpoint
CREATE TRIGGER catalog_source_insert AFTER INSERT ON sources BEGIN INSERT INTO catalog_fts VALUES(new.name, 'source', new.id, new.project_id); END;
--> statement-breakpoint
CREATE TRIGGER catalog_source_update AFTER UPDATE OF name,project_id ON sources BEGIN DELETE FROM catalog_fts WHERE kind='source' AND target_id=old.id; INSERT INTO catalog_fts VALUES(new.name, 'source', new.id, new.project_id); END;
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
CREATE TRIGGER material_identity_update BEFORE UPDATE ON materials
WHEN new.id IS NOT old.id OR new.kind IS NOT old.kind
BEGIN SELECT RAISE(ABORT, 'material ownership and kind are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_versions_start_draft BEFORE INSERT ON material_versions
WHEN new.status != 'draft'
BEGIN SELECT RAISE(ABORT, 'material versions must start as drafts'); END;
--> statement-breakpoint
CREATE TRIGGER material_versions_delete_frozen BEFORE DELETE ON material_versions
WHEN EXISTS(SELECT 1 FROM material_versions v WHERE v.id=old.id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published versions cannot be deleted'); END;
--> statement-breakpoint
CREATE TRIGGER material_file_versions_insert_draft BEFORE INSERT ON material_file_versions
WHEN EXISTS(SELECT 1 FROM material_versions v WHERE v.id=new.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_file_versions_update_draft BEFORE UPDATE ON material_file_versions
WHEN EXISTS(SELECT 1 FROM material_versions v WHERE v.id=old.version_id AND v.status='published') OR EXISTS(SELECT 1 FROM material_versions v WHERE v.id=new.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_file_versions_delete_draft BEFORE DELETE ON material_file_versions
WHEN EXISTS(SELECT 1 FROM material_versions v WHERE v.id=old.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_audio_versions_insert_draft BEFORE INSERT ON material_audio_versions
WHEN EXISTS(SELECT 1 FROM material_versions v WHERE v.id=new.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_audio_versions_update_draft BEFORE UPDATE ON material_audio_versions
WHEN EXISTS(SELECT 1 FROM material_versions v WHERE v.id=old.version_id AND v.status='published') OR EXISTS(SELECT 1 FROM material_versions v WHERE v.id=new.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_audio_versions_delete_draft BEFORE DELETE ON material_audio_versions
WHEN EXISTS(SELECT 1 FROM material_versions v WHERE v.id=old.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_video_versions_insert_draft BEFORE INSERT ON material_video_versions
WHEN EXISTS(SELECT 1 FROM material_versions v WHERE v.id=new.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_video_versions_update_draft BEFORE UPDATE ON material_video_versions
WHEN EXISTS(SELECT 1 FROM material_versions v WHERE v.id=old.version_id AND v.status='published') OR EXISTS(SELECT 1 FROM material_versions v WHERE v.id=new.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_video_versions_delete_draft BEFORE DELETE ON material_video_versions
WHEN EXISTS(SELECT 1 FROM material_versions v WHERE v.id=old.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_image_versions_insert_draft BEFORE INSERT ON material_image_versions
WHEN EXISTS(SELECT 1 FROM material_versions v WHERE v.id=new.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_image_versions_update_draft BEFORE UPDATE ON material_image_versions
WHEN EXISTS(SELECT 1 FROM material_versions v WHERE v.id=old.version_id AND v.status='published') OR EXISTS(SELECT 1 FROM material_versions v WHERE v.id=new.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_image_versions_delete_draft BEFORE DELETE ON material_image_versions
WHEN EXISTS(SELECT 1 FROM material_versions v WHERE v.id=old.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_link_versions_insert_draft BEFORE INSERT ON material_link_versions
WHEN EXISTS(SELECT 1 FROM material_versions v WHERE v.id=new.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_link_versions_update_draft BEFORE UPDATE ON material_link_versions
WHEN EXISTS(SELECT 1 FROM material_versions v WHERE v.id=old.version_id AND v.status='published') OR EXISTS(SELECT 1 FROM material_versions v WHERE v.id=new.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_link_versions_delete_draft BEFORE DELETE ON material_link_versions
WHEN EXISTS(SELECT 1 FROM material_versions v WHERE v.id=old.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_document_versions_insert_draft BEFORE INSERT ON material_document_versions
WHEN EXISTS(SELECT 1 FROM material_versions v WHERE v.id=new.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_document_versions_update_draft BEFORE UPDATE ON material_document_versions
WHEN EXISTS(SELECT 1 FROM material_versions v WHERE v.id=old.version_id AND v.status='published') OR EXISTS(SELECT 1 FROM material_versions v WHERE v.id=new.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_document_versions_delete_draft BEFORE DELETE ON material_document_versions
WHEN EXISTS(SELECT 1 FROM material_versions v WHERE v.id=old.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_diagram_versions_insert_draft BEFORE INSERT ON material_diagram_versions
WHEN EXISTS(SELECT 1 FROM material_versions v WHERE v.id=new.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_diagram_versions_update_draft BEFORE UPDATE ON material_diagram_versions
WHEN EXISTS(SELECT 1 FROM material_versions v WHERE v.id=old.version_id AND v.status='published') OR EXISTS(SELECT 1 FROM material_versions v WHERE v.id=new.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_diagram_versions_delete_draft BEFORE DELETE ON material_diagram_versions
WHEN EXISTS(SELECT 1 FROM material_versions v WHERE v.id=old.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_versions_insert_draft BEFORE INSERT ON material_quiz_versions
WHEN EXISTS(SELECT 1 FROM material_versions v WHERE v.id=new.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_versions_update_draft BEFORE UPDATE ON material_quiz_versions
WHEN EXISTS(SELECT 1 FROM material_versions v WHERE v.id=old.version_id AND v.status='published') OR EXISTS(SELECT 1 FROM material_versions v WHERE v.id=new.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_versions_delete_draft BEFORE DELETE ON material_quiz_versions
WHEN EXISTS(SELECT 1 FROM material_versions v WHERE v.id=old.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_flashcard_versions_insert_draft BEFORE INSERT ON material_flashcard_versions
WHEN EXISTS(SELECT 1 FROM material_versions v WHERE v.id=new.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_flashcard_versions_update_draft BEFORE UPDATE ON material_flashcard_versions
WHEN EXISTS(SELECT 1 FROM material_versions v WHERE v.id=old.version_id AND v.status='published') OR EXISTS(SELECT 1 FROM material_versions v WHERE v.id=new.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_flashcard_versions_delete_draft BEFORE DELETE ON material_flashcard_versions
WHEN EXISTS(SELECT 1 FROM material_versions v WHERE v.id=old.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_questions_insert_draft BEFORE INSERT ON material_quiz_questions
WHEN EXISTS(SELECT 1 FROM material_versions v WHERE v.id=new.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_questions_update_draft BEFORE UPDATE ON material_quiz_questions
WHEN EXISTS(SELECT 1 FROM material_versions v WHERE v.id=old.version_id AND v.status='published') OR EXISTS(SELECT 1 FROM material_versions v WHERE v.id=new.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_questions_delete_draft BEFORE DELETE ON material_quiz_questions
WHEN EXISTS(SELECT 1 FROM material_versions v WHERE v.id=old.version_id AND v.status='published')
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
CREATE TRIGGER material_quiz_choices_delete_draft BEFORE DELETE ON material_quiz_choices
WHEN EXISTS(SELECT 1 FROM material_versions v WHERE v.id=(SELECT version_id FROM material_quiz_questions WHERE id=old.question_id) AND v.status='published')
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
CREATE TRIGGER material_quiz_open_answers_delete_draft BEFORE DELETE ON material_quiz_open_answers
WHEN EXISTS(SELECT 1 FROM material_versions v WHERE v.id=(SELECT version_id FROM material_quiz_questions WHERE id=old.question_id) AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_flashcard_entries_insert_draft BEFORE INSERT ON material_flashcard_entries
WHEN EXISTS(SELECT 1 FROM material_versions v WHERE v.id=new.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_flashcard_entries_update_draft BEFORE UPDATE ON material_flashcard_entries
WHEN EXISTS(SELECT 1 FROM material_versions v WHERE v.id=old.version_id AND v.status='published') OR EXISTS(SELECT 1 FROM material_versions v WHERE v.id=new.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_flashcard_entries_delete_draft BEFORE DELETE ON material_flashcard_entries
WHEN EXISTS(SELECT 1 FROM material_versions v WHERE v.id=old.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_version_citations_insert_draft BEFORE INSERT ON material_version_citations
WHEN EXISTS(SELECT 1 FROM material_versions v WHERE v.id=new.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_version_citations_update_draft BEFORE UPDATE ON material_version_citations
WHEN EXISTS(SELECT 1 FROM material_versions v WHERE v.id=old.version_id AND v.status='published') OR EXISTS(SELECT 1 FROM material_versions v WHERE v.id=new.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_version_citations_delete_draft BEFORE DELETE ON material_version_citations
WHEN EXISTS(SELECT 1 FROM material_versions v WHERE v.id=old.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_version_parents_insert_draft BEFORE INSERT ON material_version_parents
WHEN EXISTS(SELECT 1 FROM material_versions v WHERE v.id=new.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_version_parents_update_draft BEFORE UPDATE ON material_version_parents
WHEN EXISTS(SELECT 1 FROM material_versions v WHERE v.id=old.version_id AND v.status='published') OR EXISTS(SELECT 1 FROM material_versions v WHERE v.id=new.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_version_parents_delete_draft BEFORE DELETE ON material_version_parents
WHEN EXISTS(SELECT 1 FROM material_versions v WHERE v.id=old.version_id AND v.status='published')
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
CREATE TRIGGER material_version_inputs_insert_draft BEFORE INSERT ON material_version_inputs
WHEN EXISTS(SELECT 1 FROM material_versions v WHERE v.id=new.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_version_inputs_update_draft BEFORE UPDATE ON material_version_inputs
WHEN EXISTS(SELECT 1 FROM material_versions v WHERE v.id=old.version_id AND v.status='published') OR EXISTS(SELECT 1 FROM material_versions v WHERE v.id=new.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_version_inputs_delete_draft BEFORE DELETE ON material_version_inputs
WHEN EXISTS(SELECT 1 FROM material_versions v WHERE v.id=old.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_version_inputs_target_insert BEFORE INSERT ON material_version_inputs
WHEN NOT EXISTS(SELECT 1 FROM material_versions v WHERE v.id=new.input_version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'version dependencies must already be published'); END;
--> statement-breakpoint
CREATE TRIGGER material_version_inputs_target_update BEFORE UPDATE ON material_version_inputs
WHEN NOT EXISTS(SELECT 1 FROM material_versions v WHERE v.id=new.input_version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'version dependencies must already be published'); END;
--> statement-breakpoint
CREATE TRIGGER material_versions_publish_payload BEFORE UPDATE OF status ON material_versions
WHEN new.status='published' AND (CASE new.kind WHEN 'file' THEN NOT EXISTS(SELECT 1 FROM material_file_versions WHERE version_id=new.id) WHEN 'audio' THEN NOT EXISTS(SELECT 1 FROM material_audio_versions WHERE version_id=new.id) WHEN 'video' THEN NOT EXISTS(SELECT 1 FROM material_video_versions WHERE version_id=new.id) WHEN 'image' THEN NOT EXISTS(SELECT 1 FROM material_image_versions WHERE version_id=new.id) WHEN 'link' THEN NOT EXISTS(SELECT 1 FROM material_link_versions WHERE version_id=new.id) WHEN 'document' THEN NOT EXISTS(SELECT 1 FROM material_document_versions WHERE version_id=new.id) WHEN 'diagram' THEN NOT EXISTS(SELECT 1 FROM material_diagram_versions WHERE version_id=new.id) WHEN 'quiz' THEN NOT EXISTS(SELECT 1 FROM material_quiz_versions WHERE version_id=new.id) WHEN 'flashcards' THEN NOT EXISTS(SELECT 1 FROM material_flashcard_versions WHERE version_id=new.id) ELSE 1 END)
BEGIN SELECT RAISE(ABORT, 'a published material requires its typed payload'); END;
--> statement-breakpoint
CREATE TRIGGER material_publish_document BEFORE UPDATE OF status ON material_versions
WHEN new.status='published' AND new.kind='document' AND (
      NOT EXISTS(SELECT 1 FROM material_document_versions c JOIN blocks b ON b.document_id=c.document_id WHERE c.version_id=new.id AND length(trim(b.text)) > 0))
BEGIN SELECT RAISE(ABORT, 'published documents require content '); END;
--> statement-breakpoint
CREATE TRIGGER material_publish_quiz BEFORE UPDATE OF status ON material_versions
WHEN new.status='published' AND new.kind='quiz' AND (
      NOT EXISTS(SELECT 1 FROM material_quiz_questions WHERE version_id=new.id)
      OR EXISTS(SELECT 1 FROM material_quiz_questions q WHERE q.version_id=new.id AND (
        (q.kind='open' AND NOT EXISTS(SELECT 1 FROM material_quiz_open_answers a WHERE a.question_id=q.id))
        OR (q.kind IN ('single_choice','multiple_choice') AND (
          (SELECT count(*) FROM material_quiz_choices c WHERE c.question_id=q.id) NOT BETWEEN 2 AND 100
          OR (q.kind='single_choice' AND (SELECT count(*) FROM material_quiz_choices c WHERE c.question_id=q.id AND c.is_correct=1) != 1)
          OR (q.kind='multiple_choice' AND NOT EXISTS(SELECT 1 FROM material_quiz_choices c WHERE c.question_id=q.id AND c.is_correct=1))
        ))
      )))
BEGIN SELECT RAISE(ABORT, 'published quizzes require complete questions and correct answers'); END;
--> statement-breakpoint
CREATE TRIGGER material_publish_flashcards BEFORE UPDATE OF status ON material_versions
WHEN new.status='published' AND new.kind='flashcards' AND NOT EXISTS(SELECT 1 FROM material_flashcard_entries WHERE version_id=new.id)
BEGIN SELECT RAISE(ABORT, 'published flashcards require at least one card'); END;
--> statement-breakpoint
CREATE TRIGGER documents_material_insert BEFORE INSERT ON documents
WHEN EXISTS(SELECT 1 FROM material_document_versions c JOIN material_versions v ON v.id=c.version_id WHERE c.document_id=new.id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published document content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER documents_material_update BEFORE UPDATE ON documents
WHEN EXISTS(SELECT 1 FROM material_document_versions c JOIN material_versions v ON v.id=c.version_id WHERE c.document_id=old.id AND v.status='published') OR EXISTS(SELECT 1 FROM material_document_versions c JOIN material_versions v ON v.id=c.version_id WHERE c.document_id=new.id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published document content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER documents_material_delete BEFORE DELETE ON documents
WHEN EXISTS(SELECT 1 FROM material_document_versions c JOIN material_versions v ON v.id=c.version_id WHERE c.document_id=old.id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published document content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER blocks_material_insert BEFORE INSERT ON blocks
WHEN EXISTS(SELECT 1 FROM material_document_versions c JOIN material_versions v ON v.id=c.version_id WHERE c.document_id=new.document_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published document content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER blocks_material_update BEFORE UPDATE ON blocks
WHEN EXISTS(SELECT 1 FROM material_document_versions c JOIN material_versions v ON v.id=c.version_id WHERE c.document_id=old.document_id AND v.status='published') OR EXISTS(SELECT 1 FROM material_document_versions c JOIN material_versions v ON v.id=c.version_id WHERE c.document_id=new.document_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published document content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER blocks_material_delete BEFORE DELETE ON blocks
WHEN EXISTS(SELECT 1 FROM material_document_versions c JOIN material_versions v ON v.id=c.version_id WHERE c.document_id=old.document_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published document content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER sources_material_insert BEFORE INSERT ON sources
WHEN (EXISTS(SELECT 1 FROM material_file_versions c JOIN material_versions v ON v.id=c.version_id WHERE c.source_id=new.id AND v.status='published') OR EXISTS(SELECT 1 FROM material_audio_versions c JOIN material_versions v ON v.id=c.version_id WHERE c.source_id=new.id AND v.status='published') OR EXISTS(SELECT 1 FROM material_video_versions c JOIN material_versions v ON v.id=c.version_id WHERE c.source_id=new.id AND v.status='published') OR EXISTS(SELECT 1 FROM material_image_versions c JOIN material_versions v ON v.id=c.version_id WHERE c.source_id=new.id AND v.status='published') OR EXISTS(SELECT 1 FROM material_link_versions c JOIN material_versions v ON v.id=c.version_id WHERE c.source_id=new.id AND v.status='published') OR EXISTS(SELECT 1 FROM documents d JOIN material_document_versions c ON c.document_id=d.id JOIN material_versions v ON v.id=c.version_id WHERE d.source_id=new.id AND v.status='published'))
BEGIN SELECT RAISE(ABORT, 'published source content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER sources_material_delete BEFORE DELETE ON sources
WHEN (EXISTS(SELECT 1 FROM material_file_versions c JOIN material_versions v ON v.id=c.version_id WHERE c.source_id=old.id AND v.status='published') OR EXISTS(SELECT 1 FROM material_audio_versions c JOIN material_versions v ON v.id=c.version_id WHERE c.source_id=old.id AND v.status='published') OR EXISTS(SELECT 1 FROM material_video_versions c JOIN material_versions v ON v.id=c.version_id WHERE c.source_id=old.id AND v.status='published') OR EXISTS(SELECT 1 FROM material_image_versions c JOIN material_versions v ON v.id=c.version_id WHERE c.source_id=old.id AND v.status='published') OR EXISTS(SELECT 1 FROM material_link_versions c JOIN material_versions v ON v.id=c.version_id WHERE c.source_id=old.id AND v.status='published') OR EXISTS(SELECT 1 FROM documents d JOIN material_document_versions c ON c.document_id=d.id JOIN material_versions v ON v.id=c.version_id WHERE d.source_id=old.id AND v.status='published'))
BEGIN SELECT RAISE(ABORT, 'published source content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER source_blobs_material_insert BEFORE INSERT ON source_blobs
WHEN (EXISTS(SELECT 1 FROM material_file_versions c JOIN material_versions v ON v.id=c.version_id WHERE c.source_id=new.source_id AND v.status='published') OR EXISTS(SELECT 1 FROM material_audio_versions c JOIN material_versions v ON v.id=c.version_id WHERE c.source_id=new.source_id AND v.status='published') OR EXISTS(SELECT 1 FROM material_video_versions c JOIN material_versions v ON v.id=c.version_id WHERE c.source_id=new.source_id AND v.status='published') OR EXISTS(SELECT 1 FROM material_image_versions c JOIN material_versions v ON v.id=c.version_id WHERE c.source_id=new.source_id AND v.status='published') OR EXISTS(SELECT 1 FROM material_link_versions c JOIN material_versions v ON v.id=c.version_id WHERE c.source_id=new.source_id AND v.status='published') OR EXISTS(SELECT 1 FROM documents d JOIN material_document_versions c ON c.document_id=d.id JOIN material_versions v ON v.id=c.version_id WHERE d.source_id=new.source_id AND v.status='published'))
BEGIN SELECT RAISE(ABORT, 'published source content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER source_blobs_material_delete BEFORE DELETE ON source_blobs
WHEN (EXISTS(SELECT 1 FROM material_file_versions c JOIN material_versions v ON v.id=c.version_id WHERE c.source_id=old.source_id AND v.status='published') OR EXISTS(SELECT 1 FROM material_audio_versions c JOIN material_versions v ON v.id=c.version_id WHERE c.source_id=old.source_id AND v.status='published') OR EXISTS(SELECT 1 FROM material_video_versions c JOIN material_versions v ON v.id=c.version_id WHERE c.source_id=old.source_id AND v.status='published') OR EXISTS(SELECT 1 FROM material_image_versions c JOIN material_versions v ON v.id=c.version_id WHERE c.source_id=old.source_id AND v.status='published') OR EXISTS(SELECT 1 FROM material_link_versions c JOIN material_versions v ON v.id=c.version_id WHERE c.source_id=old.source_id AND v.status='published') OR EXISTS(SELECT 1 FROM documents d JOIN material_document_versions c ON c.document_id=d.id JOIN material_versions v ON v.id=c.version_id WHERE d.source_id=old.source_id AND v.status='published'))
BEGIN SELECT RAISE(ABORT, 'published source content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_card_identity_update BEFORE UPDATE ON material_card_identities
WHEN new.id IS NOT old.id OR new.material_id IS NOT old.material_id OR new.kind IS NOT old.kind
BEGIN SELECT RAISE(ABORT, 'card identity ownership is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_attempt_published BEFORE INSERT ON material_quiz_attempts
WHEN NOT EXISTS(SELECT 1 FROM material_versions v WHERE v.id=new.version_id AND v.status='published') OR new.status != 'in_progress'
BEGIN SELECT RAISE(ABORT, 'quiz attempts must start on a published quiz'); END;
--> statement-breakpoint
CREATE TRIGGER material_attempt_identity BEFORE UPDATE ON material_quiz_attempts
WHEN old.status='completed' OR new.id IS NOT old.id OR new.version_id IS NOT old.version_id OR new.started_at IS NOT old.started_at
BEGIN SELECT RAISE(ABORT, 'completed attempts and attempt identities are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_attempt_delete BEFORE DELETE ON material_quiz_attempts
WHEN old.status='completed' AND EXISTS(SELECT 1 FROM material_versions v WHERE v.id=old.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'completed attempts cannot be deleted'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_responses_completed_insert BEFORE INSERT ON material_quiz_responses
WHEN EXISTS(SELECT 1 FROM material_quiz_attempts a JOIN material_versions v ON v.id=a.version_id WHERE a.id=new.attempt_id AND a.status='completed')
BEGIN SELECT RAISE(ABORT, 'completed quiz answers are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_responses_completed_update BEFORE UPDATE ON material_quiz_responses
WHEN EXISTS(SELECT 1 FROM material_quiz_attempts a JOIN material_versions v ON v.id=a.version_id WHERE a.id=old.attempt_id AND a.status='completed') OR EXISTS(SELECT 1 FROM material_quiz_attempts a JOIN material_versions v ON v.id=a.version_id WHERE a.id=new.attempt_id AND a.status='completed')
BEGIN SELECT RAISE(ABORT, 'completed quiz answers are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_responses_completed_delete BEFORE DELETE ON material_quiz_responses
WHEN EXISTS(SELECT 1 FROM material_quiz_attempts a JOIN material_versions v ON v.id=a.version_id WHERE a.id=old.attempt_id AND a.status='completed')
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
CREATE TRIGGER material_quiz_selections_completed_delete BEFORE DELETE ON material_quiz_selections
WHEN EXISTS(SELECT 1 FROM material_quiz_attempts a JOIN material_versions v ON v.id=a.version_id WHERE a.id=old.attempt_id AND a.status='completed')
BEGIN SELECT RAISE(ABORT, 'completed quiz answers are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_selection_single_insert BEFORE INSERT ON material_quiz_selections
WHEN (SELECT question_kind FROM material_quiz_responses WHERE attempt_id=new.attempt_id AND question_id=new.question_id)='single_choice'
          AND EXISTS(SELECT 1 FROM material_quiz_selections s WHERE s.attempt_id=new.attempt_id AND s.question_id=new.question_id )
BEGIN SELECT RAISE(ABORT, 'single choice answers may select exactly one choice'); END;
--> statement-breakpoint
CREATE TRIGGER material_selection_single_update BEFORE UPDATE ON material_quiz_selections
WHEN (SELECT question_kind FROM material_quiz_responses WHERE attempt_id=new.attempt_id AND question_id=new.question_id)='single_choice'
          AND EXISTS(SELECT 1 FROM material_quiz_selections s WHERE s.attempt_id=new.attempt_id AND s.question_id=new.question_id AND (s.attempt_id != old.attempt_id OR s.question_id != old.question_id OR s.choice_id != old.choice_id))
BEGIN SELECT RAISE(ABORT, 'single choice answers may select exactly one choice'); END;
--> statement-breakpoint
CREATE TRIGGER material_attempt_complete_answers BEFORE UPDATE OF status ON material_quiz_attempts
WHEN new.status='completed' AND EXISTS(SELECT 1 FROM material_quiz_responses r WHERE r.attempt_id=new.id AND r.question_kind IN ('single_choice','multiple_choice') AND NOT EXISTS(SELECT 1 FROM material_quiz_selections s WHERE s.attempt_id=r.attempt_id AND s.question_id=r.question_id))
BEGIN SELECT RAISE(ABORT, 'choice responses require a selection before completion'); END;
--> statement-breakpoint
CREATE TRIGGER material_review_published BEFORE INSERT ON material_card_reviews
WHEN NOT EXISTS(SELECT 1 FROM material_versions v WHERE v.id=new.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'card reviews require a published deck'); END;
--> statement-breakpoint
CREATE TRIGGER material_review_update BEFORE UPDATE ON material_card_reviews
WHEN EXISTS(SELECT 1 FROM material_versions v WHERE v.id=old.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'card reviews are append only'); END;
--> statement-breakpoint
CREATE TRIGGER material_review_delete BEFORE DELETE ON material_card_reviews
WHEN EXISTS(SELECT 1 FROM material_versions v WHERE v.id=old.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'card reviews are append only'); END;
--> statement-breakpoint
CREATE TRIGGER material_document_cleanup AFTER DELETE ON material_document_versions BEGIN DELETE FROM documents WHERE id=old.document_id AND source_id IS NULL; END;
--> statement-breakpoint
CREATE TRIGGER material_document_canonical_shape BEFORE UPDATE OF status ON material_versions WHEN new.status='published' AND new.kind='document' AND (EXISTS(SELECT 1 FROM material_document_versions c JOIN blocks b ON b.document_id=c.document_id WHERE c.version_id=new.id AND NOT (CASE WHEN json_valid(b.anchor) THEN coalesce(
    json_type(b.anchor) = 'object' AND CASE json_extract(b.anchor, '$.type')
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
    ELSE 0 END, 0) ELSE 0 END)) OR EXISTS(SELECT 1 FROM material_document_versions c JOIN documents d ON d.id=c.document_id WHERE c.version_id=new.id AND NOT (CASE WHEN json_valid(d.meta) THEN coalesce(
    json_type(d.meta) = 'object'
    AND json_type(d.meta, '$.extractor') IN ('null','text')
    AND json_type(d.meta, '$.extractorVersion') = 'integer' AND json_extract(d.meta, '$.extractorVersion') >= 0
    AND json_type(d.meta, '$.provider') IN ('null','text')
    AND (json_type(d.meta, '$.durationMs') = 'null' OR (json_type(d.meta, '$.durationMs') = 'integer' AND json_extract(d.meta, '$.durationMs') >= 0))
    AND (json_type(d.meta, '$.pageCount') = 'null' OR (json_type(d.meta, '$.pageCount') = 'integer' AND json_extract(d.meta, '$.pageCount') >= 0))
    AND json_type(d.meta, '$.corrected') IN ('true','false')
    AND json_type(d.meta, '$.refiners') = 'array'
    AND json_type(d.meta, '$.waitingFor') = 'array'
    AND NOT EXISTS(SELECT 1 FROM json_each(d.meta, '$.waitingFor') w WHERE w.type != 'text')
    AND NOT EXISTS(SELECT 1 FROM json_each(d.meta, '$.refiners') r WHERE CASE WHEN r.type = 'object' THEN coalesce(
      json_type(r.value, '$.refiner') = 'text' AND length(trim(json_extract(r.value, '$.refiner'))) > 0
      AND json_type(r.value, '$.version') = 'integer' AND json_extract(r.value, '$.version') >= 0, 0) ELSE 0 END = 0)
    , 0) ELSE 0 END))) BEGIN SELECT RAISE(ABORT, 'published documents require canonical anchors and metadata'); END;
--> statement-breakpoint
CREATE TRIGGER sources_material_update BEFORE UPDATE ON sources
WHEN EXISTS (SELECT 1 FROM (SELECT version_id, source_id FROM material_file_versions UNION ALL SELECT version_id, source_id FROM material_audio_versions UNION ALL SELECT version_id, source_id FROM material_video_versions UNION ALL SELECT version_id, source_id FROM material_image_versions UNION ALL SELECT version_id, source_id FROM material_link_versions) c JOIN material_versions v ON v.id=c.version_id LEFT JOIN material_source_snapshots pin ON pin.version_id=c.version_id AND pin.source_id=c.source_id WHERE c.source_id IN (old.id, new.id) AND v.status='published' AND pin.version_id IS NULL)
BEGIN SELECT RAISE(ABORT, 'unpinned published source content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER source_blobs_material_update BEFORE UPDATE ON source_blobs
WHEN EXISTS (SELECT 1 FROM (SELECT version_id, source_id FROM material_file_versions UNION ALL SELECT version_id, source_id FROM material_audio_versions UNION ALL SELECT version_id, source_id FROM material_video_versions UNION ALL SELECT version_id, source_id FROM material_image_versions UNION ALL SELECT version_id, source_id FROM material_link_versions) c JOIN material_versions v ON v.id=c.version_id LEFT JOIN material_source_snapshots pin ON pin.version_id=c.version_id AND pin.source_id=c.source_id WHERE c.source_id IN (old.source_id, new.source_id) AND v.status='published' AND pin.version_id IS NULL)
BEGIN SELECT RAISE(ABORT, 'unpinned published source content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER source_snapshots_published_update BEFORE UPDATE ON source_snapshots
WHEN EXISTS (SELECT 1 FROM material_source_snapshots pin JOIN material_versions v ON v.id=pin.version_id WHERE pin.source_id=old.source_id AND pin.revision=old.revision AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published source revision is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_source_snapshots_published_delete BEFORE DELETE ON material_source_snapshots
WHEN EXISTS (SELECT 1 FROM material_versions v WHERE v.id=old.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published source revision is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER source_snapshots_published_delete BEFORE DELETE ON source_snapshots
WHEN EXISTS (SELECT 1 FROM material_source_snapshots pin JOIN material_versions v ON v.id=pin.version_id WHERE pin.source_id=old.source_id AND pin.revision=old.revision AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published source revision is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_source_snapshots_published_insert BEFORE INSERT ON material_source_snapshots
WHEN EXISTS (SELECT 1 FROM material_versions v WHERE v.id=new.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published source revision is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_source_snapshots_match_insert BEFORE INSERT ON material_source_snapshots
WHEN NOT EXISTS (SELECT 1 FROM (SELECT version_id, source_id FROM material_file_versions UNION ALL SELECT version_id, source_id FROM material_audio_versions UNION ALL SELECT version_id, source_id FROM material_video_versions UNION ALL SELECT version_id, source_id FROM material_image_versions UNION ALL SELECT version_id, source_id FROM material_link_versions) c WHERE c.version_id=new.version_id AND c.source_id=new.source_id)
BEGIN SELECT RAISE(ABORT, 'material source revision must match content'); END;
--> statement-breakpoint
CREATE TRIGGER material_source_snapshots_match_update BEFORE UPDATE ON material_source_snapshots
WHEN NOT EXISTS (SELECT 1 FROM (SELECT version_id, source_id FROM material_file_versions UNION ALL SELECT version_id, source_id FROM material_audio_versions UNION ALL SELECT version_id, source_id FROM material_video_versions UNION ALL SELECT version_id, source_id FROM material_image_versions UNION ALL SELECT version_id, source_id FROM material_link_versions) c WHERE c.version_id=new.version_id AND c.source_id=new.source_id)
BEGIN SELECT RAISE(ABORT, 'material source revision must match content'); END;
--> statement-breakpoint
CREATE TRIGGER material_source_snapshots_published_update BEFORE UPDATE ON material_source_snapshots
WHEN EXISTS(SELECT 1 FROM material_versions v WHERE v.id IN(old.version_id,new.version_id) AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published source revision is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_publish_file BEFORE UPDATE OF status ON material_versions
WHEN new.status='published' AND new.kind='file' AND NOT EXISTS(SELECT 1 FROM material_source_snapshots pin
JOIN material_file_versions payload ON payload.version_id=pin.version_id AND payload.source_id=pin.source_id
JOIN source_snapshots ss ON ss.source_id=pin.source_id AND ss.revision=pin.revision
JOIN sources s ON s.id=pin.source_id
WHERE pin.version_id=new.id AND json_valid(pin.metadata)
AND json_extract(pin.metadata,'$.id')=CAST(pin.source_id AS TEXT)
AND json_extract(pin.metadata,'$.kind')=ss.kind AND json_extract(pin.metadata,'$.mime')=ss.mime
AND json_extract(pin.metadata,'$.uri') IS ss.uri
AND json_extract(pin.metadata,'$.sizeBytes')=CAST(length(ss.bytes) AS TEXT))
BEGIN SELECT RAISE(ABORT, 'published source requires a valid immutable revision'); END;
--> statement-breakpoint
CREATE TRIGGER material_publish_audio BEFORE UPDATE OF status ON material_versions
WHEN new.status='published' AND new.kind='audio' AND NOT EXISTS(SELECT 1 FROM material_source_snapshots pin
JOIN material_audio_versions payload ON payload.version_id=pin.version_id AND payload.source_id=pin.source_id
JOIN source_snapshots ss ON ss.source_id=pin.source_id AND ss.revision=pin.revision
JOIN sources s ON s.id=pin.source_id
WHERE pin.version_id=new.id AND json_valid(pin.metadata)
AND json_extract(pin.metadata,'$.id')=CAST(pin.source_id AS TEXT)
AND json_extract(pin.metadata,'$.kind')=ss.kind AND json_extract(pin.metadata,'$.mime')=ss.mime
AND json_extract(pin.metadata,'$.uri') IS ss.uri
AND json_extract(pin.metadata,'$.sizeBytes')=CAST(length(ss.bytes) AS TEXT) AND ss.kind='audio' AND lower(ss.mime) LIKE 'audio/%')
BEGIN SELECT RAISE(ABORT, 'published source requires a valid immutable revision'); END;
--> statement-breakpoint
CREATE TRIGGER material_publish_video BEFORE UPDATE OF status ON material_versions
WHEN new.status='published' AND new.kind='video' AND NOT EXISTS(SELECT 1 FROM material_source_snapshots pin
JOIN material_video_versions payload ON payload.version_id=pin.version_id AND payload.source_id=pin.source_id
JOIN source_snapshots ss ON ss.source_id=pin.source_id AND ss.revision=pin.revision
JOIN sources s ON s.id=pin.source_id
WHERE pin.version_id=new.id AND json_valid(pin.metadata)
AND json_extract(pin.metadata,'$.id')=CAST(pin.source_id AS TEXT)
AND json_extract(pin.metadata,'$.kind')=ss.kind AND json_extract(pin.metadata,'$.mime')=ss.mime
AND json_extract(pin.metadata,'$.uri') IS ss.uri
AND json_extract(pin.metadata,'$.sizeBytes')=CAST(length(ss.bytes) AS TEXT) AND ss.kind='video' AND lower(ss.mime) LIKE 'video/%')
BEGIN SELECT RAISE(ABORT, 'published source requires a valid immutable revision'); END;
--> statement-breakpoint
CREATE TRIGGER material_publish_image BEFORE UPDATE OF status ON material_versions
WHEN new.status='published' AND new.kind='image' AND NOT EXISTS(SELECT 1 FROM material_source_snapshots pin
JOIN material_image_versions payload ON payload.version_id=pin.version_id AND payload.source_id=pin.source_id
JOIN source_snapshots ss ON ss.source_id=pin.source_id AND ss.revision=pin.revision
JOIN sources s ON s.id=pin.source_id
WHERE pin.version_id=new.id AND json_valid(pin.metadata)
AND json_extract(pin.metadata,'$.id')=CAST(pin.source_id AS TEXT)
AND json_extract(pin.metadata,'$.kind')=ss.kind AND json_extract(pin.metadata,'$.mime')=ss.mime
AND json_extract(pin.metadata,'$.uri') IS ss.uri
AND json_extract(pin.metadata,'$.sizeBytes')=CAST(length(ss.bytes) AS TEXT) AND ss.kind='image' AND lower(ss.mime) LIKE 'image/%')
BEGIN SELECT RAISE(ABORT, 'published source requires a valid immutable revision'); END;
--> statement-breakpoint
CREATE TRIGGER material_publish_link BEFORE UPDATE OF status ON material_versions
WHEN new.status='published' AND new.kind='link' AND NOT EXISTS(SELECT 1 FROM material_source_snapshots pin
JOIN material_link_versions payload ON payload.version_id=pin.version_id AND payload.source_id=pin.source_id
JOIN source_snapshots ss ON ss.source_id=pin.source_id AND ss.revision=pin.revision
JOIN sources s ON s.id=pin.source_id
WHERE pin.version_id=new.id AND json_valid(pin.metadata)
AND json_extract(pin.metadata,'$.id')=CAST(pin.source_id AS TEXT)
AND json_extract(pin.metadata,'$.kind')=ss.kind AND json_extract(pin.metadata,'$.mime')=ss.mime
AND json_extract(pin.metadata,'$.uri') IS ss.uri
AND ss.kind IN ('link','web') AND (ss.uri LIKE 'https://%' OR ss.uri LIKE 'http://%'))
BEGIN SELECT RAISE(ABORT, 'published source requires a valid immutable revision'); END;
--> statement-breakpoint
CREATE TRIGGER material_generation_result_immutable BEFORE UPDATE OF result_version_id, result_hash ON material_generation_requests
WHEN OLD.result_version_id IS NOT NULL AND (NEW.result_version_id IS NOT OLD.result_version_id OR NEW.result_hash IS NOT OLD.result_hash)
BEGIN SELECT RAISE(ABORT, 'generation result is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_versions_frozen BEFORE UPDATE ON material_versions
WHEN EXISTS(SELECT 1 FROM material_versions v WHERE v.id=old.id AND v.status='published') OR new.id IS NOT old.id OR new.material_id IS NOT old.material_id OR new.kind IS NOT old.kind OR new.number IS NOT old.number OR new.created_at IS NOT old.created_at
BEGIN SELECT RAISE(ABORT, 'published versions and version identities are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_generation_intent_immutable BEFORE UPDATE ON material_generation_requests
WHEN NEW.id IS NOT OLD.id OR NEW.project_id IS NOT OLD.project_id OR NEW.payload IS NOT OLD.payload OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT, 'generation intent is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_generation_intent_retained BEFORE DELETE ON material_generation_requests
WHEN 1
BEGIN SELECT RAISE(ABORT, 'generation intent cannot be deleted'); END;
--> statement-breakpoint
CREATE TRIGGER material_generation_input_immutable BEFORE UPDATE ON material_generation_inputs
BEGIN SELECT RAISE(ABORT, 'generation inputs are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_generation_input_retained BEFORE DELETE ON material_generation_inputs
WHEN EXISTS(SELECT 1 FROM material_generation_requests WHERE id=OLD.request_id)
BEGIN SELECT RAISE(ABORT, 'generation inputs cannot be deleted'); END;
--> statement-breakpoint
CREATE TRIGGER material_generation_input_captured BEFORE INSERT ON material_generation_inputs
WHEN NOT EXISTS(SELECT 1 FROM material_generation_requests r JOIN material_versions v ON v.id=NEW.version_id AND EXISTS(SELECT 1 FROM project_materials pm WHERE pm.material_id=v.material_id AND pm.project_id=r.project_id) JOIN materials m ON m.id=v.material_id WHERE r.id=NEW.request_id AND CAST(json_extract(r.payload,'$.inputVersionIds[' || NEW.position || ']') AS TEXT)=CAST(NEW.version_id AS TEXT) AND v.status='published' AND v.kind='document' AND m.archived_at IS NULL)
BEGIN SELECT RAISE(ABORT, 'generation input does not match captured intent'); END;
--> statement-breakpoint
CREATE TRIGGER material_generation_intent_insert BEFORE INSERT ON material_generation_requests
WHEN NEW.result_version_id IS NOT NULL OR NEW.result_hash IS NOT NULL OR json_type(NEW.payload,'$.inputVersionIds') IS NOT 'array' OR json_array_length(NEW.payload,'$.inputVersionIds') NOT BETWEEN 1 AND 20 OR EXISTS(SELECT 1 FROM json_each(NEW.payload,'$.inputVersionIds') WHERE type!='text' OR value NOT GLOB '[1-9]*' OR value GLOB '*[^0-9]*') OR (SELECT COUNT(DISTINCT value) FROM json_each(NEW.payload,'$.inputVersionIds'))!=json_array_length(NEW.payload,'$.inputVersionIds')
BEGIN SELECT RAISE(ABORT, 'invalid generation intent'); END;
--> statement-breakpoint
CREATE TRIGGER material_generation_binding_immutable BEFORE UPDATE OF generation_request_id ON material_versions
WHEN OLD.generation_request_id IS NOT NULL AND NEW.generation_request_id IS NOT OLD.generation_request_id
BEGIN SELECT RAISE(ABORT, 'generation binding is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_generation_publish BEFORE UPDATE OF status ON material_versions
WHEN NEW.status='published' AND NEW.creator='agent' AND NEW.operation='generate' AND NOT EXISTS(
 SELECT 1 FROM material_generation_requests r JOIN materials m ON m.id=NEW.material_id
 WHERE r.id=NEW.generation_request_id AND EXISTS(SELECT 1 FROM project_materials pm WHERE pm.material_id=NEW.material_id AND pm.project_id=r.project_id) AND json_extract(r.payload,'$.kind')=NEW.kind AND json_extract(r.payload,'$.title')=m.title AND json_extract(r.payload,'$.instruction') IS NEW.instruction
 AND (SELECT COUNT(*) FROM material_generation_inputs WHERE request_id=r.id)=json_array_length(r.payload,'$.inputVersionIds')
 AND NOT EXISTS(SELECT 1 FROM material_generation_inputs i JOIN material_versions iv ON iv.id=i.version_id WHERE i.request_id=r.id AND NOT EXISTS(SELECT 1 FROM project_materials pm WHERE pm.material_id=iv.material_id AND pm.project_id=r.project_id))
 AND NOT EXISTS(SELECT version_id FROM material_generation_inputs WHERE request_id=r.id EXCEPT SELECT input_version_id FROM material_version_inputs WHERE version_id=NEW.id)
 AND NOT EXISTS(SELECT input_version_id FROM material_version_inputs WHERE version_id=NEW.id EXCEPT SELECT version_id FROM material_generation_inputs WHERE request_id=r.id)
)
BEGIN SELECT RAISE(ABORT, 'generated publication does not match its request'); END;
--> statement-breakpoint
CREATE TRIGGER material_generation_receipt_valid BEFORE UPDATE OF result_version_id,result_hash ON material_generation_requests
WHEN OLD.result_version_id IS NULL AND NEW.result_version_id IS NOT NULL AND (length(NEW.result_hash)!=64 OR NEW.result_hash GLOB '*[^0-9a-f]*' OR NOT EXISTS(
 SELECT 1 FROM material_versions v JOIN materials m ON m.id=v.material_id WHERE v.id=NEW.result_version_id AND EXISTS(SELECT 1 FROM project_materials pm WHERE pm.material_id=v.material_id AND pm.project_id=NEW.project_id) AND v.generation_request_id=NEW.id AND v.status='published' AND v.creator='agent' AND v.operation='generate' AND v.kind=json_extract(NEW.payload,'$.kind') AND v.instruction IS json_extract(NEW.payload,'$.instruction')
 AND (SELECT COUNT(*) FROM material_generation_inputs WHERE request_id=NEW.id)=json_array_length(NEW.payload,'$.inputVersionIds')
 AND NOT EXISTS(SELECT 1 FROM material_generation_inputs i JOIN material_versions iv ON iv.id=i.version_id WHERE i.request_id=NEW.id AND NOT EXISTS(SELECT 1 FROM project_materials pm WHERE pm.material_id=iv.material_id AND pm.project_id=NEW.project_id))
 AND NOT EXISTS(SELECT version_id FROM material_generation_inputs WHERE request_id=NEW.id EXCEPT SELECT input_version_id FROM material_version_inputs WHERE version_id=v.id)
 AND NOT EXISTS(SELECT input_version_id FROM material_version_inputs WHERE version_id=v.id EXCEPT SELECT version_id FROM material_generation_inputs WHERE request_id=NEW.id)
))
BEGIN SELECT RAISE(ABORT, 'generation receipt does not identify its published output'); END;
--> statement-breakpoint
CREATE TRIGGER conversation_recording_posts_immutable BEFORE UPDATE ON conversation_recording_posts
BEGIN SELECT RAISE(ABORT,'conversation recording post is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER conversation_recording_posts_retain BEFORE DELETE ON conversation_recording_posts
WHEN EXISTS(SELECT 1 FROM sessions s WHERE s.id=OLD.session_id)
BEGIN SELECT RAISE(ABORT,'conversation recording post is retained'); END;
--> statement-breakpoint
CREATE TRIGGER source_recording_imports_validate_insert BEFORE INSERT ON source_recording_imports
WHEN NOT EXISTS(SELECT 1 FROM sources src JOIN source_blobs b ON b.source_id=src.id JOIN sessions s ON s.id=NEW.session_id WHERE src.id=NEW.source_id AND src.project_id IS NEW.project_id AND src.origin='recording' AND src.kind='audio' AND src.mime='audio/wav' AND NEW.duration_ms=CAST((length(b.bytes)-44+16)/32 AS INTEGER))
BEGIN SELECT RAISE(ABORT,'invalid recording source receipt'); END;
--> statement-breakpoint
CREATE TRIGGER source_recording_imports_immutable BEFORE UPDATE ON source_recording_imports
WHEN NEW.request_id IS NOT OLD.request_id OR NEW.session_id IS NOT OLD.session_id OR NEW.source_id IS NOT OLD.source_id OR NEW.input_hash IS NOT OLD.input_hash OR NEW.duration_ms IS NOT OLD.duration_ms
BEGIN SELECT RAISE(ABORT,'recording source receipt is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER source_recording_imports_retain BEFORE DELETE ON source_recording_imports
WHEN EXISTS(SELECT 1 FROM projects WHERE id=OLD.project_id)
BEGIN SELECT RAISE(ABORT,'recording source receipt is retained'); END;
--> statement-breakpoint
CREATE TRIGGER recording_posts_validate_insert BEFORE INSERT ON recording_posts
WHEN NEW.source_id IS NOT NULL OR NEW.message_id IS NOT NULL OR NOT EXISTS(SELECT 1 FROM recordings r JOIN sessions s ON s.id=r.session_id WHERE r.id=NEW.recording_id AND r.session_id=NEW.session_id) OR NEW.duration_ms != CAST((length(NEW.wav)-44+16)/32 AS INTEGER)
BEGIN SELECT RAISE(ABORT,'invalid recording snapshot'); END;
--> statement-breakpoint
CREATE TRIGGER recording_posts_immutable BEFORE UPDATE ON recording_posts
WHEN NEW.request_id IS NOT OLD.request_id OR NEW.recording_id IS NOT OLD.recording_id OR NEW.session_id IS NOT OLD.session_id OR NEW.name IS NOT OLD.name OR NEW.wav IS NOT OLD.wav OR NEW.duration_ms IS NOT OLD.duration_ms OR NEW.created_at IS NOT OLD.created_at OR (OLD.message_id IS NOT NULL AND (NEW.message_id IS NOT OLD.message_id OR NEW.source_id IS NOT OLD.source_id))
BEGIN SELECT RAISE(ABORT,'recording snapshot and receipt are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER recording_posts_result_valid BEFORE UPDATE OF source_id,message_id ON recording_posts
WHEN NEW.message_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM source_recording_imports src JOIN conversation_recording_posts p ON p.request_id=src.request_id WHERE src.request_id=NEW.request_id AND src.source_id=NEW.source_id AND src.project_id IS NEW.project_id AND src.session_id=NEW.session_id AND p.session_id=NEW.session_id AND p.message_id=NEW.message_id)
BEGIN SELECT RAISE(ABORT,'recording receipt does not identify its output'); END;
--> statement-breakpoint
CREATE TRIGGER recording_posts_retain BEFORE DELETE ON recording_posts
WHEN EXISTS(SELECT 1 FROM sessions s WHERE s.id=OLD.session_id)
BEGIN SELECT RAISE(ABORT,'recording intent is retained'); END;
--> statement-breakpoint
CREATE TRIGGER recording_chunks_captured_insert BEFORE INSERT ON recording_chunks
WHEN EXISTS(SELECT 1 FROM recording_posts WHERE recording_id=NEW.recording_id) OR (SELECT COALESCE(SUM(length(pcm)),0) FROM recording_chunks WHERE recording_id=NEW.recording_id)+length(NEW.pcm)>115200000
BEGIN SELECT RAISE(ABORT,'recording is captured or exceeds its size limit'); END;
--> statement-breakpoint
CREATE TRIGGER recording_chunks_captured_update BEFORE UPDATE ON recording_chunks
WHEN EXISTS(SELECT 1 FROM recording_posts WHERE recording_id IN(OLD.recording_id,NEW.recording_id))
BEGIN SELECT RAISE(ABORT,'captured recording PCM is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER recording_chunks_captured_delete BEFORE DELETE ON recording_chunks
WHEN EXISTS(SELECT 1 FROM recording_posts p JOIN sessions s ON s.id=p.session_id WHERE p.recording_id=OLD.recording_id)
BEGIN SELECT RAISE(ABORT,'captured recording PCM is retained'); END;
--> statement-breakpoint
CREATE TRIGGER source_recording_capture_frozen BEFORE UPDATE ON sources
WHEN EXISTS(SELECT 1 FROM source_recording_imports WHERE source_id=OLD.id) AND (
 NEW.id IS NOT OLD.id OR NEW.origin IS NOT OLD.origin OR NEW.kind IS NOT OLD.kind OR NEW.mime IS NOT OLD.mime OR NEW.name IS NOT OLD.name OR NEW.size_bytes IS NOT OLD.size_bytes OR NEW.sha256 IS NOT OLD.sha256 OR NEW.uri IS NOT OLD.uri OR NEW.created_at IS NOT OLD.created_at)
BEGIN SELECT RAISE(ABORT,'imported recording metadata is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER source_recording_bytes_frozen BEFORE UPDATE ON source_blobs
WHEN EXISTS(SELECT 1 FROM source_recording_imports WHERE source_id IN(OLD.source_id,NEW.source_id))
BEGIN SELECT RAISE(ABORT,'imported recording bytes are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER recordings_captured_update BEFORE UPDATE ON recordings
WHEN EXISTS(SELECT 1 FROM recording_posts WHERE recording_id IN(OLD.id,NEW.id))
BEGIN SELECT RAISE(ABORT,'captured recording identity is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER source_recording_bytes_retained BEFORE DELETE ON source_blobs
WHEN EXISTS(SELECT 1 FROM source_recording_imports r JOIN sources src ON src.id=r.source_id WHERE r.source_id=OLD.source_id)
BEGIN SELECT RAISE(ABORT,'imported recording bytes are retained'); END;
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
CREATE TRIGGER conversation_recording_posts_validate_insert BEFORE INSERT ON conversation_recording_posts
WHEN NOT EXISTS (
 SELECT 1 FROM messages m JOIN sessions s ON s.id=m.session_id
 JOIN message_versions v ON v.id=m.active_version_id AND v.message_id=m.id
 JOIN message_parts p ON p.message_id=m.id AND p.ordinal=0 JOIN sources src ON src.id=p.source_id
 WHERE m.id=NEW.message_id AND m.session_id=NEW.session_id AND m.role='user' AND m.recording_ms IS NOT NULL AND m.recorded_in=src.id AND v.origin='typed' AND v.status='complete' AND v.text='' AND src.origin='recording' AND src.kind='audio' AND src.mime LIKE 'audio/%'
)
BEGIN SELECT RAISE(ABORT,'invalid conversation recording post'); END;
--> statement-breakpoint
CREATE TRIGGER catalog_native_material_update AFTER UPDATE OF title,archived_at ON materials BEGIN
 DELETE FROM catalog_fts WHERE kind='material' AND target_id=new.id;
 DELETE FROM catalog_fts WHERE kind='question' AND target_id IN (SELECT q.id FROM material_quiz_questions q JOIN material_versions v ON v.id=q.version_id WHERE v.material_id=new.id);
 INSERT INTO catalog_fts SELECT m.title,'material',m.id,NULL FROM materials m WHERE m.id=new.id AND m.archived_at IS NULL AND EXISTS (SELECT 1 FROM material_versions v WHERE v.material_id=m.id AND v.status='published');
 INSERT INTO catalog_fts SELECT q.prompt,'question',q.id,NULL FROM materials m JOIN material_versions v ON v.material_id=m.id JOIN material_quiz_questions q ON q.version_id=v.id WHERE m.id=new.id AND m.archived_at IS NULL AND v.status='published' AND v.number=(SELECT max(h.number) FROM material_versions h WHERE h.material_id=m.id AND h.status='published');
END;
--> statement-breakpoint
CREATE TRIGGER catalog_native_version_insert AFTER INSERT ON material_versions BEGIN
 DELETE FROM catalog_fts WHERE kind='material' AND target_id=new.material_id;
 DELETE FROM catalog_fts WHERE kind='question' AND target_id IN (SELECT q.id FROM material_quiz_questions q JOIN material_versions v ON v.id=q.version_id WHERE v.material_id=new.material_id);
 INSERT INTO catalog_fts SELECT m.title,'material',m.id,NULL FROM materials m WHERE m.id=new.material_id AND m.archived_at IS NULL AND EXISTS (SELECT 1 FROM material_versions v WHERE v.material_id=m.id AND v.status='published');
 INSERT INTO catalog_fts SELECT q.prompt,'question',q.id,NULL FROM materials m JOIN material_versions v ON v.material_id=m.id JOIN material_quiz_questions q ON q.version_id=v.id WHERE m.id=new.material_id AND m.archived_at IS NULL AND v.status='published' AND v.number=(SELECT max(h.number) FROM material_versions h WHERE h.material_id=m.id AND h.status='published');
END;
--> statement-breakpoint
CREATE TRIGGER catalog_native_version_update AFTER UPDATE OF status,number ON material_versions BEGIN
 DELETE FROM catalog_fts WHERE kind='material' AND target_id=new.material_id;
 DELETE FROM catalog_fts WHERE kind='question' AND target_id IN (SELECT q.id FROM material_quiz_questions q JOIN material_versions v ON v.id=q.version_id WHERE v.material_id=new.material_id);
 INSERT INTO catalog_fts SELECT m.title,'material',m.id,NULL FROM materials m WHERE m.id=new.material_id AND m.archived_at IS NULL AND EXISTS (SELECT 1 FROM material_versions v WHERE v.material_id=m.id AND v.status='published');
 INSERT INTO catalog_fts SELECT q.prompt,'question',q.id,NULL FROM materials m JOIN material_versions v ON v.material_id=m.id JOIN material_quiz_questions q ON q.version_id=v.id WHERE m.id=new.material_id AND m.archived_at IS NULL AND v.status='published' AND v.number=(SELECT max(h.number) FROM material_versions h WHERE h.material_id=m.id AND h.status='published');
END;
--> statement-breakpoint
CREATE TRIGGER catalog_native_version_delete AFTER DELETE ON material_versions BEGIN
 DELETE FROM catalog_fts WHERE kind='material' AND target_id=old.material_id;
 DELETE FROM catalog_fts WHERE kind='question' AND target_id IN (SELECT q.id FROM material_quiz_questions q JOIN material_versions v ON v.id=q.version_id WHERE v.material_id=old.material_id);
 INSERT INTO catalog_fts SELECT m.title,'material',m.id,NULL FROM materials m WHERE m.id=old.material_id AND m.archived_at IS NULL AND EXISTS (SELECT 1 FROM material_versions v WHERE v.material_id=m.id AND v.status='published');
 INSERT INTO catalog_fts SELECT q.prompt,'question',q.id,NULL FROM materials m JOIN material_versions v ON v.material_id=m.id JOIN material_quiz_questions q ON q.version_id=v.id WHERE m.id=old.material_id AND m.archived_at IS NULL AND v.status='published' AND v.number=(SELECT max(h.number) FROM material_versions h WHERE h.material_id=m.id AND h.status='published');
END;
--> statement-breakpoint
CREATE TRIGGER catalog_native_question_delete BEFORE DELETE ON material_quiz_questions BEGIN DELETE FROM catalog_fts WHERE kind='question' AND target_id=old.id; END;
--> statement-breakpoint
CREATE TRIGGER catalog_native_material_delete BEFORE DELETE ON materials BEGIN DELETE FROM catalog_fts WHERE kind='material' AND target_id=old.id; DELETE FROM catalog_fts WHERE kind='question' AND target_id IN (SELECT q.id FROM material_quiz_questions q JOIN material_versions v ON v.id=q.version_id WHERE v.material_id=old.id); END;
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
CREATE TRIGGER material_generation_request_scope
BEFORE INSERT ON material_generation_requests
WHEN json_extract(NEW.payload, '$.scopeId') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM material_generation_scopes s
  WHERE s.id = json_extract(NEW.payload, '$.scopeId') AND s.project_id = NEW.project_id AND s.enabled = 1
)
BEGIN SELECT RAISE(ABORT, 'generation scope is not active for this project'); END;
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
CREATE TRIGGER learning_practice_slot_capture
BEFORE INSERT ON learning_practice_slots
WHEN NEW.status != 'pending' OR NEW.version_id IS NOT NULL OR NEW.attempt_id IS NOT NULL
  OR NEW.kind IS NOT CASE WHEN NEW.ordinal % 3 = 2 THEN 'open' ELSE 'choice' END
  OR NOT EXISTS (SELECT 1 FROM learning_practice_controls c WHERE c.project_id = NEW.project_id AND c.epoch = NEW.epoch AND c.enabled = 1)
  OR (SELECT COUNT(*) FROM learning_practice_slots p WHERE p.project_id = NEW.project_id AND p.epoch = NEW.epoch AND p.status IN ('pending','ready')) >= 2
  OR NEW.ordinal != (SELECT COALESCE(MAX(p.ordinal) + 1, 0) FROM learning_practice_slots p WHERE p.project_id = NEW.project_id AND p.epoch = NEW.epoch)
  OR json_type(NEW.input_version_ids) IS NOT 'array' OR json_array_length(NEW.input_version_ids) NOT BETWEEN 1 AND 20
  OR (SELECT COUNT(DISTINCT value) FROM json_each(NEW.input_version_ids)) != json_array_length(NEW.input_version_ids)
  OR EXISTS (SELECT 1 FROM json_each(NEW.input_version_ids) j WHERE j.type != 'text' OR NOT EXISTS (
    SELECT 1 FROM material_versions v JOIN materials m ON m.id = v.material_id JOIN material_document_versions d ON d.version_id = v.id
    WHERE CAST(v.id AS TEXT) = j.value AND EXISTS(SELECT 1 FROM project_materials pm WHERE pm.material_id=v.material_id AND pm.project_id=NEW.project_id) AND v.kind = 'document' AND v.status = 'published' AND m.archived_at IS NULL
  ))
BEGIN SELECT RAISE(ABORT, 'invalid or unbounded practice slot capture'); END;
--> statement-breakpoint
CREATE TRIGGER learning_practice_slot_immutable
BEFORE UPDATE ON learning_practice_slots
WHEN NEW.id IS NOT OLD.id OR NEW.project_id IS NOT OLD.project_id OR NEW.epoch IS NOT OLD.epoch
  OR NEW.ordinal IS NOT OLD.ordinal OR NEW.kind IS NOT OLD.kind OR NEW.input_version_ids IS NOT OLD.input_version_ids
  OR (OLD.version_id IS NOT NULL AND (NEW.version_id IS NOT OLD.version_id OR NEW.attempt_id IS NOT OLD.attempt_id))
  OR (OLD.status IN ('answered','cancelled') AND NEW.status IS NOT OLD.status)
  OR (OLD.status = 'ready' AND NEW.status NOT IN ('ready','answered','cancelled'))
  OR (OLD.status = 'pending' AND NEW.status NOT IN ('pending','ready','cancelled'))
BEGIN SELECT RAISE(ABORT, 'practice slot intent and receipts are immutable'); END;
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
      AND json_extract(r.payload, '$.inputVersionIds') = json(NEW.input_version_ids)
      AND (SELECT COUNT(*) FROM material_quiz_questions q WHERE q.version_id = v.id) = 1
      AND NOT EXISTS (SELECT 1 FROM material_quiz_questions q WHERE q.version_id = v.id AND ((NEW.kind = 'open' AND q.kind != 'open') OR (NEW.kind = 'choice' AND q.kind NOT IN ('single_choice','multiple_choice'))))
  )
)
BEGIN SELECT RAISE(ABORT, 'practice publication does not match its slot'); END;
--> statement-breakpoint
CREATE TRIGGER learning_practice_slot_answer
BEFORE UPDATE OF status ON learning_practice_slots
WHEN NEW.status = 'answered' AND OLD.status != 'answered' AND NOT EXISTS (
  SELECT 1 FROM material_quiz_responses r WHERE r.attempt_id = NEW.attempt_id AND r.version_id = NEW.version_id
)
BEGIN SELECT RAISE(ABORT, 'practice answer requires a canonical response'); END;
--> statement-breakpoint
CREATE TRIGGER learning_practice_slot_retained
BEFORE DELETE ON learning_practice_slots
WHEN EXISTS (SELECT 1 FROM projects WHERE id = OLD.project_id)
BEGIN SELECT RAISE(ABORT, 'practice slot is retained'); END;
--> statement-breakpoint
CREATE TRIGGER learning_practice_answer_immutable
BEFORE UPDATE OF answer ON material_quiz_responses
WHEN NEW.answer IS NOT OLD.answer AND EXISTS (
  SELECT 1 FROM learning_practice_slots p JOIN projects owner ON owner.id = p.project_id
  WHERE p.attempt_id = OLD.attempt_id AND p.status = 'answered'
)
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
CREATE TRIGGER learning_practice_selection_delete
BEFORE DELETE ON material_quiz_selections
WHEN EXISTS (
  SELECT 1 FROM learning_practice_slots p JOIN projects owner ON owner.id = p.project_id
  WHERE p.attempt_id = OLD.attempt_id AND p.status = 'answered'
)
BEGIN SELECT RAISE(ABORT, 'committed practice answers are immutable'); END;
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
CREATE TRIGGER learning_practice_failure_clear
BEFORE UPDATE OF failure_kind ON learning_practice_slots
WHEN OLD.failure_kind IS NOT NULL AND NEW.failure_kind IS NULL
  AND NEW.generation_attempt = OLD.generation_attempt
  AND NEW.status = 'pending'
BEGIN SELECT RAISE(ABORT, 'practice failures require an explicit retry'); END;
