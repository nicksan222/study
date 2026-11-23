CREATE TABLE `project_sources` (
	`project_id` integer NOT NULL,
	`source_id` integer NOT NULL,
	CONSTRAINT `project_sources_pk` PRIMARY KEY(`project_id`, `source_id`),
	CONSTRAINT `fk_project_sources_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_project_sources_source_id_sources_id_fk` FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `project_sources_source_idx` ON `project_sources` (`source_id`);
--> statement-breakpoint
INSERT INTO project_sources (project_id, source_id)
SELECT DISTINCT subjects.project_id, attachments.source_id
FROM note_sources AS attachments
JOIN project_notes AS subjects ON subjects.note_id = attachments.note_id;
--> statement-breakpoint
DROP TRIGGER material_generation_input_project;
--> statement-breakpoint
CREATE TRIGGER material_generation_input_project BEFORE INSERT ON material_evidence_inputs WHEN NEW.request_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM material_generation_requests r WHERE r.id=NEW.request_id AND ((NEW.note_context_id IS NOT NULL AND EXISTS(
   SELECT 1 FROM note_run_contexts c JOIN project_notes p ON p.note_id=c.note_id
   WHERE c.request_id=NEW.note_context_id AND p.project_id=r.project_id
   AND NOT EXISTS(SELECT 1 FROM note_deletions d WHERE d.note_id=c.note_id)
 )) OR (NEW."page_version_id" IS NOT NULL AND EXISTS(SELECT 1 FROM "page_versions" v JOIN "pages" d ON d.id=v."page_id" JOIN "project_pages" p ON p."page_id"=d.id WHERE v.id=NEW."page_version_id" AND v.status='published' AND d.archived_at IS NULL AND p.project_id=r.project_id AND NOT EXISTS(SELECT 1 FROM "page_retirements" x WHERE x.version_id=v.id))) OR (NEW.source_id IS NOT NULL AND EXISTS(SELECT 1 FROM sources s JOIN source_extraction_revisions e ON e.source_id=s.id WHERE s.id=NEW.source_id AND (s.project_id=r.project_id OR EXISTS(
   SELECT 1 FROM project_sources ps
   WHERE ps.source_id=s.id AND ps.project_id=r.project_id
 )) AND e.revision=NEW.source_revision AND e.snapshot_id=NEW.source_snapshot_id)))) BEGIN SELECT RAISE(ABORT,'exact learning input is outside its project'); END;
--> statement-breakpoint
DROP TRIGGER material_generation_publication_input_project;
--> statement-breakpoint
CREATE TRIGGER material_generation_publication_input_project BEFORE UPDATE OF status ON material_versions
WHEN NEW.status='published' AND OLD.status!='published' AND NEW.generation_request_id IS NOT NULL AND EXISTS(SELECT 1 FROM material_generation_requests r JOIN material_evidence_inputs i ON i.request_id=r.id WHERE r.id=NEW.generation_request_id AND NOT ((i.note_context_id IS NOT NULL AND EXISTS(
   SELECT 1 FROM note_run_contexts c JOIN project_notes p ON p.note_id=c.note_id
   WHERE c.request_id=i.note_context_id AND p.project_id=r.project_id
   AND NOT EXISTS(SELECT 1 FROM note_deletions d WHERE d.note_id=c.note_id)
 )) OR (i."page_version_id" IS NOT NULL AND EXISTS(SELECT 1 FROM "page_versions" v JOIN "pages" d ON d.id=v."page_id" JOIN "project_pages" p ON p."page_id"=d.id WHERE v.id=i."page_version_id" AND v.status='published' AND d.archived_at IS NULL AND p.project_id=r.project_id AND NOT EXISTS(SELECT 1 FROM "page_retirements" x WHERE x.version_id=v.id))) OR (i.source_id IS NOT NULL AND EXISTS(SELECT 1 FROM sources s JOIN source_extraction_revisions e ON e.source_id=s.id WHERE s.id=i.source_id AND (s.project_id=r.project_id OR EXISTS(
   SELECT 1 FROM project_sources ps
   WHERE ps.source_id=s.id AND ps.project_id=r.project_id
 )) AND e.revision=i.source_revision AND e.snapshot_id=i.source_snapshot_id))))
BEGIN SELECT RAISE(ABORT,'exact learning input is outside its project'); END;
--> statement-breakpoint
DROP TRIGGER material_generation_receipt_input_project;
--> statement-breakpoint
CREATE TRIGGER material_generation_receipt_input_project BEFORE UPDATE OF result_version_id ON material_generation_requests
WHEN OLD.result_version_id IS NULL AND NEW.result_version_id IS NOT NULL AND EXISTS(SELECT 1 FROM material_generation_requests r JOIN material_evidence_inputs i ON i.request_id=r.id WHERE r.id=NEW.id AND NOT ((i.note_context_id IS NOT NULL AND EXISTS(
   SELECT 1 FROM note_run_contexts c JOIN project_notes p ON p.note_id=c.note_id
   WHERE c.request_id=i.note_context_id AND p.project_id=r.project_id
   AND NOT EXISTS(SELECT 1 FROM note_deletions d WHERE d.note_id=c.note_id)
 )) OR (i."page_version_id" IS NOT NULL AND EXISTS(SELECT 1 FROM "page_versions" v JOIN "pages" d ON d.id=v."page_id" JOIN "project_pages" p ON p."page_id"=d.id WHERE v.id=i."page_version_id" AND v.status='published' AND d.archived_at IS NULL AND p.project_id=r.project_id AND NOT EXISTS(SELECT 1 FROM "page_retirements" x WHERE x.version_id=v.id))) OR (i.source_id IS NOT NULL AND EXISTS(SELECT 1 FROM sources s JOIN source_extraction_revisions e ON e.source_id=s.id WHERE s.id=i.source_id AND (s.project_id=r.project_id OR EXISTS(
   SELECT 1 FROM project_sources ps
   WHERE ps.source_id=s.id AND ps.project_id=r.project_id
 )) AND e.revision=i.source_revision AND e.snapshot_id=i.source_snapshot_id))))
BEGIN SELECT RAISE(ABORT,'exact learning input is outside its project'); END;
--> statement-breakpoint
DELETE FROM preferences WHERE scope = 'workspace' AND key = 'submitOnEnter';
