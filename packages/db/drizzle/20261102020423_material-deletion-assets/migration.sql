CREATE TABLE `source_material_deletion_assets` (
	`deletion_id` integer NOT NULL,
	`source_id` integer NOT NULL,
	`revision` integer NOT NULL,
	CONSTRAINT `source_material_deletion_assets_pk` PRIMARY KEY(`deletion_id`, `source_id`, `revision`),
	CONSTRAINT `fk_source_material_deletion_assets_deletion_id_material_deletions_material_id_fk` FOREIGN KEY (`deletion_id`) REFERENCES `material_deletions`(`material_id`)
);
