DROP TRIGGER material_version_citations_insert_draft;
--> statement-breakpoint
DROP TRIGGER material_version_citations_update_draft;
--> statement-breakpoint
DROP TRIGGER material_version_citations_delete_draft;
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_material_version_citations` (
	`version_id` integer NOT NULL,
	`marker` integer NOT NULL,
	`input_version_id` integer NOT NULL,
	`anchor` text NOT NULL,
	`quote` text NOT NULL,
	CONSTRAINT `fk_material_version_citations_version_id_input_version_id_material_version_inputs_version_id_input_version_id_fk` FOREIGN KEY (`version_id`,`input_version_id`) REFERENCES `material_version_inputs`(`version_id`,`input_version_id`) ON DELETE CASCADE,
	CONSTRAINT "material_version_citations_marker_check" CHECK(typeof(marker) = 'integer' AND marker BETWEEN 1 AND 4294967295),
	CONSTRAINT "material_version_citations_anchor_check" CHECK(CASE WHEN json_valid("anchor") THEN coalesce(
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
	CONSTRAINT "material_version_citations_quote_check" CHECK(length(trim(quote)) > 0)
);
--> statement-breakpoint
INSERT INTO `__new_material_version_citations`(`version_id`, `marker`, `input_version_id`, `anchor`, `quote`) SELECT `version_id`, `marker`, `input_version_id`, `anchor`, `quote` FROM `material_version_citations`;--> statement-breakpoint
DROP TABLE `material_version_citations`;--> statement-breakpoint
ALTER TABLE `__new_material_version_citations` RENAME TO `material_version_citations`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `material_version_citations_marker_unique` ON `material_version_citations` (`version_id`,`marker`);--> statement-breakpoint
CREATE INDEX `material_version_citations_input_idx` ON `material_version_citations` (`input_version_id`);
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
