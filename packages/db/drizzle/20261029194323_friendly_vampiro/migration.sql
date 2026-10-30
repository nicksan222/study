CREATE TABLE `material_source_snapshots` (
	`version_id` integer PRIMARY KEY,
	`source_id` integer NOT NULL,
	`revision` integer NOT NULL,
	`metadata` text NOT NULL,
	CONSTRAINT `fk_material_source_snapshots_version_id_material_versions_id_fk` FOREIGN KEY (`version_id`) REFERENCES `material_versions`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_material_source_snapshots_source_id_revision_source_snapshots_source_id_revision_fk` FOREIGN KEY (`source_id`,`revision`) REFERENCES `source_snapshots`(`source_id`,`revision`)
);
