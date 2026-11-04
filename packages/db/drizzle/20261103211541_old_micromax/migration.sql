CREATE TABLE `source_extraction_revisions` (
	`source_id` integer NOT NULL,
	`revision` integer NOT NULL,
	`snapshot_id` integer NOT NULL,
	CONSTRAINT `source_extraction_revisions_pk` PRIMARY KEY(`source_id`, `revision`, `snapshot_id`),
	CONSTRAINT `fk_source_extraction_revisions_snapshot_id_content_snapshots_id_fk` FOREIGN KEY (`snapshot_id`) REFERENCES `content_snapshots`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_source_extraction_revisions_source_id_revision_source_snapshots_source_id_revision_fk` FOREIGN KEY (`source_id`,`revision`) REFERENCES `source_snapshots`(`source_id`,`revision`) ON DELETE CASCADE
);
--> statement-breakpoint
INSERT OR IGNORE INTO source_extraction_revisions(source_id,revision,snapshot_id)
SELECT source_id,revision,document_id FROM material_source_snapshots WHERE document_id IS NOT NULL;
--> statement-breakpoint
INSERT OR IGNORE INTO source_extraction_revisions(source_id,revision,snapshot_id)
SELECT p.source_id,p.revision,p.document_id FROM source_processing p JOIN source_snapshots s ON s.source_id=p.source_id AND s.revision=p.revision WHERE p.document_id IS NOT NULL;
--> statement-breakpoint
ALTER TABLE `study_document_inputs` ADD `exact_message_version_id` integer;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_study_document_inputs` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`version_id` integer,
	`request_id` text,
	`position` integer NOT NULL,
	`document_version_id` integer,
	`source_id` integer,
	`source_revision` integer,
	`source_snapshot_id` integer,
	`message_version_id` integer,
	`exact_message_version_id` integer,
	`legacy_material_version_id` integer,
	CONSTRAINT `fk_study_document_inputs_version_id_study_document_versions_id_fk` FOREIGN KEY (`version_id`) REFERENCES `study_document_versions`(`id`),
	CONSTRAINT `fk_study_document_inputs_request_id_study_document_generation_requests_id_fk` FOREIGN KEY (`request_id`) REFERENCES `study_document_generation_requests`(`id`),
	CONSTRAINT `fk_study_document_inputs_document_version_id_study_document_versions_id_fk` FOREIGN KEY (`document_version_id`) REFERENCES `study_document_versions`(`id`),
	CONSTRAINT `fk_study_document_inputs_source_snapshot_id_content_snapshots_id_fk` FOREIGN KEY (`source_snapshot_id`) REFERENCES `content_snapshots`(`id`),
	CONSTRAINT `fk_study_document_inputs_message_version_id_message_versions_id_fk` FOREIGN KEY (`message_version_id`) REFERENCES `message_versions`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_study_document_inputs_legacy_material_version_id_material_versions_id_fk` FOREIGN KEY (`legacy_material_version_id`) REFERENCES `material_versions`(`id`),
	CONSTRAINT `fk_study_document_inputs_source_id_source_revision_source_snapshots_source_id_revision_fk` FOREIGN KEY (`source_id`,`source_revision`) REFERENCES `source_snapshots`(`source_id`,`revision`),
	CONSTRAINT `fk_study_document_inputs_source_id_source_revision_source_snapshot_id_source_extraction_revisions_source_id_revision_snapshot_id_fk` FOREIGN KEY (`source_id`,`source_revision`,`source_snapshot_id`) REFERENCES `source_extraction_revisions`(`source_id`,`revision`,`snapshot_id`),
	CONSTRAINT "study_document_inputs_exact_target" CHECK(("version_id" IS NOT NULL) != ("request_id" IS NOT NULL) AND "position">=0 AND
 (("document_version_id" IS NOT NULL)+("source_id" IS NOT NULL)+("exact_message_version_id" IS NOT NULL)+("legacy_material_version_id" IS NOT NULL))=1 AND
 (("source_id" IS NULL)=("source_revision" IS NULL)) AND ("source_snapshot_id" IS NULL OR "source_id" IS NOT NULL) AND ("source_revision" IS NULL OR "source_revision">0) AND ("message_version_id" IS NULL OR "message_version_id"="exact_message_version_id"))
);
--> statement-breakpoint
INSERT INTO `__new_study_document_inputs`(`id`, `version_id`, `request_id`, `position`, `document_version_id`, `source_id`, `source_revision`, `source_snapshot_id`, `message_version_id`, `exact_message_version_id`, `legacy_material_version_id`) SELECT `id`, `version_id`, `request_id`, `position`, `document_version_id`, `source_id`, `source_revision`, `source_snapshot_id`, `message_version_id`, `message_version_id`, `legacy_material_version_id` FROM `study_document_inputs`;--> statement-breakpoint
DROP TABLE `study_document_inputs`;--> statement-breakpoint
ALTER TABLE `__new_study_document_inputs` RENAME TO `study_document_inputs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `study_document_inputs_owner` ON `study_document_inputs` (`id`,`version_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `study_document_inputs_version_position` ON `study_document_inputs` (`version_id`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `study_document_inputs_request_position` ON `study_document_inputs` (`request_id`,`position`);
--> statement-breakpoint
CREATE TRIGGER study_document_inputs_insert BEFORE INSERT ON study_document_inputs WHEN EXISTS(SELECT 1 FROM study_document_versions WHERE id=NEW.version_id AND status='published') BEGIN SELECT RAISE(ABORT,'published document evidence is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_inputs_update BEFORE UPDATE ON study_document_inputs WHEN (EXISTS(SELECT 1 FROM study_document_versions WHERE id=NEW.version_id AND status='published') OR EXISTS(SELECT 1 FROM study_document_versions WHERE id=OLD.version_id AND status='published')) AND NOT (OLD.message_version_id IS NOT NULL AND NEW.message_version_id IS NULL AND NEW.id IS OLD.id AND NEW.version_id IS OLD.version_id AND NEW.request_id IS OLD.request_id AND NEW.position IS OLD.position AND NEW.document_version_id IS OLD.document_version_id AND NEW.source_id IS OLD.source_id AND NEW.source_revision IS OLD.source_revision AND NEW.source_snapshot_id IS OLD.source_snapshot_id AND NEW.exact_message_version_id IS OLD.exact_message_version_id AND NEW.legacy_material_version_id IS OLD.legacy_material_version_id) BEGIN SELECT RAISE(ABORT,'published document evidence is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_inputs_delete BEFORE DELETE ON study_document_inputs WHEN (EXISTS(SELECT 1 FROM study_document_versions WHERE id=OLD.version_id AND status='published')) AND NOT EXISTS(SELECT 1 FROM study_document_retirements WHERE version_id=OLD.version_id) BEGIN SELECT RAISE(ABORT,'published document evidence is immutable'); END;
--> statement-breakpoint
DROP TRIGGER study_document_citations_insert;
--> statement-breakpoint
CREATE TRIGGER study_document_citations_insert BEFORE INSERT ON study_document_citations WHEN EXISTS(SELECT 1 FROM study_document_versions WHERE id=NEW.version_id AND status='published') BEGIN SELECT RAISE(ABORT,'published document evidence is immutable'); END;
--> statement-breakpoint
DROP TRIGGER study_document_citations_update;
--> statement-breakpoint
CREATE TRIGGER study_document_citations_update BEFORE UPDATE ON study_document_citations WHEN EXISTS(SELECT 1 FROM study_document_versions WHERE id=NEW.version_id AND status='published') OR EXISTS(SELECT 1 FROM study_document_versions WHERE id=OLD.version_id AND status='published') BEGIN SELECT RAISE(ABORT,'published document evidence is immutable'); END;
--> statement-breakpoint
DROP TRIGGER study_document_citations_delete;
--> statement-breakpoint
CREATE TRIGGER study_document_citations_delete BEFORE DELETE ON study_document_citations WHEN (EXISTS(SELECT 1 FROM study_document_versions WHERE id=OLD.version_id AND status='published')) AND NOT EXISTS(SELECT 1 FROM study_document_retirements WHERE version_id=OLD.version_id) BEGIN SELECT RAISE(ABORT,'published document evidence is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_source_input BEFORE INSERT ON study_document_inputs
WHEN NEW.source_snapshot_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM content_snapshots WHERE id=NEW.source_snapshot_id AND source_id=NEW.source_id)
BEGIN SELECT RAISE(ABORT,'source snapshot must belong to exact source'); END;
--> statement-breakpoint
CREATE TRIGGER source_extraction_revisions_insert AFTER INSERT ON source_processing
 WHEN NEW.document_id IS NOT NULL AND NEW.published_request_id=NEW.request_id AND EXISTS(SELECT 1 FROM source_snapshots WHERE source_id=NEW.source_id AND revision=NEW.revision)
 BEGIN INSERT OR IGNORE INTO source_extraction_revisions(source_id,revision,snapshot_id) VALUES(NEW.source_id,NEW.revision,NEW.document_id); END;
--> statement-breakpoint
CREATE TRIGGER source_extraction_revisions_update AFTER UPDATE ON source_processing
 WHEN NEW.document_id IS NOT NULL AND NEW.published_request_id=NEW.request_id AND EXISTS(SELECT 1 FROM source_snapshots WHERE source_id=NEW.source_id AND revision=NEW.revision)
 BEGIN INSERT OR IGNORE INTO source_extraction_revisions(source_id,revision,snapshot_id) VALUES(NEW.source_id,NEW.revision,NEW.document_id); END;
--> statement-breakpoint
CREATE TRIGGER study_document_input_message BEFORE INSERT ON study_document_inputs
WHEN NEW.exact_message_version_id IS NOT NULL AND (NEW.message_version_id IS NOT NEW.exact_message_version_id OR NOT EXISTS(SELECT 1 FROM message_versions WHERE id=NEW.message_version_id AND status='complete'))
BEGIN SELECT RAISE(ABORT,'message input requires exact complete message version'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_annotation_snapshot BEFORE INSERT ON study_document_annotation_revisions
WHEN NOT EXISTS(SELECT 1 FROM study_document_versions WHERE id=NEW.version_id AND document_id=NEW.document_id AND content_snapshot_id=NEW.snapshot_id)
BEGIN SELECT RAISE(ABORT,'annotation target must match exact authored version'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_annotation_revisions_update BEFORE UPDATE ON study_document_annotation_revisions BEGIN SELECT RAISE(ABORT,'annotation revisions are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER authored_source_revision_update BEFORE UPDATE ON source_snapshots WHEN EXISTS(SELECT 1 FROM study_document_inputs WHERE source_id=OLD.source_id AND source_revision=OLD.revision) BEGIN SELECT RAISE(ABORT,'authored provenance pins exact source revision'); END;
--> statement-breakpoint
CREATE TRIGGER authored_source_content_snapshots_update BEFORE UPDATE ON content_snapshots WHEN EXISTS(SELECT 1 FROM study_document_inputs WHERE source_snapshot_id=OLD.id OR source_snapshot_id=NEW.id) BEGIN SELECT RAISE(ABORT,'authored provenance pins exact source extraction'); END;
--> statement-breakpoint
CREATE TRIGGER authored_source_content_snapshots_delete BEFORE DELETE ON content_snapshots WHEN EXISTS(SELECT 1 FROM study_document_inputs WHERE source_snapshot_id=OLD.id) BEGIN SELECT RAISE(ABORT,'authored provenance pins exact source extraction'); END;
--> statement-breakpoint
CREATE TRIGGER authored_source_blocks_insert BEFORE INSERT ON blocks WHEN EXISTS(SELECT 1 FROM study_document_inputs WHERE source_snapshot_id=NEW.document_id) BEGIN SELECT RAISE(ABORT,'authored provenance pins exact source extraction'); END;
--> statement-breakpoint
CREATE TRIGGER authored_source_blocks_update BEFORE UPDATE ON blocks WHEN EXISTS(SELECT 1 FROM study_document_inputs WHERE source_snapshot_id=OLD.document_id OR source_snapshot_id=NEW.document_id) BEGIN SELECT RAISE(ABORT,'authored provenance pins exact source extraction'); END;
--> statement-breakpoint
CREATE TRIGGER authored_source_blocks_delete BEFORE DELETE ON blocks WHEN EXISTS(SELECT 1 FROM study_document_inputs WHERE source_snapshot_id=OLD.document_id) BEGIN SELECT RAISE(ABORT,'authored provenance pins exact source extraction'); END;
