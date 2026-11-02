CREATE TABLE `material_history_members` (
	`version_id` integer PRIMARY KEY,
	`operation_id` text NOT NULL,
	CONSTRAINT `fk_material_history_members_version_id_material_versions_id_fk` FOREIGN KEY (`version_id`) REFERENCES `material_versions`(`id`),
	CONSTRAINT `fk_material_history_members_operation_id_material_history_prunes_operation_id_fk` FOREIGN KEY (`operation_id`) REFERENCES `material_history_prunes`(`operation_id`)
);
--> statement-breakpoint
CREATE TABLE `material_history_prunes` (
	`operation_id` text PRIMARY KEY,
	`material_id` integer NOT NULL,
	`keep_latest` integer NOT NULL,
	`token` text NOT NULL,
	`selection` text NOT NULL,
	`status` text NOT NULL,
	`attempt` integer DEFAULT 1 NOT NULL,
	`error_kind` text,
	`created_at` integer NOT NULL,
	`completed_at` integer,
	CONSTRAINT `fk_material_history_prunes_material_id_materials_id_fk` FOREIGN KEY (`material_id`) REFERENCES `materials`(`id`),
	CONSTRAINT "material_history_prune_state" CHECK(
  "keep_latest" BETWEEN 1 AND 1000 AND "attempt" >= 1 AND
  length("operation_id") BETWEEN 1 AND 200 AND length("token")=64 AND
  json_valid("selection") AND json_array_length("selection") <= 100 AND
  "status" IN ('pending','failed','completed') AND
  (("status"='completed')=("completed_at" IS NOT NULL)) AND
  (("status"='failed')=("error_kind" IS NOT NULL))
)
);
--> statement-breakpoint
CREATE TABLE `material_history_requests` (
	`request_id` text PRIMARY KEY,
	`operation_id` text NOT NULL,
	`kind` text NOT NULL,
	CONSTRAINT `fk_material_history_requests_operation_id_material_history_prunes_operation_id_fk` FOREIGN KEY (`operation_id`) REFERENCES `material_history_prunes`(`operation_id`)
);
--> statement-breakpoint
CREATE TABLE `source_history_documents` (
	`operation_id` text NOT NULL,
	`document_id` integer NOT NULL,
	CONSTRAINT `source_history_documents_pk` PRIMARY KEY(`operation_id`, `document_id`),
	CONSTRAINT `fk_source_history_documents_operation_id_material_history_prunes_operation_id_fk` FOREIGN KEY (`operation_id`) REFERENCES `material_history_prunes`(`operation_id`)
);
--> statement-breakpoint
CREATE TABLE `source_history_revisions` (
	`operation_id` text NOT NULL,
	`source_id` integer NOT NULL,
	`revision` integer NOT NULL,
	CONSTRAINT `source_history_revisions_pk` PRIMARY KEY(`operation_id`, `source_id`, `revision`),
	CONSTRAINT `fk_source_history_revisions_operation_id_material_history_prunes_operation_id_fk` FOREIGN KEY (`operation_id`) REFERENCES `material_history_prunes`(`operation_id`)
);
