CREATE TABLE `source_processing` (
	`source_id` integer PRIMARY KEY,
	`revision` integer NOT NULL,
	`request_id` text NOT NULL,
	`document_id` integer,
	CONSTRAINT `fk_source_processing_source_id_sources_id_fk` FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_source_processing_document_id_documents_id_fk` FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON DELETE SET NULL,
	CONSTRAINT "source_processing_revision_check" CHECK("revision" > 0),
	CONSTRAINT "source_processing_request_check" CHECK(length("request_id") > 0)
);
--> statement-breakpoint
CREATE TABLE `source_snapshots` (
	`source_id` integer NOT NULL,
	`revision` integer NOT NULL,
	`bytes` blob NOT NULL,
	CONSTRAINT `source_snapshots_pk` PRIMARY KEY(`source_id`, `revision`),
	CONSTRAINT `fk_source_snapshots_source_id_sources_id_fk` FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON DELETE CASCADE,
	CONSTRAINT "source_snapshots_revision_check" CHECK("revision" > 0)
);
