CREATE TABLE `document_edit_receipts` (
	`material_id` integer NOT NULL,
	`key` text NOT NULL,
	`operation` text NOT NULL,
	`intent` text NOT NULL,
	`expected_version_id` integer NOT NULL,
	`current_version_id` integer NOT NULL,
	`submitted_version_id` integer NOT NULL,
	`outcome` text NOT NULL,
	CONSTRAINT `document_edit_receipts_pk` PRIMARY KEY(`material_id`, `key`),
	CONSTRAINT `fk_document_edit_receipts_material_id_materials_id_fk` FOREIGN KEY (`material_id`) REFERENCES `materials`(`id`),
	CONSTRAINT `fk_document_edit_receipts_expected_version_id_material_versions_id_fk` FOREIGN KEY (`expected_version_id`) REFERENCES `material_versions`(`id`),
	CONSTRAINT `fk_document_edit_receipts_current_version_id_material_versions_id_fk` FOREIGN KEY (`current_version_id`) REFERENCES `material_versions`(`id`),
	CONSTRAINT `fk_document_edit_receipts_submitted_version_id_material_versions_id_fk` FOREIGN KEY (`submitted_version_id`) REFERENCES `material_versions`(`id`),
	CONSTRAINT `fk_document_edit_receipts_expected_version_id_material_id_material_versions_id_material_id_fk` FOREIGN KEY (`expected_version_id`,`material_id`) REFERENCES `material_versions`(`id`,`material_id`),
	CONSTRAINT `fk_document_edit_receipts_current_version_id_material_id_material_versions_id_material_id_fk` FOREIGN KEY (`current_version_id`,`material_id`) REFERENCES `material_versions`(`id`,`material_id`),
	CONSTRAINT `fk_document_edit_receipts_submitted_version_id_material_id_material_versions_id_material_id_fk` FOREIGN KEY (`submitted_version_id`,`material_id`) REFERENCES `material_versions`(`id`,`material_id`),
	CONSTRAINT "document_edit_intent_check" CHECK(json_valid("intent") AND length("key") BETWEEN 1 AND 200),
	CONSTRAINT "document_edit_outcome_check" CHECK("operation" IN ('save','undo') AND "outcome" IN ('saved','conflict') AND ("outcome" != 'saved' OR "expected_version_id" = "current_version_id"))
);
--> statement-breakpoint
CREATE TABLE `document_proposal_receipts` (
	`key` text PRIMARY KEY,
	`request_id` text NOT NULL,
	`operation` text NOT NULL,
	`intent` text NOT NULL,
	`outcome` text NOT NULL,
	`current_version_id` integer NOT NULL,
	`result_version_id` integer,
	CONSTRAINT `fk_document_proposal_receipts_request_id_document_proposals_request_id_fk` FOREIGN KEY (`request_id`) REFERENCES `document_proposals`(`request_id`),
	CONSTRAINT `fk_document_proposal_receipts_current_version_id_material_versions_id_fk` FOREIGN KEY (`current_version_id`) REFERENCES `material_versions`(`id`),
	CONSTRAINT `fk_document_proposal_receipts_result_version_id_material_versions_id_fk` FOREIGN KEY (`result_version_id`) REFERENCES `material_versions`(`id`),
	CONSTRAINT "document_proposal_receipt_intent_check" CHECK(json_valid("intent") AND length("key") BETWEEN 1 AND 200),
	CONSTRAINT "document_proposal_receipt_outcome_check" CHECK(("outcome" = 'conflict' AND "operation" = 'apply' AND "result_version_id" IS NULL) OR ("outcome" = 'applied' AND "operation" = 'apply' AND "result_version_id" IS NOT NULL) OR ("outcome" = 'kept' AND "operation" = 'keep' AND "result_version_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE `document_proposals` (
	`request_id` text PRIMARY KEY,
	`session_id` integer NOT NULL,
	`base_version_id` integer NOT NULL,
	`proposed_version_id` integer NOT NULL UNIQUE,
	CONSTRAINT `fk_document_proposals_request_id_material_generation_requests_id_fk` FOREIGN KEY (`request_id`) REFERENCES `material_generation_requests`(`id`),
	CONSTRAINT `fk_document_proposals_base_version_id_material_versions_id_fk` FOREIGN KEY (`base_version_id`) REFERENCES `material_versions`(`id`),
	CONSTRAINT `fk_document_proposals_proposed_version_id_material_versions_id_fk` FOREIGN KEY (`proposed_version_id`) REFERENCES `material_versions`(`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `document_edit_receipts_submitted_unique` ON `document_edit_receipts` (`submitted_version_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `document_proposal_receipts_completed_unique` ON `document_proposal_receipts` (`request_id`,`operation`) WHERE "document_proposal_receipts"."result_version_id" IS NOT NULL;