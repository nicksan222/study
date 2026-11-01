CREATE TABLE `material_imports` (
	`source_id` integer PRIMARY KEY,
	`material_id` integer NOT NULL,
	CONSTRAINT `fk_material_imports_source_id_sources_id_fk` FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`),
	CONSTRAINT `fk_material_imports_material_id_materials_id_fk` FOREIGN KEY (`material_id`) REFERENCES `materials`(`id`)
);
--> statement-breakpoint
ALTER TABLE `material_source_snapshots` ADD `document_id` integer REFERENCES documents(id);--> statement-breakpoint
CREATE UNIQUE INDEX `material_imports_material_unique` ON `material_imports` (`material_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `material_source_document_unique` ON `material_source_snapshots` (`document_id`);