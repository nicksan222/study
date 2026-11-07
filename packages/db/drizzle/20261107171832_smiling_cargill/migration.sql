CREATE TABLE `integration_import_files` (
	`import_id` text NOT NULL,
	`path` text NOT NULL,
	`content` text NOT NULL,
	`source_id` integer,
	CONSTRAINT `integration_import_files_pk` PRIMARY KEY(`import_id`, `path`),
	CONSTRAINT `fk_integration_import_files_import_id_integration_imports_id_fk` FOREIGN KEY (`import_id`) REFERENCES `integration_imports`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_integration_import_files_source_id_sources_id_fk` FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `integration_import_notes` (
	`import_id` text NOT NULL,
	`key` text NOT NULL,
	`payload` text NOT NULL,
	`fingerprint` text NOT NULL,
	CONSTRAINT `integration_import_notes_pk` PRIMARY KEY(`import_id`, `key`),
	CONSTRAINT `fk_integration_import_notes_import_id_integration_imports_id_fk` FOREIGN KEY (`import_id`) REFERENCES `integration_imports`(`id`) ON DELETE CASCADE,
	CONSTRAINT "integration_import_notes_payload_json" CHECK(json_valid("payload"))
);
--> statement-breakpoint
CREATE TABLE `integration_imports` (
	`id` text PRIMARY KEY,
	`provider_id` text NOT NULL,
	`source_key` text NOT NULL,
	`project_id` integer,
	`state` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_integration_imports_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE SET NULL,
	CONSTRAINT "integration_imports_state_json" CHECK(json_valid("state"))
);
--> statement-breakpoint
CREATE TABLE `integration_receipts` (
	`identity` text PRIMARY KEY,
	`fingerprint` text NOT NULL,
	`import_id` text NOT NULL,
	`session_id` integer,
	`document_id` integer,
	CONSTRAINT `fk_integration_receipts_import_id_integration_imports_id_fk` FOREIGN KEY (`import_id`) REFERENCES `integration_imports`(`id`),
	CONSTRAINT `fk_integration_receipts_session_id_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_integration_receipts_document_id_study_documents_id_fk` FOREIGN KEY (`document_id`) REFERENCES `study_documents`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX `integration_imports_created_idx` ON `integration_imports` (`created_at`,`id`);