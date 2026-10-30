CREATE TABLE `learning_practice_controls` (
	`project_id` integer PRIMARY KEY,
	`epoch` text NOT NULL,
	`enabled` integer NOT NULL,
	CONSTRAINT `fk_learning_practice_controls_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
	CONSTRAINT "learning_practice_control_values" CHECK(length("epoch") > 0 AND "enabled" IN (0, 1))
);
--> statement-breakpoint
CREATE TABLE `learning_practice_slots` (
	`id` text PRIMARY KEY,
	`project_id` integer NOT NULL,
	`epoch` text NOT NULL,
	`ordinal` integer NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`input_version_ids` text NOT NULL,
	`version_id` integer,
	`attempt_id` integer,
	CONSTRAINT `fk_learning_practice_slots_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_learning_practice_slots_version_id_material_versions_id_fk` FOREIGN KEY (`version_id`) REFERENCES `material_versions`(`id`),
	CONSTRAINT `fk_learning_practice_slots_attempt_id_material_quiz_attempts_id_fk` FOREIGN KEY (`attempt_id`) REFERENCES `material_quiz_attempts`(`id`),
	CONSTRAINT "learning_practice_slot_values" CHECK(length("id") > 0 AND length("epoch") > 0 AND "ordinal" >= 0 AND "kind" IN ('choice', 'open') AND "status" IN ('pending', 'ready', 'answered', 'cancelled') AND json_valid("input_version_ids") AND (("version_id" IS NULL) = ("attempt_id" IS NULL)) AND ("status" NOT IN ('ready', 'answered') OR "version_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE `material_generation_scopes` (
	`id` text PRIMARY KEY,
	`project_id` integer NOT NULL,
	`enabled` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_material_generation_scopes_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
	CONSTRAINT "material_generation_scope_values" CHECK(length("id") > 0 AND "enabled" IN (0, 1) AND "created_at" >= 0 AND "updated_at" >= "created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `learning_practice_slot_ordinal` ON `learning_practice_slots` (`project_id`,`epoch`,`ordinal`);--> statement-breakpoint
CREATE INDEX `learning_practice_slot_status` ON `learning_practice_slots` (`project_id`,`epoch`,`status`);