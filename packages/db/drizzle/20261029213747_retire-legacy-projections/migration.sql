PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_message_versions` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`message_id` integer NOT NULL,
	`number` integer NOT NULL,
	`origin` text NOT NULL,
	`instruction` text,
	`status` text NOT NULL,
	`text` text DEFAULT '' NOT NULL,
	`based_on` integer,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_message_versions_message_id_messages_id_fk` FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_message_versions_origin_codes_version_origin_code_fk` FOREIGN KEY (`origin`) REFERENCES `codes_version_origin`(`code`),
	CONSTRAINT `fk_message_versions_status_codes_message_status_code_fk` FOREIGN KEY (`status`) REFERENCES `codes_message_status`(`code`),
	CONSTRAINT `fk_message_versions_based_on_message_versions_id_fk` FOREIGN KEY (`based_on`) REFERENCES `message_versions`(`id`) ON DELETE SET NULL,
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
INSERT INTO `__new_message_versions`(`id`, `message_id`, `number`, `origin`, `instruction`, `status`, `text`, `based_on`, `created_at`) SELECT `id`, `message_id`, `number`, `origin`, `instruction`, `status`, `text`, `based_on`, `created_at` FROM `message_versions`;--> statement-breakpoint
DROP TABLE `message_versions`;--> statement-breakpoint
ALTER TABLE `__new_message_versions` RENAME TO `message_versions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
DROP INDEX IF EXISTS `artifact_citations_source_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `artifact_sources_unique_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `artifact_sources_source_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `artifacts_update_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `artifacts_material_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `artifacts_project_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `artifacts_piece_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `artifacts_practice_id_unique`;--> statement-breakpoint
DROP INDEX IF EXISTS `cards_question_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `cards_material_card_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `cards_due_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `cards_artifact_id_ordinal_unique`;--> statement-breakpoint
DROP INDEX IF EXISTS `reviews_card_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `practice_questions_practice_id_ordinal_unique`;--> statement-breakpoint
DROP INDEX IF EXISTS `practices_updated_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `practices_project_id_unique`;--> statement-breakpoint
DROP INDEX IF EXISTS `question_citations_source_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `job_deps_depends_on_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `jobs_source_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `jobs_session_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `jobs_question_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `jobs_pending_dedupe_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `jobs_message_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `jobs_document_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `jobs_claim_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `jobs_artifact_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `workflow_job_bindings_job_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `message_versions_unfinished_idx` ON `message_versions` (`message_id`) WHERE status != 'complete';--> statement-breakpoint
CREATE INDEX `message_versions_based_on_idx` ON `message_versions` (`based_on`) WHERE based_on IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `message_versions_message_id_number_unique` ON `message_versions` (`message_id`,`number`);--> statement-breakpoint
DROP TABLE `artifact_citations`;--> statement-breakpoint
DROP TABLE `artifact_note_snapshots`;--> statement-breakpoint
DROP TABLE `artifact_sources`;--> statement-breakpoint
DROP TABLE `artifacts`;--> statement-breakpoint
DROP TABLE `cards`;--> statement-breakpoint
DROP TABLE `reviews`;--> statement-breakpoint
DROP TABLE `practice_questions`;--> statement-breakpoint
DROP TABLE `practices`;--> statement-breakpoint
DROP TABLE `question_citations`;--> statement-breakpoint
DROP TABLE `job_deps`;--> statement-breakpoint
DROP TABLE `jobs`;--> statement-breakpoint
DROP TABLE `codes_artifact_kind`;--> statement-breakpoint
DROP TABLE `codes_artifact_status`;--> statement-breakpoint
DROP TABLE `codes_error_kind`;--> statement-breakpoint
DROP TABLE `codes_job_kind`;--> statement-breakpoint
DROP TABLE `codes_job_status`;--> statement-breakpoint
DROP TABLE `codes_question_kind`;--> statement-breakpoint
DROP TABLE `codes_question_status`;--> statement-breakpoint
DROP TABLE `codes_rating`;--> statement-breakpoint
DROP TABLE `codes_requirement`;--> statement-breakpoint
DROP TABLE `codes_verdict`;--> statement-breakpoint
DROP TABLE `workflow_job_bindings`;