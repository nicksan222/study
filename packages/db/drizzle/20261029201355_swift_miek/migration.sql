ALTER TABLE `material_generation_requests` ADD `result_version_id` integer;--> statement-breakpoint
ALTER TABLE `material_generation_requests` ADD `result_hash` text;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_material_generation_requests` (
	`id` text PRIMARY KEY,
	`project_id` integer NOT NULL,
	`payload` text NOT NULL,
	`result_version_id` integer,
	`result_hash` text,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_material_generation_requests_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_material_generation_requests_result_version_id_project_id_material_versions_id_project_id_fk` FOREIGN KEY (`result_version_id`,`project_id`) REFERENCES `material_versions`(`id`,`project_id`),
	CONSTRAINT "material_generation_payload_check" CHECK(json_valid("payload")),
	CONSTRAINT "material_generation_result_pair_check" CHECK(("result_version_id" IS NULL) = ("result_hash" IS NULL))
);
--> statement-breakpoint
INSERT INTO `__new_material_generation_requests`(`id`, `project_id`, `payload`, `created_at`) SELECT `id`, `project_id`, `payload`, `created_at` FROM `material_generation_requests`;--> statement-breakpoint
DROP TABLE `material_generation_requests`;--> statement-breakpoint
ALTER TABLE `__new_material_generation_requests` RENAME TO `material_generation_requests`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `material_generation_requests_id_project_unique` ON `material_generation_requests` (`id`,`project_id`);--> statement-breakpoint
CREATE TRIGGER material_generation_result_immutable BEFORE UPDATE OF result_version_id, result_hash ON material_generation_requests
WHEN OLD.result_version_id IS NOT NULL AND (NEW.result_version_id IS NOT OLD.result_version_id OR NEW.result_hash IS NOT OLD.result_hash)
BEGIN SELECT RAISE(ABORT, 'generation result is immutable'); END;
