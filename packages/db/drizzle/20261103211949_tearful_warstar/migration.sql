CREATE TABLE `study_document_citation_assessments` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`version_id` integer NOT NULL,
	`marker` integer NOT NULL,
	`payload` text NOT NULL,
	CONSTRAINT `fk_study_document_citation_assessments_version_id_marker_study_document_citations_version_id_marker_fk` FOREIGN KEY (`version_id`,`marker`) REFERENCES `study_document_citations`(`version_id`,`marker`),
	CONSTRAINT "study_document_assessment_payload" CHECK(json_valid("payload"))
);
