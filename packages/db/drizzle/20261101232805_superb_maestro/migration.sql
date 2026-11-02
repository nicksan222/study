CREATE TABLE `material_annotation_revisions` (
	`annotation_id` integer NOT NULL,
	`revision` integer NOT NULL,
	`version_id` integer NOT NULL,
	`document_id` integer NOT NULL,
	`payload` text NOT NULL,
	CONSTRAINT `material_annotation_revisions_pk` PRIMARY KEY(`annotation_id`, `revision`),
	CONSTRAINT `fk_material_annotation_revisions_annotation_id_material_annotations_id_fk` FOREIGN KEY (`annotation_id`) REFERENCES `material_annotations`(`id`),
	CONSTRAINT `fk_material_annotation_revisions_version_id_material_versions_id_fk` FOREIGN KEY (`version_id`) REFERENCES `material_versions`(`id`),
	CONSTRAINT `fk_material_annotation_revisions_document_id_documents_id_fk` FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`),
	CONSTRAINT "material_annotation_revisions_payload_check" CHECK(json_valid("payload") AND "revision" >= 1)
);
--> statement-breakpoint
CREATE TABLE `material_annotations` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`material_id` integer NOT NULL,
	`revision` integer NOT NULL,
	CONSTRAINT `fk_material_annotations_material_id_materials_id_fk` FOREIGN KEY (`material_id`) REFERENCES `materials`(`id`),
	CONSTRAINT "material_annotations_revision_check" CHECK("revision" >= 1)
);
--> statement-breakpoint
CREATE TABLE `material_citation_assessments` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`claim_version_id` integer NOT NULL,
	`evidence_version_id` integer NOT NULL,
	`marker` integer NOT NULL,
	`payload` text NOT NULL,
	CONSTRAINT `fk_material_citation_assessments_claim_version_id_material_versions_id_fk` FOREIGN KEY (`claim_version_id`) REFERENCES `material_versions`(`id`),
	CONSTRAINT `fk_material_citation_assessments_evidence_version_id_material_versions_id_fk` FOREIGN KEY (`evidence_version_id`) REFERENCES `material_versions`(`id`),
	CONSTRAINT "material_citation_assessments_payload_check" CHECK(json_valid("payload") AND "marker" BETWEEN 1 AND 4294967295)
);
--> statement-breakpoint
CREATE INDEX `material_annotations_material_idx` ON `material_annotations` (`material_id`,`id`);--> statement-breakpoint
CREATE INDEX `material_citation_assessments_claim_idx` ON `material_citation_assessments` (`claim_version_id`,`marker`,`id`);