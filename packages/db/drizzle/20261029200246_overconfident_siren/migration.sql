CREATE TABLE `material_generation_inputs` (
	`request_id` text NOT NULL,
	`project_id` integer NOT NULL,
	`version_id` integer NOT NULL,
	`position` integer NOT NULL,
	CONSTRAINT `material_generation_inputs_pk` PRIMARY KEY(`request_id`, `version_id`),
	CONSTRAINT `fk_material_generation_inputs_request_id_project_id_material_generation_requests_id_project_id_fk` FOREIGN KEY (`request_id`,`project_id`) REFERENCES `material_generation_requests`(`id`,`project_id`) ON DELETE CASCADE,
	CONSTRAINT `fk_material_generation_inputs_version_id_project_id_material_versions_id_project_id_fk` FOREIGN KEY (`version_id`,`project_id`) REFERENCES `material_versions`(`id`,`project_id`),
	CONSTRAINT "material_generation_inputs_position_check" CHECK("position" >= 0)
);
--> statement-breakpoint
CREATE TABLE `material_generation_requests` (
	`id` text PRIMARY KEY,
	`project_id` integer NOT NULL,
	`payload` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_material_generation_requests_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
	CONSTRAINT "material_generation_payload_check" CHECK(json_valid("payload"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `material_generation_inputs_position_unique` ON `material_generation_inputs` (`request_id`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `material_generation_requests_id_project_unique` ON `material_generation_requests` (`id`,`project_id`);