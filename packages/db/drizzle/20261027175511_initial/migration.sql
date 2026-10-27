CREATE TABLE `preferences` (
	`scope` text NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	CONSTRAINT `preferences_pk` PRIMARY KEY(`scope`, `key`),
	CONSTRAINT "preferences_check_1" CHECK(json_valid(value))
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`name` text NOT NULL,
	`exam_on` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "projects_check_1" CHECK(length(trim(name)) > 0 AND length(name) <= 100),
	CONSTRAINT "projects_check_2" CHECK(exam_on IS NULL OR date(exam_on) IS exam_on)
);
--> statement-breakpoint
CREATE TABLE `source_blobs` (
	`source_id` integer PRIMARY KEY,
	`bytes` blob NOT NULL,
	CONSTRAINT `fk_source_blobs_source_id_sources_id_fk` FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `sources` (
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
	CONSTRAINT `fk_sources_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_sources_origin_codes_source_origin_code_fk` FOREIGN KEY (`origin`) REFERENCES `codes_source_origin`(`code`),
	CONSTRAINT `fk_sources_kind_codes_source_kind_code_fk` FOREIGN KEY (`kind`) REFERENCES `codes_source_kind`(`code`),
	CONSTRAINT "sources_check_1" CHECK(length(mime) > 0),
	CONSTRAINT "sources_check_2" CHECK(length(trim(name)) > 0),
	CONSTRAINT "sources_check_3" CHECK(size_bytes BETWEEN 1 AND 536870912),
	CONSTRAINT "sources_check_4" CHECK(length(sha256) = 32),
	CONSTRAINT "sources_check_5" CHECK(uri IS NULL OR length(uri) > 0)
);
--> statement-breakpoint
CREATE TABLE `citations` (
	`version_id` integer NOT NULL,
	`marker` integer NOT NULL,
	`source_id` integer,
	`source_name` text NOT NULL,
	`anchor` text NOT NULL,
	`quote` text NOT NULL,
	CONSTRAINT `citations_pk` PRIMARY KEY(`version_id`, `marker`),
	CONSTRAINT `fk_citations_version_id_message_versions_id_fk` FOREIGN KEY (`version_id`) REFERENCES `message_versions`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_citations_source_id_sources_id_fk` FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON DELETE SET NULL,
	CONSTRAINT "citations_check_1" CHECK(marker BETWEEN 1 AND 4294967295),
	CONSTRAINT "citations_check_2" CHECK(json_valid(anchor))
);
--> statement-breakpoint
CREATE TABLE `message_parts` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`message_id` integer NOT NULL,
	`ordinal` integer NOT NULL,
	`source_id` integer,
	`source_name` text NOT NULL,
	`source_kind` text NOT NULL,
	CONSTRAINT `fk_message_parts_message_id_messages_id_fk` FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_message_parts_source_id_sources_id_fk` FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_message_parts_source_kind_codes_source_kind_code_fk` FOREIGN KEY (`source_kind`) REFERENCES `codes_source_kind`(`code`),
	CONSTRAINT "message_parts_check_1" CHECK(ordinal >= 0)
);
--> statement-breakpoint
CREATE TABLE `message_versions` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`message_id` integer NOT NULL,
	`number` integer NOT NULL,
	`origin` text NOT NULL,
	`instruction` text,
	`status` text NOT NULL,
	`text` text DEFAULT '' NOT NULL,
	`based_on` integer,
	`created_at` integer NOT NULL,
	`owner_job_id` integer,
	`owner_attempt` integer,
	CONSTRAINT `fk_message_versions_message_id_messages_id_fk` FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_message_versions_origin_codes_version_origin_code_fk` FOREIGN KEY (`origin`) REFERENCES `codes_version_origin`(`code`),
	CONSTRAINT `fk_message_versions_status_codes_message_status_code_fk` FOREIGN KEY (`status`) REFERENCES `codes_message_status`(`code`),
	CONSTRAINT `fk_message_versions_based_on_message_versions_id_fk` FOREIGN KEY (`based_on`) REFERENCES `message_versions`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_message_versions_owner_job_id_jobs_id_fk` FOREIGN KEY (`owner_job_id`) REFERENCES `jobs`(`id`) ON DELETE SET NULL,
	CONSTRAINT "message_versions_check_1" CHECK(number >= 1),
	CONSTRAINT "message_versions_check_2" CHECK((origin = 'instruction') = (instruction IS NOT NULL)),
	CONSTRAINT "message_versions_check_3" CHECK(status = 'complete' OR text = ''),
	CONSTRAINT "message_versions_instruction_check" CHECK(instruction IS NULL OR (
        length(trim(instruction, char(9, 10, 11, 12, 13, 32, 160, 5760,
          8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199, 8200, 8201, 8202,
          8232, 8233, 8239, 8287, 12288, 65279))) > 0
        AND length(instruction) <= 100000
      ))
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`session_id` integer NOT NULL,
	`role` text NOT NULL,
	`reply_to` integer,
	`thread_root` integer,
	`recording_ms` integer,
	`recording_id` integer,
	`recorded_in` integer,
	`active_version_id` integer,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_messages_session_id_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_messages_role_codes_message_role_code_fk` FOREIGN KEY (`role`) REFERENCES `codes_message_role`(`code`),
	CONSTRAINT `fk_messages_reply_to_messages_id_fk` FOREIGN KEY (`reply_to`) REFERENCES `messages`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_messages_thread_root_message_parts_id_fk` FOREIGN KEY (`thread_root`) REFERENCES `message_parts`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_messages_recording_id_recordings_id_fk` FOREIGN KEY (`recording_id`) REFERENCES `recordings`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_messages_recorded_in_sources_id_fk` FOREIGN KEY (`recorded_in`) REFERENCES `sources`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_messages_active_version_id_message_versions_id_fk` FOREIGN KEY (`active_version_id`) REFERENCES `message_versions`(`id`) ON DELETE SET NULL,
	CONSTRAINT "messages_check_1" CHECK(recording_ms IS NULL OR recording_ms >= 0),
	CONSTRAINT "messages_check_2" CHECK((reply_to IS NULL) OR (role = 'assistant')),
	CONSTRAINT "messages_check_3" CHECK(recording_id IS NULL OR recording_ms IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE `recording_chunks` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`recording_id` integer NOT NULL,
	`ordinal` integer NOT NULL,
	`pcm` blob NOT NULL,
	CONSTRAINT `fk_recording_chunks_recording_id_recordings_id_fk` FOREIGN KEY (`recording_id`) REFERENCES `recordings`(`id`) ON DELETE CASCADE,
	CONSTRAINT "recording_chunks_check_1" CHECK(ordinal >= 0),
	CONSTRAINT "recording_chunks_check_2" CHECK(length(pcm) > 0 AND length(pcm) % 2 = 0)
);
--> statement-breakpoint
CREATE TABLE `recordings` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`session_id` integer NOT NULL,
	`started_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_recordings_session_id_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`project_id` integer NOT NULL,
	`title` text NOT NULL,
	`title_source` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_sessions_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_sessions_title_source_codes_title_source_code_fk` FOREIGN KEY (`title_source`) REFERENCES `codes_title_source`(`code`),
	CONSTRAINT "sessions_check_1" CHECK(length(trim(title)) > 0 AND length(title) <= 200)
);
--> statement-breakpoint
CREATE TABLE `blocks` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`document_id` integer NOT NULL,
	`ordinal` integer NOT NULL,
	`kind` text NOT NULL,
	`text` text NOT NULL,
	`anchor` text NOT NULL,
	CONSTRAINT `fk_blocks_document_id_documents_id_fk` FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_blocks_kind_codes_block_kind_code_fk` FOREIGN KEY (`kind`) REFERENCES `codes_block_kind`(`code`),
	CONSTRAINT "blocks_check_1" CHECK(ordinal >= 0),
	CONSTRAINT "blocks_check_2" CHECK(json_valid(anchor))
);
--> statement-breakpoint
CREATE TABLE `documents` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`source_id` integer,
	`extractor` text,
	`extractor_version` integer NOT NULL,
	`meta` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_documents_source_id_sources_id_fk` FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_documents_extractor_codes_extractor_kind_code_fk` FOREIGN KEY (`extractor`) REFERENCES `codes_extractor_kind`(`code`),
	CONSTRAINT "documents_check_1" CHECK(extractor_version >= 0),
	CONSTRAINT "documents_check_2" CHECK(json_valid(meta))
);
--> statement-breakpoint
CREATE TABLE `chunks` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`document_id` integer NOT NULL,
	`ordinal` integer NOT NULL,
	`first_block` integer NOT NULL,
	`last_block` integer NOT NULL,
	`anchor` text NOT NULL,
	`text` text NOT NULL,
	`content_hash` blob NOT NULL,
	CONSTRAINT `fk_chunks_document_id_documents_id_fk` FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON DELETE CASCADE,
	CONSTRAINT "chunks_check_1" CHECK(ordinal >= 0),
	CONSTRAINT "chunks_check_2" CHECK(last_block >= first_block),
	CONSTRAINT "chunks_check_3" CHECK(json_valid(anchor)),
	CONSTRAINT "chunks_check_4" CHECK(length(content_hash) = 32)
);
--> statement-breakpoint
CREATE TABLE `artifact_citations` (
	`artifact_id` integer NOT NULL,
	`marker` integer NOT NULL,
	`source_id` integer,
	`source_name` text NOT NULL,
	`anchor` text NOT NULL,
	`quote` text NOT NULL,
	CONSTRAINT `artifact_citations_pk` PRIMARY KEY(`artifact_id`, `marker`),
	CONSTRAINT `fk_artifact_citations_artifact_id_artifacts_id_fk` FOREIGN KEY (`artifact_id`) REFERENCES `artifacts`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_artifact_citations_source_id_sources_id_fk` FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON DELETE SET NULL,
	CONSTRAINT "artifact_citations_check_1" CHECK(marker BETWEEN 1 AND 4294967295),
	CONSTRAINT "artifact_citations_check_2" CHECK(json_valid(anchor))
);
--> statement-breakpoint
CREATE TABLE `artifact_note_snapshots` (
	`artifact_id` integer NOT NULL,
	`message_id` integer NOT NULL,
	`version_id` integer NOT NULL,
	CONSTRAINT `artifact_note_snapshots_pk` PRIMARY KEY(`artifact_id`, `message_id`),
	CONSTRAINT `fk_artifact_note_snapshots_artifact_id_artifacts_id_fk` FOREIGN KEY (`artifact_id`) REFERENCES `artifacts`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `artifact_sources` (
	`artifact_id` integer NOT NULL,
	`source_id` integer,
	CONSTRAINT `fk_artifact_sources_artifact_id_artifacts_id_fk` FOREIGN KEY (`artifact_id`) REFERENCES `artifacts`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_artifact_sources_source_id_sources_id_fk` FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `artifacts` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`project_id` integer NOT NULL,
	`material_id` integer,
	`practice_id` integer,
	`kind` text NOT NULL,
	`mistakes` integer DEFAULT 0 NOT NULL,
	`title` text NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`status` text NOT NULL,
	`body` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_artifacts_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_artifacts_material_id_materials_id_fk` FOREIGN KEY (`material_id`) REFERENCES `materials`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_artifacts_practice_id_practices_id_fk` FOREIGN KEY (`practice_id`) REFERENCES `practices`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_artifacts_kind_codes_artifact_kind_code_fk` FOREIGN KEY (`kind`) REFERENCES `codes_artifact_kind`(`code`),
	CONSTRAINT `fk_artifacts_status_codes_artifact_status_code_fk` FOREIGN KEY (`status`) REFERENCES `codes_artifact_status`(`code`),
	CONSTRAINT "artifacts_check_1" CHECK(mistakes IN (0, 1)),
	CONSTRAINT "artifacts_check_2" CHECK(length(trim(title)) > 0 AND length(title) <= 200),
	CONSTRAINT "artifacts_check_3" CHECK(body IS NULL OR json_valid(body)),
	CONSTRAINT "artifacts_check_4" CHECK((status = 'complete') = (body IS NOT NULL)),
	CONSTRAINT "artifacts_check_5" CHECK(practice_id IS NULL OR mistakes = 1)
);
--> statement-breakpoint
CREATE TABLE `cards` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`material_card_id` integer,
	`artifact_id` integer NOT NULL,
	`ordinal` integer NOT NULL,
	`front` text NOT NULL,
	`back` text NOT NULL,
	`stability` real DEFAULT 0 NOT NULL,
	`difficulty` real DEFAULT 0 NOT NULL,
	`reps` integer DEFAULT 0 NOT NULL,
	`lapses` integer DEFAULT 0 NOT NULL,
	`last_review` integer,
	`due` integer NOT NULL,
	`cites` text DEFAULT '[]' NOT NULL,
	`question_id` integer,
	`state` integer DEFAULT 0 NOT NULL,
	`elapsed_days` integer DEFAULT 0 NOT NULL,
	`scheduled_days` integer DEFAULT 0 NOT NULL,
	`learning_steps` integer DEFAULT 0 NOT NULL,
	CONSTRAINT `fk_cards_material_card_id_material_card_identities_id_fk` FOREIGN KEY (`material_card_id`) REFERENCES `material_card_identities`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_cards_artifact_id_artifacts_id_fk` FOREIGN KEY (`artifact_id`) REFERENCES `artifacts`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_cards_question_id_practice_questions_id_fk` FOREIGN KEY (`question_id`) REFERENCES `practice_questions`(`id`) ON DELETE SET NULL,
	CONSTRAINT "cards_check_1" CHECK(ordinal >= 0),
	CONSTRAINT "cards_check_2" CHECK(length(trim(front)) > 0),
	CONSTRAINT "cards_check_3" CHECK(length(trim(back)) > 0),
	CONSTRAINT "cards_check_4" CHECK(stability >= 0),
	CONSTRAINT "cards_check_5" CHECK(difficulty >= 0 AND difficulty <= 10),
	CONSTRAINT "cards_check_6" CHECK(reps >= 0),
	CONSTRAINT "cards_check_7" CHECK(lapses >= 0),
	CONSTRAINT "cards_check_8" CHECK(json_valid(cites)),
	CONSTRAINT "cards_state_check" CHECK(state IN (0, 1, 2, 3)),
	CONSTRAINT "cards_elapsed_days_check" CHECK(elapsed_days >= 0),
	CONSTRAINT "cards_scheduled_days_check" CHECK(scheduled_days >= 0),
	CONSTRAINT "cards_learning_steps_check" CHECK(learning_steps >= 0)
);
--> statement-breakpoint
CREATE TABLE `reviews` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`card_id` integer NOT NULL,
	`rating` text NOT NULL,
	`reviewed_at` integer NOT NULL,
	`stability` real NOT NULL,
	`difficulty` real NOT NULL,
	`elapsed_days` real NOT NULL,
	CONSTRAINT `fk_reviews_card_id_cards_id_fk` FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_reviews_rating_codes_rating_code_fk` FOREIGN KEY (`rating`) REFERENCES `codes_rating`(`code`),
	CONSTRAINT "reviews_check_1" CHECK(elapsed_days >= 0)
);
--> statement-breakpoint
CREATE TABLE `practice_questions` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`practice_id` integer NOT NULL,
	`ordinal` integer NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`body` text,
	`gist` text,
	`choice` integer,
	`answer` text,
	`verdict` text,
	`feedback` text,
	`created_at` integer NOT NULL,
	`answered_at` integer,
	`graded_at` integer,
	CONSTRAINT `fk_practice_questions_practice_id_practices_id_fk` FOREIGN KEY (`practice_id`) REFERENCES `practices`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_practice_questions_kind_codes_question_kind_code_fk` FOREIGN KEY (`kind`) REFERENCES `codes_question_kind`(`code`),
	CONSTRAINT `fk_practice_questions_status_codes_question_status_code_fk` FOREIGN KEY (`status`) REFERENCES `codes_question_status`(`code`),
	CONSTRAINT `fk_practice_questions_verdict_codes_verdict_code_fk` FOREIGN KEY (`verdict`) REFERENCES `codes_verdict`(`code`),
	CONSTRAINT "practice_questions_check_1" CHECK(ordinal >= 0),
	CONSTRAINT "practice_questions_check_2" CHECK(body IS NULL OR json_valid(body)),
	CONSTRAINT "practice_questions_check_3" CHECK(length(trim(gist)) > 0 AND length(gist) <= 200),
	CONSTRAINT "practice_questions_check_4" CHECK(choice >= 0),
	CONSTRAINT "practice_questions_check_5" CHECK(length(trim(answer)) > 0),
	CONSTRAINT "practice_questions_check_6" CHECK(length(trim(feedback)) > 0),
	CONSTRAINT "practice_questions_check_7" CHECK((body IS NULL) = (status = 'pending' OR status = 'writing')),
	CONSTRAINT "practice_questions_check_8" CHECK((gist IS NULL) = (body IS NULL)),
	CONSTRAINT "practice_questions_check_9" CHECK((answered_at IS NOT NULL) = (status = 'answered' OR status = 'graded')),
	CONSTRAINT "practice_questions_check_10" CHECK((choice IS NOT NULL) = (answered_at IS NOT NULL AND kind = 'choice')),
	CONSTRAINT "practice_questions_check_11" CHECK((answer IS NOT NULL) = (answered_at IS NOT NULL AND kind = 'open')),
	CONSTRAINT "practice_questions_check_12" CHECK((status = 'answered') <= (kind = 'open')),
	CONSTRAINT "practice_questions_check_13" CHECK((graded_at IS NOT NULL) = (status = 'graded')),
	CONSTRAINT "practice_questions_check_14" CHECK((verdict IS NOT NULL) = (status = 'graded')),
	CONSTRAINT "practice_questions_check_15" CHECK((verdict = 'partly') <= (kind = 'open')),
	CONSTRAINT "practice_questions_check_16" CHECK((feedback IS NOT NULL) = (status = 'graded' AND kind = 'open'))
);
--> statement-breakpoint
CREATE TABLE `practices` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`project_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_practices_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `question_citations` (
	`question_id` integer NOT NULL,
	`marker` integer NOT NULL,
	`source_id` integer,
	`source_name` text NOT NULL,
	`anchor` text NOT NULL,
	`quote` text NOT NULL,
	CONSTRAINT `question_citations_pk` PRIMARY KEY(`question_id`, `marker`),
	CONSTRAINT `fk_question_citations_question_id_practice_questions_id_fk` FOREIGN KEY (`question_id`) REFERENCES `practice_questions`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_question_citations_source_id_sources_id_fk` FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON DELETE SET NULL,
	CONSTRAINT "question_citations_check_1" CHECK(marker BETWEEN 1 AND 4294967295),
	CONSTRAINT "question_citations_check_2" CHECK(json_valid(anchor))
);
--> statement-breakpoint
CREATE TABLE `job_deps` (
	`job_id` integer NOT NULL,
	`depends_on` integer NOT NULL,
	CONSTRAINT `job_deps_pk` PRIMARY KEY(`job_id`, `depends_on`),
	CONSTRAINT `fk_job_deps_job_id_jobs_id_fk` FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_job_deps_depends_on_jobs_id_fk` FOREIGN KEY (`depends_on`) REFERENCES `jobs`(`id`) ON DELETE CASCADE,
	CONSTRAINT "job_deps_distinct_check" CHECK(job_id != depends_on)
);
--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`kind` text NOT NULL,
	`source_id` integer,
	`document_id` integer,
	`session_id` integer,
	`message_id` integer,
	`artifact_id` integer,
	`question_id` integer,
	`args` text,
	`dedupe_key` text NOT NULL,
	`status` text NOT NULL,
	`waiting_for` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`run_after` integer DEFAULT 0 NOT NULL,
	`error_kind` text,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	CONSTRAINT `fk_jobs_kind_codes_job_kind_code_fk` FOREIGN KEY (`kind`) REFERENCES `codes_job_kind`(`code`),
	CONSTRAINT `fk_jobs_source_id_sources_id_fk` FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_jobs_document_id_documents_id_fk` FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_jobs_session_id_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_jobs_message_id_messages_id_fk` FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_jobs_artifact_id_artifacts_id_fk` FOREIGN KEY (`artifact_id`) REFERENCES `artifacts`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_jobs_question_id_practice_questions_id_fk` FOREIGN KEY (`question_id`) REFERENCES `practice_questions`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_jobs_status_codes_job_status_code_fk` FOREIGN KEY (`status`) REFERENCES `codes_job_status`(`code`),
	CONSTRAINT `fk_jobs_waiting_for_codes_requirement_code_fk` FOREIGN KEY (`waiting_for`) REFERENCES `codes_requirement`(`code`),
	CONSTRAINT `fk_jobs_error_kind_codes_error_kind_code_fk` FOREIGN KEY (`error_kind`) REFERENCES `codes_error_kind`(`code`),
	CONSTRAINT "jobs_check_1" CHECK(args IS NULL OR json_valid(args)),
	CONSTRAINT "jobs_check_2" CHECK(attempts >= 0),
	CONSTRAINT "jobs_check_3" CHECK((source_id IS NOT NULL) + (document_id IS NOT NULL) + (session_id IS NOT NULL)
        + (message_id IS NOT NULL) + (artifact_id IS NOT NULL) + (question_id IS NOT NULL) = 1),
	CONSTRAINT "jobs_check_4" CHECK((error IS NULL) = (error_kind IS NULL)),
	CONSTRAINT "jobs_check_5" CHECK((status = 'waiting') = (waiting_for IS NOT NULL)),
	CONSTRAINT "jobs_kind_target_check" CHECK((kind IN ('fetch', 'extract') AND source_id IS NOT NULL)
        OR (kind = 'index' AND document_id IS NOT NULL)
        OR (kind = 'title' AND session_id IS NOT NULL)
        OR (kind IN ('reply', 'rewrite') AND message_id IS NOT NULL)
        OR (kind = 'artifact' AND artifact_id IS NOT NULL)
        OR (kind IN ('question', 'grade') AND question_id IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE `codes_artifact_kind` (
	`code` text PRIMARY KEY
);
--> statement-breakpoint
CREATE TABLE `codes_artifact_status` (
	`code` text PRIMARY KEY
);
--> statement-breakpoint
CREATE TABLE `codes_block_kind` (
	`code` text PRIMARY KEY
);
--> statement-breakpoint
CREATE TABLE `codes_error_kind` (
	`code` text PRIMARY KEY
);
--> statement-breakpoint
CREATE TABLE `codes_extractor_kind` (
	`code` text PRIMARY KEY
);
--> statement-breakpoint
CREATE TABLE `codes_job_kind` (
	`code` text PRIMARY KEY
);
--> statement-breakpoint
CREATE TABLE `codes_job_status` (
	`code` text PRIMARY KEY
);
--> statement-breakpoint
CREATE TABLE `codes_message_role` (
	`code` text PRIMARY KEY
);
--> statement-breakpoint
CREATE TABLE `codes_message_status` (
	`code` text PRIMARY KEY
);
--> statement-breakpoint
CREATE TABLE `codes_question_kind` (
	`code` text PRIMARY KEY
);
--> statement-breakpoint
CREATE TABLE `codes_question_status` (
	`code` text PRIMARY KEY
);
--> statement-breakpoint
CREATE TABLE `codes_rating` (
	`code` text PRIMARY KEY
);
--> statement-breakpoint
CREATE TABLE `codes_requirement` (
	`code` text PRIMARY KEY
);
--> statement-breakpoint
CREATE TABLE `codes_source_kind` (
	`code` text PRIMARY KEY
);
--> statement-breakpoint
CREATE TABLE `codes_source_origin` (
	`code` text PRIMARY KEY
);
--> statement-breakpoint
CREATE TABLE `codes_title_source` (
	`code` text PRIMARY KEY
);
--> statement-breakpoint
CREATE TABLE `codes_verdict` (
	`code` text PRIMARY KEY
);
--> statement-breakpoint
CREATE TABLE `codes_version_origin` (
	`code` text PRIMARY KEY
);
--> statement-breakpoint
CREATE TABLE `material_version_inputs` (
	`version_id` integer NOT NULL,
	`input_version_id` integer NOT NULL,
	`project_id` integer NOT NULL,
	CONSTRAINT `material_version_inputs_pk` PRIMARY KEY(`version_id`, `input_version_id`),
	CONSTRAINT `fk_material_version_inputs_version_id_project_id_material_versions_id_project_id_fk` FOREIGN KEY (`version_id`,`project_id`) REFERENCES `material_versions`(`id`,`project_id`) ON DELETE CASCADE,
	CONSTRAINT `fk_material_version_inputs_input_version_id_project_id_material_versions_id_project_id_fk` FOREIGN KEY (`input_version_id`,`project_id`) REFERENCES `material_versions`(`id`,`project_id`) ON DELETE CASCADE,
	CONSTRAINT "material_version_inputs_distinct_check" CHECK(version_id != input_version_id)
);
--> statement-breakpoint
CREATE TABLE `material_version_parents` (
	`version_id` integer NOT NULL,
	`parent_version_id` integer NOT NULL,
	`material_id` integer NOT NULL,
	CONSTRAINT `material_version_parents_pk` PRIMARY KEY(`version_id`, `parent_version_id`),
	CONSTRAINT `fk_material_version_parents_version_id_material_id_material_versions_id_material_id_fk` FOREIGN KEY (`version_id`,`material_id`) REFERENCES `material_versions`(`id`,`material_id`) ON DELETE CASCADE,
	CONSTRAINT `fk_material_version_parents_parent_version_id_material_id_material_versions_id_material_id_fk` FOREIGN KEY (`parent_version_id`,`material_id`) REFERENCES `material_versions`(`id`,`material_id`) ON DELETE CASCADE,
	CONSTRAINT "material_version_parents_distinct_check" CHECK(version_id != parent_version_id)
);
--> statement-breakpoint
CREATE TABLE `material_versions` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`material_id` integer NOT NULL,
	`project_id` integer NOT NULL,
	`kind` text NOT NULL,
	`number` integer NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`operation` text DEFAULT 'original' NOT NULL,
	`creator` text DEFAULT 'user' NOT NULL,
	`instruction` text,
	`language` text,
	`created_at` integer NOT NULL,
	`published_at` integer,
	CONSTRAINT `fk_material_versions_material_id_project_id_kind_materials_id_project_id_kind_fk` FOREIGN KEY (`material_id`,`project_id`,`kind`) REFERENCES `materials`(`id`,`project_id`,`kind`) ON DELETE CASCADE,
	CONSTRAINT "material_versions_identity_check" CHECK(id > 0 AND typeof(number) = 'integer' AND number > 0),
	CONSTRAINT "material_versions_status_check" CHECK(status IN ('draft','published') AND ((status = 'published') = (published_at IS NOT NULL))),
	CONSTRAINT "material_versions_operation_check" CHECK(operation IN ('original','edit','summarize','translate','generate','extract','transcribe')),
	CONSTRAINT "material_versions_creator_check" CHECK(creator IN ('user','agent','import')),
	CONSTRAINT "material_versions_language_check" CHECK(language IS NULL OR length(trim(language)) BETWEEN 1 AND 64),
	CONSTRAINT "material_versions_instruction_check" CHECK(instruction IS NULL OR length(trim(instruction)) BETWEEN 1 AND 100000),
	CONSTRAINT "material_versions_times_check" CHECK(typeof(created_at) = 'integer' AND created_at >= 0 AND (published_at IS NULL OR (typeof(published_at) = 'integer' AND published_at >= created_at)))
);
--> statement-breakpoint
CREATE TABLE `materials` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`project_id` integer NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`archived_at` integer,
	CONSTRAINT `fk_materials_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
	CONSTRAINT "materials_kind_check" CHECK(kind IN ('file','audio','video','image','link','document','diagram','quiz','flashcards')),
	CONSTRAINT "materials_title_check" CHECK(length(trim(title)) BETWEEN 1 AND 200),
	CONSTRAINT "materials_times_check" CHECK(id > 0 AND typeof(created_at) = 'integer' AND typeof(updated_at) = 'integer' AND created_at >= 0 AND updated_at >= created_at AND (archived_at IS NULL OR (typeof(archived_at) = 'integer' AND archived_at >= created_at)))
);
--> statement-breakpoint
CREATE TABLE `session_materials` (
	`session_id` integer NOT NULL,
	`material_id` integer NOT NULL,
	`project_id` integer NOT NULL,
	`position` integer NOT NULL,
	CONSTRAINT `session_materials_pk` PRIMARY KEY(`session_id`, `material_id`),
	CONSTRAINT `fk_session_materials_session_id_project_id_sessions_id_project_id_fk` FOREIGN KEY (`session_id`,`project_id`) REFERENCES `sessions`(`id`,`project_id`) ON DELETE CASCADE,
	CONSTRAINT `fk_session_materials_material_id_project_id_materials_id_project_id_fk` FOREIGN KEY (`material_id`,`project_id`) REFERENCES `materials`(`id`,`project_id`) ON DELETE CASCADE,
	CONSTRAINT "session_materials_position_check" CHECK(typeof(position) = 'integer' AND position >= 0)
);
--> statement-breakpoint
CREATE TABLE `material_audio_versions` (
	`version_id` integer PRIMARY KEY,
	`kind` text DEFAULT 'audio' NOT NULL,
	`source_id` integer NOT NULL,
	`duration_ms` integer,
	`sample_rate` integer,
	`channels` integer,
	CONSTRAINT `fk_material_audio_versions_source_id_sources_id_fk` FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`),
	CONSTRAINT `fk_material_audio_versions_version_id_kind_material_versions_id_kind_fk` FOREIGN KEY (`version_id`,`kind`) REFERENCES `material_versions`(`id`,`kind`) ON DELETE CASCADE,
	CONSTRAINT "payload_kind_check" CHECK("kind" = 'audio'),
	CONSTRAINT "material_audio_duration_check" CHECK(duration_ms IS NULL OR (typeof(duration_ms) = 'integer' AND duration_ms >= 0)),
	CONSTRAINT "material_audio_sample_rate_check" CHECK(sample_rate IS NULL OR (typeof(sample_rate) = 'integer' AND sample_rate > 0)),
	CONSTRAINT "material_audio_channels_check" CHECK(channels IS NULL OR (typeof(channels) = 'integer' AND channels > 0))
);
--> statement-breakpoint
CREATE TABLE `material_diagram_versions` (
	`version_id` integer PRIMARY KEY,
	`kind` text DEFAULT 'diagram' NOT NULL,
	`format` text NOT NULL,
	`payload` text NOT NULL,
	CONSTRAINT `fk_material_diagram_versions_version_id_kind_material_versions_id_kind_fk` FOREIGN KEY (`version_id`,`kind`) REFERENCES `material_versions`(`id`,`kind`) ON DELETE CASCADE,
	CONSTRAINT "payload_kind_check" CHECK("kind" = 'diagram'),
	CONSTRAINT "material_diagram_format_check" CHECK(format IN ('mermaid')),
	CONSTRAINT "material_diagram_payload_check" CHECK(length(trim(payload)) > 0)
);
--> statement-breakpoint
CREATE TABLE `material_document_versions` (
	`version_id` integer PRIMARY KEY,
	`kind` text DEFAULT 'document' NOT NULL,
	`document_id` integer NOT NULL,
	CONSTRAINT `fk_material_document_versions_document_id_documents_id_fk` FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`),
	CONSTRAINT `fk_material_document_versions_version_id_kind_material_versions_id_kind_fk` FOREIGN KEY (`version_id`,`kind`) REFERENCES `material_versions`(`id`,`kind`) ON DELETE CASCADE,
	CONSTRAINT "payload_kind_check" CHECK("kind" = 'document')
);
--> statement-breakpoint
CREATE TABLE `material_file_versions` (
	`version_id` integer PRIMARY KEY,
	`kind` text DEFAULT 'file' NOT NULL,
	`source_id` integer NOT NULL,
	CONSTRAINT `fk_material_file_versions_source_id_sources_id_fk` FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`),
	CONSTRAINT `fk_material_file_versions_version_id_kind_material_versions_id_kind_fk` FOREIGN KEY (`version_id`,`kind`) REFERENCES `material_versions`(`id`,`kind`) ON DELETE CASCADE,
	CONSTRAINT "payload_kind_check" CHECK("kind" = 'file')
);
--> statement-breakpoint
CREATE TABLE `material_image_versions` (
	`version_id` integer PRIMARY KEY,
	`kind` text DEFAULT 'image' NOT NULL,
	`source_id` integer NOT NULL,
	`width` integer,
	`height` integer,
	CONSTRAINT `fk_material_image_versions_source_id_sources_id_fk` FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`),
	CONSTRAINT `fk_material_image_versions_version_id_kind_material_versions_id_kind_fk` FOREIGN KEY (`version_id`,`kind`) REFERENCES `material_versions`(`id`,`kind`) ON DELETE CASCADE,
	CONSTRAINT "payload_kind_check" CHECK("kind" = 'image'),
	CONSTRAINT "material_image_dimensions_check" CHECK((width IS NULL AND height IS NULL) OR (width IS NOT NULL AND height IS NOT NULL AND typeof(width) = 'integer' AND typeof(height) = 'integer' AND width > 0 AND height > 0))
);
--> statement-breakpoint
CREATE TABLE `material_link_versions` (
	`version_id` integer PRIMARY KEY,
	`kind` text DEFAULT 'link' NOT NULL,
	`source_id` integer NOT NULL,
	CONSTRAINT `fk_material_link_versions_source_id_sources_id_fk` FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`),
	CONSTRAINT `fk_material_link_versions_version_id_kind_material_versions_id_kind_fk` FOREIGN KEY (`version_id`,`kind`) REFERENCES `material_versions`(`id`,`kind`) ON DELETE CASCADE,
	CONSTRAINT "payload_kind_check" CHECK("kind" = 'link')
);
--> statement-breakpoint
CREATE TABLE `material_version_citations` (
	`version_id` integer NOT NULL,
	`marker` integer NOT NULL,
	`input_version_id` integer NOT NULL,
	`anchor` text NOT NULL,
	`quote` text NOT NULL,
	CONSTRAINT `fk_material_version_citations_version_id_input_version_id_material_version_inputs_version_id_input_version_id_fk` FOREIGN KEY (`version_id`,`input_version_id`) REFERENCES `material_version_inputs`(`version_id`,`input_version_id`) ON DELETE CASCADE,
	CONSTRAINT "material_version_citations_marker_check" CHECK(typeof(marker) = 'integer' AND marker BETWEEN 1 AND 4294967295),
	CONSTRAINT "material_version_citations_anchor_check" CHECK(CASE WHEN json_valid("anchor") THEN coalesce(
    json_type("anchor") = 'object' AND CASE json_extract("anchor", '$.type')
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
	CONSTRAINT "material_version_citations_quote_check" CHECK(length(trim(quote)) > 0)
);
--> statement-breakpoint
CREATE TABLE `material_video_versions` (
	`version_id` integer PRIMARY KEY,
	`kind` text DEFAULT 'video' NOT NULL,
	`source_id` integer NOT NULL,
	`duration_ms` integer,
	`width` integer,
	`height` integer,
	CONSTRAINT `fk_material_video_versions_source_id_sources_id_fk` FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`),
	CONSTRAINT `fk_material_video_versions_version_id_kind_material_versions_id_kind_fk` FOREIGN KEY (`version_id`,`kind`) REFERENCES `material_versions`(`id`,`kind`) ON DELETE CASCADE,
	CONSTRAINT "payload_kind_check" CHECK("kind" = 'video'),
	CONSTRAINT "material_video_duration_check" CHECK(duration_ms IS NULL OR (typeof(duration_ms) = 'integer' AND duration_ms >= 0)),
	CONSTRAINT "material_video_dimensions_check" CHECK((width IS NULL AND height IS NULL) OR (width IS NOT NULL AND height IS NOT NULL AND typeof(width) = 'integer' AND typeof(height) = 'integer' AND width > 0 AND height > 0))
);
--> statement-breakpoint
CREATE TABLE `material_card_identities` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`material_id` integer NOT NULL,
	`kind` text DEFAULT 'flashcards' NOT NULL,
	CONSTRAINT `fk_material_card_identities_material_id_kind_materials_id_kind_fk` FOREIGN KEY (`material_id`,`kind`) REFERENCES `materials`(`id`,`kind`) ON UPDATE RESTRICT ON DELETE CASCADE,
	CONSTRAINT "material_card_identities_kind" CHECK(kind = 'flashcards')
);
--> statement-breakpoint
CREATE TABLE `material_card_reviews` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`card_id` integer NOT NULL,
	`version_id` integer NOT NULL,
	`reviewed_at` integer NOT NULL,
	`rating` text NOT NULL,
	`elapsed_days` real NOT NULL,
	CONSTRAINT `fk_material_card_reviews_version_id_card_id_material_flashcard_entries_version_id_card_id_fk` FOREIGN KEY (`version_id`,`card_id`) REFERENCES `material_flashcard_entries`(`version_id`,`card_id`) ON UPDATE RESTRICT ON DELETE CASCADE,
	CONSTRAINT "material_card_reviews_values" CHECK(typeof(reviewed_at) = 'integer' AND reviewed_at >= 0 AND rating IN ('again','hard','good','easy') AND elapsed_days >= 0)
);
--> statement-breakpoint
CREATE TABLE `material_card_schedules` (
	`card_id` integer PRIMARY KEY,
	`due` integer NOT NULL,
	`last_review` integer,
	`elapsed_days` integer DEFAULT 0 NOT NULL,
	`scheduled_days` integer DEFAULT 0 NOT NULL,
	`learning_steps` integer DEFAULT 0 NOT NULL,
	`state` text NOT NULL,
	`stability` real NOT NULL,
	`difficulty` real NOT NULL,
	`reps` integer NOT NULL,
	`lapses` integer NOT NULL,
	CONSTRAINT `fk_material_card_schedules_card_id_material_card_identities_id_fk` FOREIGN KEY (`card_id`) REFERENCES `material_card_identities`(`id`) ON UPDATE RESTRICT ON DELETE CASCADE,
	CONSTRAINT "material_card_schedules_values" CHECK(typeof(due) = 'integer' AND due >= 0 AND state IN ('new','learning','review','relearning') AND stability >= 0 AND stability <= 36500 AND difficulty BETWEEN 1 AND 10 AND typeof(reps) = 'integer' AND typeof(lapses) = 'integer' AND reps >= 0 AND lapses BETWEEN 0 AND reps AND (last_review IS NULL OR (typeof(last_review) = 'integer' AND last_review >= 0)) AND typeof(elapsed_days) = 'integer' AND elapsed_days >= 0 AND typeof(scheduled_days) = 'integer' AND scheduled_days >= 0 AND typeof(learning_steps) = 'integer' AND learning_steps >= 0)
);
--> statement-breakpoint
CREATE TABLE `material_flashcard_entries` (
	`version_id` integer NOT NULL,
	`material_id` integer NOT NULL,
	`card_id` integer NOT NULL,
	`position` integer NOT NULL,
	`front` text NOT NULL,
	`back` text NOT NULL,
	CONSTRAINT `material_flashcard_entries_pk` PRIMARY KEY(`version_id`, `card_id`),
	CONSTRAINT `fk_material_flashcard_entries_version_id_material_id_material_flashcard_versions_version_id_material_id_fk` FOREIGN KEY (`version_id`,`material_id`) REFERENCES `material_flashcard_versions`(`version_id`,`material_id`) ON UPDATE RESTRICT ON DELETE CASCADE,
	CONSTRAINT `fk_material_flashcard_entries_card_id_material_id_material_card_identities_id_material_id_fk` FOREIGN KEY (`card_id`,`material_id`) REFERENCES `material_card_identities`(`id`,`material_id`) ON UPDATE RESTRICT ON DELETE CASCADE,
	CONSTRAINT "material_flashcard_entries_values" CHECK(typeof(position) = 'integer' AND typeof(position) = 'integer' AND position >= 0 AND length(trim(front)) > 0 AND length(trim(back)) > 0)
);
--> statement-breakpoint
CREATE TABLE `material_flashcard_versions` (
	`version_id` integer PRIMARY KEY,
	`material_id` integer NOT NULL,
	`kind` text DEFAULT 'flashcards' NOT NULL,
	CONSTRAINT `fk_material_flashcard_versions_version_id_material_id_kind_material_versions_id_material_id_kind_fk` FOREIGN KEY (`version_id`,`material_id`,`kind`) REFERENCES `material_versions`(`id`,`material_id`,`kind`) ON UPDATE RESTRICT ON DELETE CASCADE,
	CONSTRAINT "material_flashcard_versions_kind" CHECK(kind = 'flashcards')
);
--> statement-breakpoint
CREATE TABLE `material_quiz_attempts` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`version_id` integer NOT NULL,
	`status` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	CONSTRAINT `fk_material_quiz_attempts_version_id_material_quiz_versions_version_id_fk` FOREIGN KEY (`version_id`) REFERENCES `material_quiz_versions`(`version_id`) ON UPDATE RESTRICT ON DELETE CASCADE,
	CONSTRAINT "material_quiz_attempts_values" CHECK(status IN ('in_progress','completed') AND typeof(started_at) = 'integer' AND started_at >= 0 AND (finished_at IS NULL OR (typeof(finished_at) = 'integer' AND finished_at >= started_at)) AND ((status = 'completed' AND finished_at IS NOT NULL) OR (status = 'in_progress' AND finished_at IS NULL)))
);
--> statement-breakpoint
CREATE TABLE `material_quiz_choices` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`question_id` integer NOT NULL,
	`question_kind` text NOT NULL,
	`position` integer NOT NULL,
	`text` text NOT NULL,
	`is_correct` integer DEFAULT false NOT NULL,
	CONSTRAINT `fk_material_quiz_choices_question_id_question_kind_material_quiz_questions_id_kind_fk` FOREIGN KEY (`question_id`,`question_kind`) REFERENCES `material_quiz_questions`(`id`,`kind`) ON UPDATE RESTRICT ON DELETE CASCADE,
	CONSTRAINT "material_quiz_choices_values" CHECK(question_kind IN ('single_choice','multiple_choice') AND typeof(position) = 'integer' AND position >= 0 AND length(trim(text)) > 0 AND is_correct IN (0,1))
);
--> statement-breakpoint
CREATE TABLE `material_quiz_open_answers` (
	`question_id` integer PRIMARY KEY,
	`kind` text DEFAULT 'open' NOT NULL,
	`reference_answer` text NOT NULL,
	CONSTRAINT `fk_material_quiz_open_answers_question_id_kind_material_quiz_questions_id_kind_fk` FOREIGN KEY (`question_id`,`kind`) REFERENCES `material_quiz_questions`(`id`,`kind`) ON UPDATE RESTRICT ON DELETE CASCADE,
	CONSTRAINT "material_quiz_open_answers_values" CHECK(kind = 'open' AND length(trim(reference_answer)) > 0)
);
--> statement-breakpoint
CREATE TABLE `material_quiz_questions` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`version_id` integer NOT NULL,
	`position` integer NOT NULL,
	`kind` text NOT NULL,
	`prompt` text NOT NULL,
	`explanation` text NOT NULL,
	CONSTRAINT `fk_material_quiz_questions_version_id_material_quiz_versions_version_id_fk` FOREIGN KEY (`version_id`) REFERENCES `material_quiz_versions`(`version_id`) ON UPDATE RESTRICT ON DELETE CASCADE,
	CONSTRAINT "material_quiz_questions_values" CHECK(typeof(position) = 'integer' AND typeof(position) = 'integer' AND position >= 0 AND kind IN ('single_choice','multiple_choice','open') AND length(trim(prompt)) > 0 AND length(trim(explanation)) > 0)
);
--> statement-breakpoint
CREATE TABLE `material_quiz_responses` (
	`attempt_id` integer NOT NULL,
	`version_id` integer NOT NULL,
	`question_id` integer NOT NULL,
	`question_kind` text NOT NULL,
	`answer` text,
	`score` real,
	`feedback` text,
	CONSTRAINT `material_quiz_responses_pk` PRIMARY KEY(`attempt_id`, `question_id`),
	CONSTRAINT `fk_material_quiz_responses_attempt_id_version_id_material_quiz_attempts_id_version_id_fk` FOREIGN KEY (`attempt_id`,`version_id`) REFERENCES `material_quiz_attempts`(`id`,`version_id`) ON UPDATE RESTRICT ON DELETE CASCADE,
	CONSTRAINT `fk_material_quiz_responses_question_id_version_id_material_quiz_questions_id_version_id_fk` FOREIGN KEY (`question_id`,`version_id`) REFERENCES `material_quiz_questions`(`id`,`version_id`) ON UPDATE RESTRICT ON DELETE CASCADE,
	CONSTRAINT `fk_material_quiz_responses_question_id_question_kind_material_quiz_questions_id_kind_fk` FOREIGN KEY (`question_id`,`question_kind`) REFERENCES `material_quiz_questions`(`id`,`kind`) ON UPDATE RESTRICT ON DELETE CASCADE,
	CONSTRAINT "material_quiz_responses_values" CHECK(question_kind IN ('single_choice','multiple_choice','open') AND (score IS NULL OR score BETWEEN 0 AND 1) AND ((question_kind = 'open' AND answer IS NOT NULL AND length(trim(answer)) > 0) OR (question_kind IN ('single_choice','multiple_choice') AND answer IS NULL)))
);
--> statement-breakpoint
CREATE TABLE `material_quiz_selections` (
	`attempt_id` integer NOT NULL,
	`question_id` integer NOT NULL,
	`choice_id` integer NOT NULL,
	CONSTRAINT `material_quiz_selections_pk` PRIMARY KEY(`attempt_id`, `question_id`, `choice_id`),
	CONSTRAINT `fk_material_quiz_selections_attempt_id_question_id_material_quiz_responses_attempt_id_question_id_fk` FOREIGN KEY (`attempt_id`,`question_id`) REFERENCES `material_quiz_responses`(`attempt_id`,`question_id`) ON UPDATE RESTRICT ON DELETE CASCADE,
	CONSTRAINT `fk_material_quiz_selections_choice_id_question_id_material_quiz_choices_id_question_id_fk` FOREIGN KEY (`choice_id`,`question_id`) REFERENCES `material_quiz_choices`(`id`,`question_id`) ON UPDATE RESTRICT ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `material_quiz_versions` (
	`version_id` integer PRIMARY KEY,
	`kind` text DEFAULT 'quiz' NOT NULL,
	CONSTRAINT `fk_material_quiz_versions_version_id_kind_material_versions_id_kind_fk` FOREIGN KEY (`version_id`,`kind`) REFERENCES `material_versions`(`id`,`kind`) ON UPDATE RESTRICT ON DELETE CASCADE,
	CONSTRAINT "material_quiz_versions_kind" CHECK(kind = 'quiz')
);
--> statement-breakpoint
CREATE INDEX `sources_sha256_idx` ON `sources` (`sha256`);--> statement-breakpoint
CREATE INDEX `sources_project_idx` ON `sources` (`project_id`);--> statement-breakpoint
CREATE INDEX `citations_source_idx` ON `citations` (`source_id`);--> statement-breakpoint
CREATE INDEX `message_parts_source_idx` ON `message_parts` (`source_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `message_parts_message_id_ordinal_unique` ON `message_parts` (`message_id`,`ordinal`);--> statement-breakpoint
CREATE UNIQUE INDEX `message_versions_unfinished_idx` ON `message_versions` (`message_id`) WHERE status != 'complete';--> statement-breakpoint
CREATE INDEX `message_versions_based_on_idx` ON `message_versions` (`based_on`) WHERE based_on IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `message_versions_message_id_number_unique` ON `message_versions` (`message_id`,`number`);--> statement-breakpoint
CREATE INDEX `messages_thread_idx` ON `messages` (`thread_root`,`id`) WHERE thread_root IS NOT NULL;--> statement-breakpoint
CREATE INDEX `messages_session_idx` ON `messages` (`session_id`,`id`);--> statement-breakpoint
CREATE INDEX `messages_recording_idx` ON `messages` (`recording_id`) WHERE recording_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX `messages_active_version_idx` ON `messages` (`active_version_id`) WHERE active_version_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `recording_chunks_recording_id_ordinal_unique` ON `recording_chunks` (`recording_id`,`ordinal`);--> statement-breakpoint
CREATE INDEX `recordings_session_idx` ON `recordings` (`session_id`);--> statement-breakpoint
CREATE INDEX `sessions_project_idx` ON `sessions` (`project_id`,"updated_at" desc);--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_id_project_unique` ON `sessions` (`id`,`project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `blocks_document_id_ordinal_unique` ON `blocks` (`document_id`,`ordinal`);--> statement-breakpoint
CREATE INDEX `documents_source_id_idx` ON `documents` (`source_id`,`id`);--> statement-breakpoint
CREATE INDEX `chunks_content_hash_idx` ON `chunks` (`content_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `chunks_document_id_ordinal_unique` ON `chunks` (`document_id`,`ordinal`);--> statement-breakpoint
CREATE INDEX `artifact_citations_source_idx` ON `artifact_citations` (`source_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `artifact_sources_unique_idx` ON `artifact_sources` (`artifact_id`,`source_id`) WHERE source_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX `artifact_sources_source_idx` ON `artifact_sources` (`source_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `artifacts_update_idx` ON `artifacts` (`project_id`,`kind`) WHERE mistakes = 0 AND status != 'complete';--> statement-breakpoint
CREATE INDEX `artifacts_material_idx` ON `artifacts` (`material_id`);--> statement-breakpoint
CREATE INDEX `artifacts_project_idx` ON `artifacts` (`project_id`,"id" desc);--> statement-breakpoint
CREATE UNIQUE INDEX `artifacts_piece_idx` ON `artifacts` (`project_id`,`kind`) WHERE mistakes = 0 AND status = 'complete';--> statement-breakpoint
CREATE UNIQUE INDEX `artifacts_practice_id_unique` ON `artifacts` (`practice_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `cards_question_idx` ON `cards` (`question_id`);--> statement-breakpoint
CREATE INDEX `cards_material_card_idx` ON `cards` (`material_card_id`);--> statement-breakpoint
CREATE INDEX `cards_due_idx` ON `cards` (`due`);--> statement-breakpoint
CREATE UNIQUE INDEX `cards_artifact_id_ordinal_unique` ON `cards` (`artifact_id`,`ordinal`);--> statement-breakpoint
CREATE INDEX `reviews_card_idx` ON `reviews` (`card_id`,`reviewed_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `practice_questions_practice_id_ordinal_unique` ON `practice_questions` (`practice_id`,`ordinal`);--> statement-breakpoint
CREATE INDEX `practices_updated_idx` ON `practices` ("updated_at" desc,"id" desc);--> statement-breakpoint
CREATE UNIQUE INDEX `practices_project_id_unique` ON `practices` (`project_id`);--> statement-breakpoint
CREATE INDEX `question_citations_source_idx` ON `question_citations` (`source_id`);--> statement-breakpoint
CREATE INDEX `job_deps_depends_on_idx` ON `job_deps` (`depends_on`);--> statement-breakpoint
CREATE INDEX `jobs_source_idx` ON `jobs` (`source_id`);--> statement-breakpoint
CREATE INDEX `jobs_session_idx` ON `jobs` (`session_id`);--> statement-breakpoint
CREATE INDEX `jobs_question_idx` ON `jobs` (`question_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_pending_dedupe_idx` ON `jobs` (`dedupe_key`) WHERE status IN ('blocked', 'queued', 'waiting');--> statement-breakpoint
CREATE INDEX `jobs_message_idx` ON `jobs` (`message_id`);--> statement-breakpoint
CREATE INDEX `jobs_document_idx` ON `jobs` (`document_id`);--> statement-breakpoint
CREATE INDEX `jobs_claim_idx` ON `jobs` (`status`,`kind`,`run_after`,`id`);--> statement-breakpoint
CREATE INDEX `jobs_artifact_idx` ON `jobs` (`artifact_id`);--> statement-breakpoint
CREATE INDEX `material_version_inputs_input_idx` ON `material_version_inputs` (`input_version_id`,`version_id`);--> statement-breakpoint
CREATE INDEX `material_version_inputs_project_idx` ON `material_version_inputs` (`project_id`);--> statement-breakpoint
CREATE INDEX `material_version_parents_parent_idx` ON `material_version_parents` (`parent_version_id`,`version_id`);--> statement-breakpoint
CREATE INDEX `material_version_parents_material_idx` ON `material_version_parents` (`material_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `material_versions_number_unique` ON `material_versions` (`material_id`,`number`);--> statement-breakpoint
CREATE UNIQUE INDEX `material_versions_id_kind_unique` ON `material_versions` (`id`,`kind`);--> statement-breakpoint
CREATE UNIQUE INDEX `material_versions_id_material_kind_unique` ON `material_versions` (`id`,`material_id`,`kind`);--> statement-breakpoint
CREATE UNIQUE INDEX `material_versions_id_material_unique` ON `material_versions` (`id`,`material_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `material_versions_id_project_unique` ON `material_versions` (`id`,`project_id`);--> statement-breakpoint
CREATE INDEX `material_versions_heads_idx` ON `material_versions` (`material_id`,`status`,"number" desc);--> statement-breakpoint
CREATE INDEX `material_versions_project_idx` ON `material_versions` (`project_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `materials_id_kind_unique` ON `materials` (`id`,`kind`);--> statement-breakpoint
CREATE UNIQUE INDEX `materials_id_project_kind_unique` ON `materials` (`id`,`project_id`,`kind`);--> statement-breakpoint
CREATE UNIQUE INDEX `materials_id_project_unique` ON `materials` (`id`,`project_id`);--> statement-breakpoint
CREATE INDEX `materials_project_updated_idx` ON `materials` (`project_id`,"updated_at" desc,"id" desc);--> statement-breakpoint
CREATE UNIQUE INDEX `session_materials_position_unique` ON `session_materials` (`session_id`,`position`);--> statement-breakpoint
CREATE INDEX `session_materials_material_idx` ON `session_materials` (`material_id`,`session_id`);--> statement-breakpoint
CREATE INDEX `session_materials_project_idx` ON `session_materials` (`project_id`);--> statement-breakpoint
CREATE INDEX `material_audio_versions_source_idx` ON `material_audio_versions` (`source_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `material_document_versions_document_unique` ON `material_document_versions` (`document_id`);--> statement-breakpoint
CREATE INDEX `material_file_versions_source_idx` ON `material_file_versions` (`source_id`);--> statement-breakpoint
CREATE INDEX `material_image_versions_source_idx` ON `material_image_versions` (`source_id`);--> statement-breakpoint
CREATE INDEX `material_link_versions_source_idx` ON `material_link_versions` (`source_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `material_version_citations_marker_unique` ON `material_version_citations` (`version_id`,`marker`);--> statement-breakpoint
CREATE INDEX `material_version_citations_input_idx` ON `material_version_citations` (`input_version_id`);--> statement-breakpoint
CREATE INDEX `material_video_versions_source_idx` ON `material_video_versions` (`source_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `material_card_identities_material` ON `material_card_identities` (`id`,`material_id`);--> statement-breakpoint
CREATE INDEX `material_card_identities_material_fk` ON `material_card_identities` (`material_id`,`kind`);--> statement-breakpoint
CREATE INDEX `material_card_reviews_entry_fk` ON `material_card_reviews` (`version_id`,`card_id`);--> statement-breakpoint
CREATE INDEX `material_card_reviews_card_time` ON `material_card_reviews` (`card_id`,`reviewed_at`);--> statement-breakpoint
CREATE INDEX `material_card_schedules_due` ON `material_card_schedules` (`due`);--> statement-breakpoint
CREATE UNIQUE INDEX `material_flashcard_entries_position` ON `material_flashcard_entries` (`version_id`,`position`);--> statement-breakpoint
CREATE INDEX `material_flashcard_entries_card_fk` ON `material_flashcard_entries` (`card_id`,`material_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `material_flashcard_versions_material` ON `material_flashcard_versions` (`version_id`,`material_id`);--> statement-breakpoint
CREATE INDEX `material_flashcard_versions_material_fk` ON `material_flashcard_versions` (`material_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `material_quiz_attempts_version` ON `material_quiz_attempts` (`id`,`version_id`);--> statement-breakpoint
CREATE INDEX `material_quiz_attempts_version_fk` ON `material_quiz_attempts` (`version_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `material_quiz_choices_position` ON `material_quiz_choices` (`question_id`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `material_quiz_choices_question` ON `material_quiz_choices` (`id`,`question_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `material_quiz_questions_position` ON `material_quiz_questions` (`version_id`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `material_quiz_questions_version` ON `material_quiz_questions` (`id`,`version_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `material_quiz_questions_kind` ON `material_quiz_questions` (`id`,`kind`);--> statement-breakpoint
CREATE INDEX `material_quiz_responses_question_version_fk` ON `material_quiz_responses` (`question_id`,`version_id`);--> statement-breakpoint
CREATE INDEX `material_quiz_responses_question_kind_fk` ON `material_quiz_responses` (`question_id`,`question_kind`);--> statement-breakpoint
CREATE INDEX `material_quiz_selections_choice_fk` ON `material_quiz_selections` (`choice_id`,`question_id`);
--> statement-breakpoint
INSERT INTO codes_source_origin (code) VALUES ('attachment'),('import'),('note'),('recording'),('web');
--> statement-breakpoint
INSERT INTO codes_source_kind (code) VALUES ('archive'),('audio'),('code'),('document'),('image'),('link'),('note'),('other'),('pdf'),('slides'),('spreadsheet'),('text'),('video'),('web');
--> statement-breakpoint
INSERT INTO codes_title_source (code) VALUES ('generated'),('provisional'),('user');
--> statement-breakpoint
INSERT INTO codes_message_role (code) VALUES ('assistant'),('user');
--> statement-breakpoint
INSERT INTO codes_message_status (code) VALUES ('complete'),('pending'),('writing');
--> statement-breakpoint
INSERT INTO codes_version_origin (code) VALUES ('answer'),('edited'),('improve'),('instruction'),('summarize'),('typed');
--> statement-breakpoint
INSERT INTO codes_artifact_kind (code) VALUES ('diagram'),('flashcards');
--> statement-breakpoint
INSERT INTO codes_extractor_kind (code) VALUES ('office'),('text'),('transcription'),('vision'),('web');
--> statement-breakpoint
INSERT INTO codes_block_kind (code) VALUES ('code'),('heading'),('list_item'),('paragraph'),('segment'),('table');
--> statement-breakpoint
INSERT INTO codes_artifact_status (code) VALUES ('complete'),('pending'),('writing');
--> statement-breakpoint
INSERT INTO codes_rating (code) VALUES ('again'),('easy'),('good'),('hard');
--> statement-breakpoint
INSERT INTO codes_question_kind (code) VALUES ('choice'),('open');
--> statement-breakpoint
INSERT INTO codes_question_status (code) VALUES ('answered'),('graded'),('pending'),('ready'),('writing');
--> statement-breakpoint
INSERT INTO codes_verdict (code) VALUES ('correct'),('incorrect'),('partly');
--> statement-breakpoint
INSERT INTO codes_job_kind (code) VALUES ('artifact'),('extract'),('fetch'),('grade'),('index'),('question'),('reply'),('rewrite'),('title');
--> statement-breakpoint
INSERT INTO codes_job_status (code) VALUES ('blocked'),('cancelled'),('failed'),('queued'),('running'),('succeeded'),('waiting');
--> statement-breakpoint
INSERT INTO codes_error_kind (code) VALUES ('auth'),('cancelled'),('config'),('internal'),('invalid_input'),('model_unavailable'),('not_enough'),('not_found'),('rate_limited'),('transient'),('unsupported');
--> statement-breakpoint
INSERT INTO codes_requirement (code) VALUES ('language_models');
--> statement-breakpoint
CREATE VIRTUAL TABLE catalog_fts USING fts5(text, kind UNINDEXED, target_id UNINDEXED, project_id UNINDEXED, tokenize = 'unicode61 remove_diacritics 2');
--> statement-breakpoint
CREATE VIRTUAL TABLE chunks_fts USING fts5 (
    text,
    content = 'chunks',
    content_rowid = 'id',
    tokenize = 'unicode61 remove_diacritics 2'
);
--> statement-breakpoint
CREATE VIRTUAL TABLE message_fts USING fts5 (
    text,
    content = 'message_versions',
    content_rowid = 'id',
    tokenize = 'unicode61 remove_diacritics 2'
);
--> statement-breakpoint
CREATE TRIGGER catalog_artifact_delete AFTER DELETE ON artifacts BEGIN DELETE FROM catalog_fts WHERE kind='material' AND target_id=old.id; END;
--> statement-breakpoint
CREATE TRIGGER catalog_artifact_insert AFTER INSERT ON artifacts BEGIN INSERT INTO catalog_fts VALUES(new.title || ' ' || coalesce(new.body,''), 'material', new.id, new.project_id); END;
--> statement-breakpoint
CREATE TRIGGER catalog_artifact_update AFTER UPDATE OF title,body ON artifacts BEGIN DELETE FROM catalog_fts WHERE kind='material' AND target_id=old.id; INSERT INTO catalog_fts VALUES(new.title || ' ' || coalesce(new.body,''), 'material', new.id, new.project_id); END;
--> statement-breakpoint
CREATE TRIGGER catalog_project_delete AFTER DELETE ON projects BEGIN DELETE FROM catalog_fts WHERE kind='project' AND target_id=old.id; END;
--> statement-breakpoint
CREATE TRIGGER catalog_project_insert AFTER INSERT ON projects BEGIN INSERT INTO catalog_fts VALUES(new.name, 'project', new.id, new.id); END;
--> statement-breakpoint
CREATE TRIGGER catalog_project_update AFTER UPDATE OF name ON projects BEGIN DELETE FROM catalog_fts WHERE kind='project' AND target_id=old.id; INSERT INTO catalog_fts VALUES(new.name, 'project', new.id, new.id); END;
--> statement-breakpoint
CREATE TRIGGER catalog_question_delete AFTER DELETE ON practice_questions BEGIN DELETE FROM catalog_fts WHERE kind='question' AND target_id=old.id; END;
--> statement-breakpoint
CREATE TRIGGER catalog_question_insert AFTER INSERT ON practice_questions BEGIN INSERT INTO catalog_fts VALUES(coalesce(new.gist,'') || ' ' || coalesce(new.body,''), 'question', new.id, (SELECT project_id FROM practices WHERE id=new.practice_id)); END;
--> statement-breakpoint
CREATE TRIGGER catalog_question_update AFTER UPDATE OF gist,body ON practice_questions BEGIN DELETE FROM catalog_fts WHERE kind='question' AND target_id=old.id; INSERT INTO catalog_fts VALUES(coalesce(new.gist,'') || ' ' || coalesce(new.body,''), 'question', new.id, (SELECT project_id FROM practices WHERE id=new.practice_id)); END;
--> statement-breakpoint
CREATE TRIGGER catalog_session_delete AFTER DELETE ON sessions BEGIN
    DELETE FROM catalog_fts WHERE kind = 'session' AND target_id = old.id;
END;
--> statement-breakpoint
CREATE TRIGGER catalog_session_insert AFTER INSERT ON sessions BEGIN
    INSERT INTO catalog_fts VALUES (new.title, 'session', new.id, new.project_id);
END;
--> statement-breakpoint
CREATE TRIGGER catalog_session_update AFTER UPDATE OF title, project_id ON sessions BEGIN
    DELETE FROM catalog_fts WHERE kind = 'session' AND target_id = old.id;
    INSERT INTO catalog_fts VALUES (new.title, 'session', new.id, new.project_id);
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
CREATE TRIGGER material_identity_update BEFORE UPDATE ON materials
WHEN new.id IS NOT old.id OR new.project_id IS NOT old.project_id OR new.kind IS NOT old.kind
BEGIN SELECT RAISE(ABORT, 'material ownership and kind are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_versions_start_draft BEFORE INSERT ON material_versions
WHEN new.status != 'draft'
BEGIN SELECT RAISE(ABORT, 'material versions must start as drafts'); END;
--> statement-breakpoint
CREATE TRIGGER material_versions_frozen BEFORE UPDATE ON material_versions
WHEN EXISTS(SELECT 1 FROM material_versions v JOIN projects p ON p.id=v.project_id WHERE v.id=old.id AND v.status='published') OR new.id IS NOT old.id OR new.material_id IS NOT old.material_id OR new.project_id IS NOT old.project_id OR new.kind IS NOT old.kind OR new.number IS NOT old.number OR new.created_at IS NOT old.created_at
BEGIN SELECT RAISE(ABORT, 'published versions and version identities are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_versions_delete_frozen BEFORE DELETE ON material_versions
WHEN EXISTS(SELECT 1 FROM material_versions v JOIN projects p ON p.id=v.project_id WHERE v.id=old.id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published versions cannot be deleted'); END;
--> statement-breakpoint
CREATE TRIGGER material_file_versions_insert_draft BEFORE INSERT ON material_file_versions
WHEN EXISTS(SELECT 1 FROM material_versions v JOIN projects p ON p.id=v.project_id WHERE v.id=new.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_file_versions_update_draft BEFORE UPDATE ON material_file_versions
WHEN EXISTS(SELECT 1 FROM material_versions v JOIN projects p ON p.id=v.project_id WHERE v.id=old.version_id AND v.status='published') OR EXISTS(SELECT 1 FROM material_versions v JOIN projects p ON p.id=v.project_id WHERE v.id=new.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_file_versions_delete_draft BEFORE DELETE ON material_file_versions
WHEN EXISTS(SELECT 1 FROM material_versions v JOIN projects p ON p.id=v.project_id WHERE v.id=old.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_audio_versions_insert_draft BEFORE INSERT ON material_audio_versions
WHEN EXISTS(SELECT 1 FROM material_versions v JOIN projects p ON p.id=v.project_id WHERE v.id=new.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_audio_versions_update_draft BEFORE UPDATE ON material_audio_versions
WHEN EXISTS(SELECT 1 FROM material_versions v JOIN projects p ON p.id=v.project_id WHERE v.id=old.version_id AND v.status='published') OR EXISTS(SELECT 1 FROM material_versions v JOIN projects p ON p.id=v.project_id WHERE v.id=new.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_audio_versions_delete_draft BEFORE DELETE ON material_audio_versions
WHEN EXISTS(SELECT 1 FROM material_versions v JOIN projects p ON p.id=v.project_id WHERE v.id=old.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_video_versions_insert_draft BEFORE INSERT ON material_video_versions
WHEN EXISTS(SELECT 1 FROM material_versions v JOIN projects p ON p.id=v.project_id WHERE v.id=new.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_video_versions_update_draft BEFORE UPDATE ON material_video_versions
WHEN EXISTS(SELECT 1 FROM material_versions v JOIN projects p ON p.id=v.project_id WHERE v.id=old.version_id AND v.status='published') OR EXISTS(SELECT 1 FROM material_versions v JOIN projects p ON p.id=v.project_id WHERE v.id=new.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_video_versions_delete_draft BEFORE DELETE ON material_video_versions
WHEN EXISTS(SELECT 1 FROM material_versions v JOIN projects p ON p.id=v.project_id WHERE v.id=old.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_image_versions_insert_draft BEFORE INSERT ON material_image_versions
WHEN EXISTS(SELECT 1 FROM material_versions v JOIN projects p ON p.id=v.project_id WHERE v.id=new.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_image_versions_update_draft BEFORE UPDATE ON material_image_versions
WHEN EXISTS(SELECT 1 FROM material_versions v JOIN projects p ON p.id=v.project_id WHERE v.id=old.version_id AND v.status='published') OR EXISTS(SELECT 1 FROM material_versions v JOIN projects p ON p.id=v.project_id WHERE v.id=new.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_image_versions_delete_draft BEFORE DELETE ON material_image_versions
WHEN EXISTS(SELECT 1 FROM material_versions v JOIN projects p ON p.id=v.project_id WHERE v.id=old.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_link_versions_insert_draft BEFORE INSERT ON material_link_versions
WHEN EXISTS(SELECT 1 FROM material_versions v JOIN projects p ON p.id=v.project_id WHERE v.id=new.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_link_versions_update_draft BEFORE UPDATE ON material_link_versions
WHEN EXISTS(SELECT 1 FROM material_versions v JOIN projects p ON p.id=v.project_id WHERE v.id=old.version_id AND v.status='published') OR EXISTS(SELECT 1 FROM material_versions v JOIN projects p ON p.id=v.project_id WHERE v.id=new.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_link_versions_delete_draft BEFORE DELETE ON material_link_versions
WHEN EXISTS(SELECT 1 FROM material_versions v JOIN projects p ON p.id=v.project_id WHERE v.id=old.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_document_versions_insert_draft BEFORE INSERT ON material_document_versions
WHEN EXISTS(SELECT 1 FROM material_versions v JOIN projects p ON p.id=v.project_id WHERE v.id=new.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_document_versions_update_draft BEFORE UPDATE ON material_document_versions
WHEN EXISTS(SELECT 1 FROM material_versions v JOIN projects p ON p.id=v.project_id WHERE v.id=old.version_id AND v.status='published') OR EXISTS(SELECT 1 FROM material_versions v JOIN projects p ON p.id=v.project_id WHERE v.id=new.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_document_versions_delete_draft BEFORE DELETE ON material_document_versions
WHEN EXISTS(SELECT 1 FROM material_versions v JOIN projects p ON p.id=v.project_id WHERE v.id=old.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_diagram_versions_insert_draft BEFORE INSERT ON material_diagram_versions
WHEN EXISTS(SELECT 1 FROM material_versions v JOIN projects p ON p.id=v.project_id WHERE v.id=new.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_diagram_versions_update_draft BEFORE UPDATE ON material_diagram_versions
WHEN EXISTS(SELECT 1 FROM material_versions v JOIN projects p ON p.id=v.project_id WHERE v.id=old.version_id AND v.status='published') OR EXISTS(SELECT 1 FROM material_versions v JOIN projects p ON p.id=v.project_id WHERE v.id=new.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_diagram_versions_delete_draft BEFORE DELETE ON material_diagram_versions
WHEN EXISTS(SELECT 1 FROM material_versions v JOIN projects p ON p.id=v.project_id WHERE v.id=old.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_versions_insert_draft BEFORE INSERT ON material_quiz_versions
WHEN EXISTS(SELECT 1 FROM material_versions v JOIN projects p ON p.id=v.project_id WHERE v.id=new.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_versions_update_draft BEFORE UPDATE ON material_quiz_versions
WHEN EXISTS(SELECT 1 FROM material_versions v JOIN projects p ON p.id=v.project_id WHERE v.id=old.version_id AND v.status='published') OR EXISTS(SELECT 1 FROM material_versions v JOIN projects p ON p.id=v.project_id WHERE v.id=new.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_versions_delete_draft BEFORE DELETE ON material_quiz_versions
WHEN EXISTS(SELECT 1 FROM material_versions v JOIN projects p ON p.id=v.project_id WHERE v.id=old.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_flashcard_versions_insert_draft BEFORE INSERT ON material_flashcard_versions
WHEN EXISTS(SELECT 1 FROM material_versions v JOIN projects p ON p.id=v.project_id WHERE v.id=new.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_flashcard_versions_update_draft BEFORE UPDATE ON material_flashcard_versions
WHEN EXISTS(SELECT 1 FROM material_versions v JOIN projects p ON p.id=v.project_id WHERE v.id=old.version_id AND v.status='published') OR EXISTS(SELECT 1 FROM material_versions v JOIN projects p ON p.id=v.project_id WHERE v.id=new.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_flashcard_versions_delete_draft BEFORE DELETE ON material_flashcard_versions
WHEN EXISTS(SELECT 1 FROM material_versions v JOIN projects p ON p.id=v.project_id WHERE v.id=old.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_questions_insert_draft BEFORE INSERT ON material_quiz_questions
WHEN EXISTS(SELECT 1 FROM material_versions v JOIN projects p ON p.id=v.project_id WHERE v.id=new.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_questions_update_draft BEFORE UPDATE ON material_quiz_questions
WHEN EXISTS(SELECT 1 FROM material_versions v JOIN projects p ON p.id=v.project_id WHERE v.id=old.version_id AND v.status='published') OR EXISTS(SELECT 1 FROM material_versions v JOIN projects p ON p.id=v.project_id WHERE v.id=new.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_questions_delete_draft BEFORE DELETE ON material_quiz_questions
WHEN EXISTS(SELECT 1 FROM material_versions v JOIN projects p ON p.id=v.project_id WHERE v.id=old.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_choices_insert_draft BEFORE INSERT ON material_quiz_choices
WHEN EXISTS(SELECT 1 FROM material_versions v JOIN projects p ON p.id=v.project_id WHERE v.id=(SELECT version_id FROM material_quiz_questions WHERE id=new.question_id) AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_choices_update_draft BEFORE UPDATE ON material_quiz_choices
WHEN EXISTS(SELECT 1 FROM material_versions v JOIN projects p ON p.id=v.project_id WHERE v.id=(SELECT version_id FROM material_quiz_questions WHERE id=old.question_id) AND v.status='published') OR EXISTS(SELECT 1 FROM material_versions v JOIN projects p ON p.id=v.project_id WHERE v.id=(SELECT version_id FROM material_quiz_questions WHERE id=new.question_id) AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_choices_delete_draft BEFORE DELETE ON material_quiz_choices
WHEN EXISTS(SELECT 1 FROM material_versions v JOIN projects p ON p.id=v.project_id WHERE v.id=(SELECT version_id FROM material_quiz_questions WHERE id=old.question_id) AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_open_answers_insert_draft BEFORE INSERT ON material_quiz_open_answers
WHEN EXISTS(SELECT 1 FROM material_versions v JOIN projects p ON p.id=v.project_id WHERE v.id=(SELECT version_id FROM material_quiz_questions WHERE id=new.question_id) AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_open_answers_update_draft BEFORE UPDATE ON material_quiz_open_answers
WHEN EXISTS(SELECT 1 FROM material_versions v JOIN projects p ON p.id=v.project_id WHERE v.id=(SELECT version_id FROM material_quiz_questions WHERE id=old.question_id) AND v.status='published') OR EXISTS(SELECT 1 FROM material_versions v JOIN projects p ON p.id=v.project_id WHERE v.id=(SELECT version_id FROM material_quiz_questions WHERE id=new.question_id) AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_open_answers_delete_draft BEFORE DELETE ON material_quiz_open_answers
WHEN EXISTS(SELECT 1 FROM material_versions v JOIN projects p ON p.id=v.project_id WHERE v.id=(SELECT version_id FROM material_quiz_questions WHERE id=old.question_id) AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_flashcard_entries_insert_draft BEFORE INSERT ON material_flashcard_entries
WHEN EXISTS(SELECT 1 FROM material_versions v JOIN projects p ON p.id=v.project_id WHERE v.id=new.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_flashcard_entries_update_draft BEFORE UPDATE ON material_flashcard_entries
WHEN EXISTS(SELECT 1 FROM material_versions v JOIN projects p ON p.id=v.project_id WHERE v.id=old.version_id AND v.status='published') OR EXISTS(SELECT 1 FROM material_versions v JOIN projects p ON p.id=v.project_id WHERE v.id=new.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_flashcard_entries_delete_draft BEFORE DELETE ON material_flashcard_entries
WHEN EXISTS(SELECT 1 FROM material_versions v JOIN projects p ON p.id=v.project_id WHERE v.id=old.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_version_citations_insert_draft BEFORE INSERT ON material_version_citations
WHEN EXISTS(SELECT 1 FROM material_versions v JOIN projects p ON p.id=v.project_id WHERE v.id=new.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_version_citations_update_draft BEFORE UPDATE ON material_version_citations
WHEN EXISTS(SELECT 1 FROM material_versions v JOIN projects p ON p.id=v.project_id WHERE v.id=old.version_id AND v.status='published') OR EXISTS(SELECT 1 FROM material_versions v JOIN projects p ON p.id=v.project_id WHERE v.id=new.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_version_citations_delete_draft BEFORE DELETE ON material_version_citations
WHEN EXISTS(SELECT 1 FROM material_versions v JOIN projects p ON p.id=v.project_id WHERE v.id=old.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_version_parents_insert_draft BEFORE INSERT ON material_version_parents
WHEN EXISTS(SELECT 1 FROM material_versions v JOIN projects p ON p.id=v.project_id WHERE v.id=new.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_version_parents_update_draft BEFORE UPDATE ON material_version_parents
WHEN EXISTS(SELECT 1 FROM material_versions v JOIN projects p ON p.id=v.project_id WHERE v.id=old.version_id AND v.status='published') OR EXISTS(SELECT 1 FROM material_versions v JOIN projects p ON p.id=v.project_id WHERE v.id=new.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_version_parents_delete_draft BEFORE DELETE ON material_version_parents
WHEN EXISTS(SELECT 1 FROM material_versions v JOIN projects p ON p.id=v.project_id WHERE v.id=old.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_version_parents_target_insert BEFORE INSERT ON material_version_parents
WHEN NOT EXISTS(SELECT 1 FROM material_versions v JOIN projects p ON p.id=v.project_id WHERE v.id=new.parent_version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'version dependencies must already be published'); END;
--> statement-breakpoint
CREATE TRIGGER material_version_parents_target_update BEFORE UPDATE ON material_version_parents
WHEN NOT EXISTS(SELECT 1 FROM material_versions v JOIN projects p ON p.id=v.project_id WHERE v.id=new.parent_version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'version dependencies must already be published'); END;
--> statement-breakpoint
CREATE TRIGGER material_version_inputs_insert_draft BEFORE INSERT ON material_version_inputs
WHEN EXISTS(SELECT 1 FROM material_versions v JOIN projects p ON p.id=v.project_id WHERE v.id=new.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_version_inputs_update_draft BEFORE UPDATE ON material_version_inputs
WHEN EXISTS(SELECT 1 FROM material_versions v JOIN projects p ON p.id=v.project_id WHERE v.id=old.version_id AND v.status='published') OR EXISTS(SELECT 1 FROM material_versions v JOIN projects p ON p.id=v.project_id WHERE v.id=new.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_version_inputs_delete_draft BEFORE DELETE ON material_version_inputs
WHEN EXISTS(SELECT 1 FROM material_versions v JOIN projects p ON p.id=v.project_id WHERE v.id=old.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_version_inputs_target_insert BEFORE INSERT ON material_version_inputs
WHEN NOT EXISTS(SELECT 1 FROM material_versions v JOIN projects p ON p.id=v.project_id WHERE v.id=new.input_version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'version dependencies must already be published'); END;
--> statement-breakpoint
CREATE TRIGGER material_version_inputs_target_update BEFORE UPDATE ON material_version_inputs
WHEN NOT EXISTS(SELECT 1 FROM material_versions v JOIN projects p ON p.id=v.project_id WHERE v.id=new.input_version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'version dependencies must already be published'); END;
--> statement-breakpoint
CREATE TRIGGER material_versions_publish_payload BEFORE UPDATE OF status ON material_versions
WHEN new.status='published' AND (CASE new.kind WHEN 'file' THEN NOT EXISTS(SELECT 1 FROM material_file_versions WHERE version_id=new.id) WHEN 'audio' THEN NOT EXISTS(SELECT 1 FROM material_audio_versions WHERE version_id=new.id) WHEN 'video' THEN NOT EXISTS(SELECT 1 FROM material_video_versions WHERE version_id=new.id) WHEN 'image' THEN NOT EXISTS(SELECT 1 FROM material_image_versions WHERE version_id=new.id) WHEN 'link' THEN NOT EXISTS(SELECT 1 FROM material_link_versions WHERE version_id=new.id) WHEN 'document' THEN NOT EXISTS(SELECT 1 FROM material_document_versions WHERE version_id=new.id) WHEN 'diagram' THEN NOT EXISTS(SELECT 1 FROM material_diagram_versions WHERE version_id=new.id) WHEN 'quiz' THEN NOT EXISTS(SELECT 1 FROM material_quiz_versions WHERE version_id=new.id) WHEN 'flashcards' THEN NOT EXISTS(SELECT 1 FROM material_flashcard_versions WHERE version_id=new.id) ELSE 1 END)
BEGIN SELECT RAISE(ABORT, 'a published material requires its typed payload'); END;
--> statement-breakpoint
CREATE TRIGGER material_publish_file BEFORE UPDATE OF status ON material_versions
WHEN new.status='published' AND new.kind='file' AND EXISTS(SELECT 1 FROM material_file_versions c JOIN sources s ON s.id=c.source_id LEFT JOIN source_blobs b ON b.source_id=s.id WHERE c.version_id=new.id AND (s.project_id IS NOT new.project_id OR b.source_id IS NULL OR length(b.bytes) != s.size_bytes))
BEGIN SELECT RAISE(ABORT, 'source ownership, bytes or media type is invalid'); END;
--> statement-breakpoint
CREATE TRIGGER material_publish_audio BEFORE UPDATE OF status ON material_versions
WHEN new.status='published' AND new.kind='audio' AND EXISTS(SELECT 1 FROM material_audio_versions c JOIN sources s ON s.id=c.source_id LEFT JOIN source_blobs b ON b.source_id=s.id WHERE c.version_id=new.id AND (s.project_id IS NOT new.project_id OR b.source_id IS NULL OR length(b.bytes) != s.size_bytes OR s.kind != 'audio' OR lower(s.mime) NOT LIKE 'audio/%'))
BEGIN SELECT RAISE(ABORT, 'source ownership, bytes or media type is invalid'); END;
--> statement-breakpoint
CREATE TRIGGER material_publish_video BEFORE UPDATE OF status ON material_versions
WHEN new.status='published' AND new.kind='video' AND EXISTS(SELECT 1 FROM material_video_versions c JOIN sources s ON s.id=c.source_id LEFT JOIN source_blobs b ON b.source_id=s.id WHERE c.version_id=new.id AND (s.project_id IS NOT new.project_id OR b.source_id IS NULL OR length(b.bytes) != s.size_bytes OR s.kind != 'video' OR lower(s.mime) NOT LIKE 'video/%'))
BEGIN SELECT RAISE(ABORT, 'source ownership, bytes or media type is invalid'); END;
--> statement-breakpoint
CREATE TRIGGER material_publish_image BEFORE UPDATE OF status ON material_versions
WHEN new.status='published' AND new.kind='image' AND EXISTS(SELECT 1 FROM material_image_versions c JOIN sources s ON s.id=c.source_id LEFT JOIN source_blobs b ON b.source_id=s.id WHERE c.version_id=new.id AND (s.project_id IS NOT new.project_id OR b.source_id IS NULL OR length(b.bytes) != s.size_bytes OR s.kind != 'image' OR lower(s.mime) NOT LIKE 'image/%'))
BEGIN SELECT RAISE(ABORT, 'source ownership, bytes or media type is invalid'); END;
--> statement-breakpoint
CREATE TRIGGER material_publish_link BEFORE UPDATE OF status ON material_versions
WHEN new.status='published' AND new.kind='link' AND EXISTS(SELECT 1 FROM material_link_versions c JOIN sources s ON s.id=c.source_id LEFT JOIN source_blobs b ON b.source_id=s.id WHERE c.version_id=new.id AND (s.project_id IS NOT new.project_id OR s.kind NOT IN ('link','web') OR s.uri IS NULL OR (s.uri NOT LIKE 'https://%' AND s.uri NOT LIKE 'http://%')))
BEGIN SELECT RAISE(ABORT, 'source ownership, bytes or media type is invalid'); END;
--> statement-breakpoint
CREATE TRIGGER material_publish_document BEFORE UPDATE OF status ON material_versions
WHEN new.status='published' AND new.kind='document' AND (
      NOT EXISTS(SELECT 1 FROM material_document_versions c JOIN blocks b ON b.document_id=c.document_id WHERE c.version_id=new.id AND length(trim(b.text)) > 0)
      OR EXISTS(SELECT 1 FROM material_document_versions c JOIN documents d ON d.id=c.document_id JOIN sources s ON s.id=d.source_id WHERE c.version_id=new.id AND s.project_id IS NOT new.project_id))
BEGIN SELECT RAISE(ABORT, 'published documents require content in the owning project'); END;
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
WHEN EXISTS(SELECT 1 FROM material_document_versions c JOIN material_versions v ON v.id=c.version_id JOIN projects p ON p.id=v.project_id WHERE c.document_id=new.id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published document content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER documents_material_update BEFORE UPDATE ON documents
WHEN EXISTS(SELECT 1 FROM material_document_versions c JOIN material_versions v ON v.id=c.version_id JOIN projects p ON p.id=v.project_id WHERE c.document_id=old.id AND v.status='published') OR EXISTS(SELECT 1 FROM material_document_versions c JOIN material_versions v ON v.id=c.version_id JOIN projects p ON p.id=v.project_id WHERE c.document_id=new.id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published document content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER documents_material_delete BEFORE DELETE ON documents
WHEN EXISTS(SELECT 1 FROM material_document_versions c JOIN material_versions v ON v.id=c.version_id JOIN projects p ON p.id=v.project_id WHERE c.document_id=old.id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published document content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER blocks_material_insert BEFORE INSERT ON blocks
WHEN EXISTS(SELECT 1 FROM material_document_versions c JOIN material_versions v ON v.id=c.version_id JOIN projects p ON p.id=v.project_id WHERE c.document_id=new.document_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published document content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER blocks_material_update BEFORE UPDATE ON blocks
WHEN EXISTS(SELECT 1 FROM material_document_versions c JOIN material_versions v ON v.id=c.version_id JOIN projects p ON p.id=v.project_id WHERE c.document_id=old.document_id AND v.status='published') OR EXISTS(SELECT 1 FROM material_document_versions c JOIN material_versions v ON v.id=c.version_id JOIN projects p ON p.id=v.project_id WHERE c.document_id=new.document_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published document content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER blocks_material_delete BEFORE DELETE ON blocks
WHEN EXISTS(SELECT 1 FROM material_document_versions c JOIN material_versions v ON v.id=c.version_id JOIN projects p ON p.id=v.project_id WHERE c.document_id=old.document_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published document content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER sources_material_insert BEFORE INSERT ON sources
WHEN (EXISTS(SELECT 1 FROM material_file_versions c JOIN material_versions v ON v.id=c.version_id JOIN projects p ON p.id=v.project_id WHERE c.source_id=new.id AND v.status='published') OR EXISTS(SELECT 1 FROM material_audio_versions c JOIN material_versions v ON v.id=c.version_id JOIN projects p ON p.id=v.project_id WHERE c.source_id=new.id AND v.status='published') OR EXISTS(SELECT 1 FROM material_video_versions c JOIN material_versions v ON v.id=c.version_id JOIN projects p ON p.id=v.project_id WHERE c.source_id=new.id AND v.status='published') OR EXISTS(SELECT 1 FROM material_image_versions c JOIN material_versions v ON v.id=c.version_id JOIN projects p ON p.id=v.project_id WHERE c.source_id=new.id AND v.status='published') OR EXISTS(SELECT 1 FROM material_link_versions c JOIN material_versions v ON v.id=c.version_id JOIN projects p ON p.id=v.project_id WHERE c.source_id=new.id AND v.status='published') OR EXISTS(SELECT 1 FROM documents d JOIN material_document_versions c ON c.document_id=d.id JOIN material_versions v ON v.id=c.version_id JOIN projects p ON p.id=v.project_id WHERE d.source_id=new.id AND v.status='published'))
BEGIN SELECT RAISE(ABORT, 'published source content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER sources_material_update BEFORE UPDATE ON sources
WHEN (EXISTS(SELECT 1 FROM material_file_versions c JOIN material_versions v ON v.id=c.version_id JOIN projects p ON p.id=v.project_id WHERE c.source_id=old.id AND v.status='published') OR EXISTS(SELECT 1 FROM material_audio_versions c JOIN material_versions v ON v.id=c.version_id JOIN projects p ON p.id=v.project_id WHERE c.source_id=old.id AND v.status='published') OR EXISTS(SELECT 1 FROM material_video_versions c JOIN material_versions v ON v.id=c.version_id JOIN projects p ON p.id=v.project_id WHERE c.source_id=old.id AND v.status='published') OR EXISTS(SELECT 1 FROM material_image_versions c JOIN material_versions v ON v.id=c.version_id JOIN projects p ON p.id=v.project_id WHERE c.source_id=old.id AND v.status='published') OR EXISTS(SELECT 1 FROM material_link_versions c JOIN material_versions v ON v.id=c.version_id JOIN projects p ON p.id=v.project_id WHERE c.source_id=old.id AND v.status='published') OR EXISTS(SELECT 1 FROM documents d JOIN material_document_versions c ON c.document_id=d.id JOIN material_versions v ON v.id=c.version_id JOIN projects p ON p.id=v.project_id WHERE d.source_id=old.id AND v.status='published')) OR (EXISTS(SELECT 1 FROM material_file_versions c JOIN material_versions v ON v.id=c.version_id JOIN projects p ON p.id=v.project_id WHERE c.source_id=new.id AND v.status='published') OR EXISTS(SELECT 1 FROM material_audio_versions c JOIN material_versions v ON v.id=c.version_id JOIN projects p ON p.id=v.project_id WHERE c.source_id=new.id AND v.status='published') OR EXISTS(SELECT 1 FROM material_video_versions c JOIN material_versions v ON v.id=c.version_id JOIN projects p ON p.id=v.project_id WHERE c.source_id=new.id AND v.status='published') OR EXISTS(SELECT 1 FROM material_image_versions c JOIN material_versions v ON v.id=c.version_id JOIN projects p ON p.id=v.project_id WHERE c.source_id=new.id AND v.status='published') OR EXISTS(SELECT 1 FROM material_link_versions c JOIN material_versions v ON v.id=c.version_id JOIN projects p ON p.id=v.project_id WHERE c.source_id=new.id AND v.status='published') OR EXISTS(SELECT 1 FROM documents d JOIN material_document_versions c ON c.document_id=d.id JOIN material_versions v ON v.id=c.version_id JOIN projects p ON p.id=v.project_id WHERE d.source_id=new.id AND v.status='published'))
BEGIN SELECT RAISE(ABORT, 'published source content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER sources_material_delete BEFORE DELETE ON sources
WHEN (EXISTS(SELECT 1 FROM material_file_versions c JOIN material_versions v ON v.id=c.version_id JOIN projects p ON p.id=v.project_id WHERE c.source_id=old.id AND v.status='published') OR EXISTS(SELECT 1 FROM material_audio_versions c JOIN material_versions v ON v.id=c.version_id JOIN projects p ON p.id=v.project_id WHERE c.source_id=old.id AND v.status='published') OR EXISTS(SELECT 1 FROM material_video_versions c JOIN material_versions v ON v.id=c.version_id JOIN projects p ON p.id=v.project_id WHERE c.source_id=old.id AND v.status='published') OR EXISTS(SELECT 1 FROM material_image_versions c JOIN material_versions v ON v.id=c.version_id JOIN projects p ON p.id=v.project_id WHERE c.source_id=old.id AND v.status='published') OR EXISTS(SELECT 1 FROM material_link_versions c JOIN material_versions v ON v.id=c.version_id JOIN projects p ON p.id=v.project_id WHERE c.source_id=old.id AND v.status='published') OR EXISTS(SELECT 1 FROM documents d JOIN material_document_versions c ON c.document_id=d.id JOIN material_versions v ON v.id=c.version_id JOIN projects p ON p.id=v.project_id WHERE d.source_id=old.id AND v.status='published'))
BEGIN SELECT RAISE(ABORT, 'published source content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER source_blobs_material_insert BEFORE INSERT ON source_blobs
WHEN (EXISTS(SELECT 1 FROM material_file_versions c JOIN material_versions v ON v.id=c.version_id JOIN projects p ON p.id=v.project_id WHERE c.source_id=new.source_id AND v.status='published') OR EXISTS(SELECT 1 FROM material_audio_versions c JOIN material_versions v ON v.id=c.version_id JOIN projects p ON p.id=v.project_id WHERE c.source_id=new.source_id AND v.status='published') OR EXISTS(SELECT 1 FROM material_video_versions c JOIN material_versions v ON v.id=c.version_id JOIN projects p ON p.id=v.project_id WHERE c.source_id=new.source_id AND v.status='published') OR EXISTS(SELECT 1 FROM material_image_versions c JOIN material_versions v ON v.id=c.version_id JOIN projects p ON p.id=v.project_id WHERE c.source_id=new.source_id AND v.status='published') OR EXISTS(SELECT 1 FROM material_link_versions c JOIN material_versions v ON v.id=c.version_id JOIN projects p ON p.id=v.project_id WHERE c.source_id=new.source_id AND v.status='published') OR EXISTS(SELECT 1 FROM documents d JOIN material_document_versions c ON c.document_id=d.id JOIN material_versions v ON v.id=c.version_id JOIN projects p ON p.id=v.project_id WHERE d.source_id=new.source_id AND v.status='published'))
BEGIN SELECT RAISE(ABORT, 'published source content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER source_blobs_material_update BEFORE UPDATE ON source_blobs
WHEN (EXISTS(SELECT 1 FROM material_file_versions c JOIN material_versions v ON v.id=c.version_id JOIN projects p ON p.id=v.project_id WHERE c.source_id=old.source_id AND v.status='published') OR EXISTS(SELECT 1 FROM material_audio_versions c JOIN material_versions v ON v.id=c.version_id JOIN projects p ON p.id=v.project_id WHERE c.source_id=old.source_id AND v.status='published') OR EXISTS(SELECT 1 FROM material_video_versions c JOIN material_versions v ON v.id=c.version_id JOIN projects p ON p.id=v.project_id WHERE c.source_id=old.source_id AND v.status='published') OR EXISTS(SELECT 1 FROM material_image_versions c JOIN material_versions v ON v.id=c.version_id JOIN projects p ON p.id=v.project_id WHERE c.source_id=old.source_id AND v.status='published') OR EXISTS(SELECT 1 FROM material_link_versions c JOIN material_versions v ON v.id=c.version_id JOIN projects p ON p.id=v.project_id WHERE c.source_id=old.source_id AND v.status='published') OR EXISTS(SELECT 1 FROM documents d JOIN material_document_versions c ON c.document_id=d.id JOIN material_versions v ON v.id=c.version_id JOIN projects p ON p.id=v.project_id WHERE d.source_id=old.source_id AND v.status='published')) OR (EXISTS(SELECT 1 FROM material_file_versions c JOIN material_versions v ON v.id=c.version_id JOIN projects p ON p.id=v.project_id WHERE c.source_id=new.source_id AND v.status='published') OR EXISTS(SELECT 1 FROM material_audio_versions c JOIN material_versions v ON v.id=c.version_id JOIN projects p ON p.id=v.project_id WHERE c.source_id=new.source_id AND v.status='published') OR EXISTS(SELECT 1 FROM material_video_versions c JOIN material_versions v ON v.id=c.version_id JOIN projects p ON p.id=v.project_id WHERE c.source_id=new.source_id AND v.status='published') OR EXISTS(SELECT 1 FROM material_image_versions c JOIN material_versions v ON v.id=c.version_id JOIN projects p ON p.id=v.project_id WHERE c.source_id=new.source_id AND v.status='published') OR EXISTS(SELECT 1 FROM material_link_versions c JOIN material_versions v ON v.id=c.version_id JOIN projects p ON p.id=v.project_id WHERE c.source_id=new.source_id AND v.status='published') OR EXISTS(SELECT 1 FROM documents d JOIN material_document_versions c ON c.document_id=d.id JOIN material_versions v ON v.id=c.version_id JOIN projects p ON p.id=v.project_id WHERE d.source_id=new.source_id AND v.status='published'))
BEGIN SELECT RAISE(ABORT, 'published source content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER source_blobs_material_delete BEFORE DELETE ON source_blobs
WHEN (EXISTS(SELECT 1 FROM material_file_versions c JOIN material_versions v ON v.id=c.version_id JOIN projects p ON p.id=v.project_id WHERE c.source_id=old.source_id AND v.status='published') OR EXISTS(SELECT 1 FROM material_audio_versions c JOIN material_versions v ON v.id=c.version_id JOIN projects p ON p.id=v.project_id WHERE c.source_id=old.source_id AND v.status='published') OR EXISTS(SELECT 1 FROM material_video_versions c JOIN material_versions v ON v.id=c.version_id JOIN projects p ON p.id=v.project_id WHERE c.source_id=old.source_id AND v.status='published') OR EXISTS(SELECT 1 FROM material_image_versions c JOIN material_versions v ON v.id=c.version_id JOIN projects p ON p.id=v.project_id WHERE c.source_id=old.source_id AND v.status='published') OR EXISTS(SELECT 1 FROM material_link_versions c JOIN material_versions v ON v.id=c.version_id JOIN projects p ON p.id=v.project_id WHERE c.source_id=old.source_id AND v.status='published') OR EXISTS(SELECT 1 FROM documents d JOIN material_document_versions c ON c.document_id=d.id JOIN material_versions v ON v.id=c.version_id JOIN projects p ON p.id=v.project_id WHERE d.source_id=old.source_id AND v.status='published'))
BEGIN SELECT RAISE(ABORT, 'published source content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_card_identity_update BEFORE UPDATE ON material_card_identities
WHEN new.id IS NOT old.id OR new.material_id IS NOT old.material_id OR new.kind IS NOT old.kind
BEGIN SELECT RAISE(ABORT, 'card identity ownership is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_attempt_published BEFORE INSERT ON material_quiz_attempts
WHEN NOT EXISTS(SELECT 1 FROM material_versions v JOIN projects p ON p.id=v.project_id WHERE v.id=new.version_id AND v.status='published') OR new.status != 'in_progress'
BEGIN SELECT RAISE(ABORT, 'quiz attempts must start on a published quiz'); END;
--> statement-breakpoint
CREATE TRIGGER material_attempt_identity BEFORE UPDATE ON material_quiz_attempts
WHEN old.status='completed' OR new.id IS NOT old.id OR new.version_id IS NOT old.version_id OR new.started_at IS NOT old.started_at
BEGIN SELECT RAISE(ABORT, 'completed attempts and attempt identities are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_attempt_delete BEFORE DELETE ON material_quiz_attempts
WHEN old.status='completed' AND EXISTS(SELECT 1 FROM material_versions v JOIN projects p ON p.id=v.project_id WHERE v.id=old.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'completed attempts cannot be deleted'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_responses_completed_insert BEFORE INSERT ON material_quiz_responses
WHEN EXISTS(SELECT 1 FROM material_quiz_attempts a JOIN material_versions v ON v.id=a.version_id JOIN projects p ON p.id=v.project_id WHERE a.id=new.attempt_id AND a.status='completed')
BEGIN SELECT RAISE(ABORT, 'completed quiz answers are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_responses_completed_update BEFORE UPDATE ON material_quiz_responses
WHEN EXISTS(SELECT 1 FROM material_quiz_attempts a JOIN material_versions v ON v.id=a.version_id JOIN projects p ON p.id=v.project_id WHERE a.id=old.attempt_id AND a.status='completed') OR EXISTS(SELECT 1 FROM material_quiz_attempts a JOIN material_versions v ON v.id=a.version_id JOIN projects p ON p.id=v.project_id WHERE a.id=new.attempt_id AND a.status='completed')
BEGIN SELECT RAISE(ABORT, 'completed quiz answers are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_responses_completed_delete BEFORE DELETE ON material_quiz_responses
WHEN EXISTS(SELECT 1 FROM material_quiz_attempts a JOIN material_versions v ON v.id=a.version_id JOIN projects p ON p.id=v.project_id WHERE a.id=old.attempt_id AND a.status='completed')
BEGIN SELECT RAISE(ABORT, 'completed quiz answers are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_selections_completed_insert BEFORE INSERT ON material_quiz_selections
WHEN EXISTS(SELECT 1 FROM material_quiz_attempts a JOIN material_versions v ON v.id=a.version_id JOIN projects p ON p.id=v.project_id WHERE a.id=new.attempt_id AND a.status='completed')
BEGIN SELECT RAISE(ABORT, 'completed quiz answers are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_selections_completed_update BEFORE UPDATE ON material_quiz_selections
WHEN EXISTS(SELECT 1 FROM material_quiz_attempts a JOIN material_versions v ON v.id=a.version_id JOIN projects p ON p.id=v.project_id WHERE a.id=old.attempt_id AND a.status='completed') OR EXISTS(SELECT 1 FROM material_quiz_attempts a JOIN material_versions v ON v.id=a.version_id JOIN projects p ON p.id=v.project_id WHERE a.id=new.attempt_id AND a.status='completed')
BEGIN SELECT RAISE(ABORT, 'completed quiz answers are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_selections_completed_delete BEFORE DELETE ON material_quiz_selections
WHEN EXISTS(SELECT 1 FROM material_quiz_attempts a JOIN material_versions v ON v.id=a.version_id JOIN projects p ON p.id=v.project_id WHERE a.id=old.attempt_id AND a.status='completed')
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
WHEN NOT EXISTS(SELECT 1 FROM material_versions v JOIN projects p ON p.id=v.project_id WHERE v.id=new.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'card reviews require a published deck'); END;
--> statement-breakpoint
CREATE TRIGGER material_review_update BEFORE UPDATE ON material_card_reviews
WHEN EXISTS(SELECT 1 FROM material_versions v JOIN projects p ON p.id=v.project_id WHERE v.id=old.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'card reviews are append only'); END;
--> statement-breakpoint
CREATE TRIGGER material_review_delete BEFORE DELETE ON material_card_reviews
WHEN EXISTS(SELECT 1 FROM material_versions v JOIN projects p ON p.id=v.project_id WHERE v.id=old.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'card reviews are append only'); END;

--> statement-breakpoint
CREATE TRIGGER material_document_cleanup AFTER DELETE ON material_document_versions BEGIN DELETE FROM documents WHERE id=old.document_id AND source_id IS NULL; END;

--> statement-breakpoint
CREATE TRIGGER material_file_source_owner_insert BEFORE INSERT ON material_file_versions WHEN EXISTS(SELECT 1 FROM sources s JOIN material_versions v ON v.id=new.version_id WHERE s.id=new.source_id AND s.project_id IS NOT v.project_id) BEGIN SELECT RAISE(ABORT, 'material sources must belong to the same project'); END;
--> statement-breakpoint
CREATE TRIGGER material_file_source_owner_update BEFORE UPDATE ON material_file_versions WHEN EXISTS(SELECT 1 FROM sources s JOIN material_versions v ON v.id=new.version_id WHERE s.id=new.source_id AND s.project_id IS NOT v.project_id) BEGIN SELECT RAISE(ABORT, 'material sources must belong to the same project'); END;
--> statement-breakpoint
CREATE TRIGGER material_audio_source_owner_insert BEFORE INSERT ON material_audio_versions WHEN EXISTS(SELECT 1 FROM sources s JOIN material_versions v ON v.id=new.version_id WHERE s.id=new.source_id AND s.project_id IS NOT v.project_id) BEGIN SELECT RAISE(ABORT, 'material sources must belong to the same project'); END;
--> statement-breakpoint
CREATE TRIGGER material_audio_source_owner_update BEFORE UPDATE ON material_audio_versions WHEN EXISTS(SELECT 1 FROM sources s JOIN material_versions v ON v.id=new.version_id WHERE s.id=new.source_id AND s.project_id IS NOT v.project_id) BEGIN SELECT RAISE(ABORT, 'material sources must belong to the same project'); END;
--> statement-breakpoint
CREATE TRIGGER material_video_source_owner_insert BEFORE INSERT ON material_video_versions WHEN EXISTS(SELECT 1 FROM sources s JOIN material_versions v ON v.id=new.version_id WHERE s.id=new.source_id AND s.project_id IS NOT v.project_id) BEGIN SELECT RAISE(ABORT, 'material sources must belong to the same project'); END;
--> statement-breakpoint
CREATE TRIGGER material_video_source_owner_update BEFORE UPDATE ON material_video_versions WHEN EXISTS(SELECT 1 FROM sources s JOIN material_versions v ON v.id=new.version_id WHERE s.id=new.source_id AND s.project_id IS NOT v.project_id) BEGIN SELECT RAISE(ABORT, 'material sources must belong to the same project'); END;
--> statement-breakpoint
CREATE TRIGGER material_image_source_owner_insert BEFORE INSERT ON material_image_versions WHEN EXISTS(SELECT 1 FROM sources s JOIN material_versions v ON v.id=new.version_id WHERE s.id=new.source_id AND s.project_id IS NOT v.project_id) BEGIN SELECT RAISE(ABORT, 'material sources must belong to the same project'); END;
--> statement-breakpoint
CREATE TRIGGER material_image_source_owner_update BEFORE UPDATE ON material_image_versions WHEN EXISTS(SELECT 1 FROM sources s JOIN material_versions v ON v.id=new.version_id WHERE s.id=new.source_id AND s.project_id IS NOT v.project_id) BEGIN SELECT RAISE(ABORT, 'material sources must belong to the same project'); END;
--> statement-breakpoint
CREATE TRIGGER material_link_source_owner_insert BEFORE INSERT ON material_link_versions WHEN EXISTS(SELECT 1 FROM sources s JOIN material_versions v ON v.id=new.version_id WHERE s.id=new.source_id AND s.project_id IS NOT v.project_id) BEGIN SELECT RAISE(ABORT, 'material sources must belong to the same project'); END;
--> statement-breakpoint
CREATE TRIGGER material_link_source_owner_update BEFORE UPDATE ON material_link_versions WHEN EXISTS(SELECT 1 FROM sources s JOIN material_versions v ON v.id=new.version_id WHERE s.id=new.source_id AND s.project_id IS NOT v.project_id) BEGIN SELECT RAISE(ABORT, 'material sources must belong to the same project'); END;
--> statement-breakpoint
CREATE TRIGGER material_document_source_owner_insert BEFORE INSERT ON material_document_versions WHEN EXISTS(SELECT 1 FROM documents d JOIN sources s ON s.id=d.source_id JOIN material_versions v ON v.id=new.version_id WHERE d.id=new.document_id AND s.project_id IS NOT v.project_id) BEGIN SELECT RAISE(ABORT, 'material documents must belong to the same project'); END;
--> statement-breakpoint
CREATE TRIGGER material_document_source_owner_update BEFORE UPDATE ON material_document_versions WHEN EXISTS(SELECT 1 FROM documents d JOIN sources s ON s.id=d.source_id JOIN material_versions v ON v.id=new.version_id WHERE d.id=new.document_id AND s.project_id IS NOT v.project_id) BEGIN SELECT RAISE(ABORT, 'material documents must belong to the same project'); END;
--> statement-breakpoint
CREATE TRIGGER material_document_source_reassignment BEFORE UPDATE OF source_id ON documents WHEN EXISTS(SELECT 1 FROM material_document_versions c JOIN material_versions v ON v.id=c.version_id JOIN sources s ON s.id=new.source_id WHERE c.document_id=old.id AND s.project_id IS NOT v.project_id) BEGIN SELECT RAISE(ABORT, 'material document source ownership is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_source_project_reassignment BEFORE UPDATE OF project_id ON sources WHEN EXISTS(SELECT 1 FROM material_file_versions c JOIN material_versions v ON v.id=c.version_id WHERE c.source_id=old.id AND v.project_id IS NOT new.project_id) OR EXISTS(SELECT 1 FROM material_audio_versions c JOIN material_versions v ON v.id=c.version_id WHERE c.source_id=old.id AND v.project_id IS NOT new.project_id) OR EXISTS(SELECT 1 FROM material_video_versions c JOIN material_versions v ON v.id=c.version_id WHERE c.source_id=old.id AND v.project_id IS NOT new.project_id) OR EXISTS(SELECT 1 FROM material_image_versions c JOIN material_versions v ON v.id=c.version_id WHERE c.source_id=old.id AND v.project_id IS NOT new.project_id) OR EXISTS(SELECT 1 FROM material_link_versions c JOIN material_versions v ON v.id=c.version_id WHERE c.source_id=old.id AND v.project_id IS NOT new.project_id) OR EXISTS(SELECT 1 FROM documents d JOIN material_document_versions c ON c.document_id=d.id JOIN material_versions v ON v.id=c.version_id WHERE d.source_id=old.id AND v.project_id IS NOT new.project_id) BEGIN SELECT RAISE(ABORT, 'material source ownership is immutable'); END;
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
