CREATE TABLE `material_deletion_members` (
	`material_id` integer PRIMARY KEY,
	`deletion_id` integer NOT NULL,
	CONSTRAINT `fk_material_deletion_members_deletion_id_material_deletions_material_id_fk` FOREIGN KEY (`deletion_id`) REFERENCES `material_deletions`(`material_id`)
);
--> statement-breakpoint
CREATE TABLE `material_deletion_requests` (
	`request_id` text PRIMARY KEY,
	`deletion_id` integer NOT NULL,
	`kind` text NOT NULL,
	CONSTRAINT `fk_material_deletion_requests_deletion_id_material_deletions_material_id_fk` FOREIGN KEY (`deletion_id`) REFERENCES `material_deletions`(`material_id`)
);
--> statement-breakpoint
CREATE TABLE `material_deletions` (
	`material_id` integer PRIMARY KEY,
	`operation_id` text NOT NULL UNIQUE,
	`selection` text NOT NULL,
	`status` text NOT NULL,
	`phase` text DEFAULT 'accepted' NOT NULL,
	`attempt` integer DEFAULT 1 NOT NULL,
	`error_kind` text,
	`created_at` integer NOT NULL,
	`completed_at` integer,
	CONSTRAINT "material_deletion_state" CHECK("attempt" >= 1 AND json_valid("selection") AND "status" IN ('pending','failed','completed') AND "phase" IN ('accepted','retired','completed') AND (("status"='completed')=("completed_at" IS NOT NULL)) AND (("status"='failed')=("error_kind" IS NOT NULL)))
);
