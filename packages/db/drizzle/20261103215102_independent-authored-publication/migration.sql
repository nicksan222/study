PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_study_document_generation_requests` (
	`id` text PRIMARY KEY,
	`document_id` integer NOT NULL,
	`expected_version_id` integer,
	`session_id` integer,
	`intent_hash` text NOT NULL,
	`result_version_id` integer,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_study_document_generation_requests_document_id_study_documents_id_fk` FOREIGN KEY (`document_id`) REFERENCES `study_documents`(`id`),
	CONSTRAINT `fk_study_document_generation_requests_session_id_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_study_document_generation_requests_result_version_id_study_document_versions_id_fk` FOREIGN KEY (`result_version_id`) REFERENCES `study_document_versions`(`id`),
	CONSTRAINT `fk_study_document_generation_requests_expected_version_id_document_id_study_document_versions_id_document_id_fk` FOREIGN KEY (`expected_version_id`,`document_id`) REFERENCES `study_document_versions`(`id`,`document_id`),
	CONSTRAINT "study_document_generation_hash" CHECK(length("intent_hash")=64),
	CONSTRAINT "study_document_creation_result" CHECK("expected_version_id" IS NOT NULL OR "result_version_id" IS NOT NULL)
);
--> statement-breakpoint
INSERT INTO `__new_study_document_generation_requests`(`id`, `document_id`, `expected_version_id`, `session_id`, `intent_hash`, `result_version_id`, `created_at`) SELECT `id`, `document_id`, `expected_version_id`, `session_id`, `intent_hash`, `result_version_id`, `created_at` FROM `study_document_generation_requests`;--> statement-breakpoint
DROP TABLE `study_document_generation_requests`;--> statement-breakpoint
ALTER TABLE `__new_study_document_generation_requests` RENAME TO `study_document_generation_requests`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
--> statement-breakpoint
CREATE TRIGGER study_document_generation_intent BEFORE UPDATE ON study_document_generation_requests
WHEN NEW.id IS NOT OLD.id OR NEW.document_id IS NOT OLD.document_id OR NEW.expected_version_id IS NOT OLD.expected_version_id OR NEW.intent_hash IS NOT OLD.intent_hash OR NEW.created_at IS NOT OLD.created_at OR (NEW.session_id IS NOT OLD.session_id AND NEW.session_id IS NOT NULL) OR (OLD.result_version_id IS NOT NULL AND NEW.result_version_id IS NOT OLD.result_version_id)
BEGIN SELECT RAISE(ABORT,'generation publication intent and result are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_input_publication BEFORE UPDATE OF status ON study_document_versions
WHEN NEW.status='published' AND EXISTS(SELECT 1 FROM study_document_inputs i JOIN study_document_versions target ON target.id=i.document_version_id WHERE i.version_id=NEW.id AND (target.status!='published' OR target.id=NEW.id OR EXISTS(SELECT 1 FROM study_document_retirements r WHERE r.version_id=target.id)))
BEGIN SELECT RAISE(ABORT,'authored publication requires retained published exact document inputs'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_annotation_revisions_delete BEFORE DELETE ON study_document_annotation_revisions BEGIN SELECT RAISE(ABORT,'annotation history is append-only'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_annotations_delete BEFORE DELETE ON study_document_annotations BEGIN SELECT RAISE(ABORT,'annotation identity is retained'); END;
