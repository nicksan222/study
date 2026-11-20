-- Rebuild the exact evidence tables with note captures while preserving existing guards.
DROP TRIGGER "authored_source_blocks_delete";
--> statement-breakpoint
DROP TRIGGER "authored_source_blocks_update";
--> statement-breakpoint
DROP TRIGGER "authored_source_content_snapshots_delete";
--> statement-breakpoint
DROP TRIGGER "authored_source_content_snapshots_update";
--> statement-breakpoint
DROP TRIGGER "learning_practice_inputs_available";
--> statement-breakpoint
DROP TRIGGER "learning_practice_inputs_capture";
--> statement-breakpoint
DROP TRIGGER "learning_practice_inputs_immutable";
--> statement-breakpoint
DROP TRIGGER "learning_practice_inputs_retained";
--> statement-breakpoint
DROP TRIGGER "material_evidence_inputs_available";
--> statement-breakpoint
DROP TRIGGER "material_evidence_inputs_immutable";
--> statement-breakpoint
DROP TRIGGER "source_snapshots_published_delete";
--> statement-breakpoint
DROP TRIGGER "source_snapshots_published_update";
--> statement-breakpoint
DROP TRIGGER "page_retirement_dependencies";
--> statement-breakpoint
DROP TRIGGER "material_generation_input_project";
--> statement-breakpoint
DROP TRIGGER "material_generation_publication_input_project";
--> statement-breakpoint
DROP TRIGGER "material_generation_receipt_input_project";
--> statement-breakpoint
DROP TRIGGER "material_evidence_inputs_owner";
--> statement-breakpoint
DROP TRIGGER "material_evidence_inputs_retained";
--> statement-breakpoint
DROP TRIGGER "material_generation_publish";
--> statement-breakpoint
DROP TRIGGER "material_generation_receipt_valid";
--> statement-breakpoint
CREATE TABLE `__new_learning_practice_inputs` (
	`slot_id` text NOT NULL,
	`position` integer NOT NULL,
	`page_version_id` integer,
	`note_context_id` text,
	`source_id` integer,
	`source_revision` integer,
	`source_snapshot_id` integer,
	CONSTRAINT `learning_practice_inputs_pk` PRIMARY KEY(`slot_id`, `position`),
	CONSTRAINT `fk_learning_practice_inputs_slot_id_learning_practice_slots_id_fk` FOREIGN KEY (`slot_id`) REFERENCES `learning_practice_slots`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_learning_practice_inputs_document_version_id_study_document_versions_id_fk` FOREIGN KEY (`page_version_id`) REFERENCES `page_versions`(`id`),
	CONSTRAINT `fk_learning_practice_inputs_source_id_source_revision_source_snapshot_id_source_extraction_revisions_source_id_revision_snapshot_id_fk` FOREIGN KEY (`source_id`,`source_revision`,`source_snapshot_id`) REFERENCES `source_extraction_revisions`(`source_id`,`revision`,`snapshot_id`),
	CONSTRAINT "exact_content_input_reference" CHECK((
        ("page_version_id" IS NOT NULL AND "note_context_id" IS NULL AND "source_id" IS NULL AND "source_revision" IS NULL AND "source_snapshot_id" IS NULL)
        OR ("page_version_id" IS NULL AND "note_context_id" IS NULL AND "source_id" IS NOT NULL AND "source_revision">0 AND "source_snapshot_id" IS NOT NULL)
        OR ("page_version_id" IS NULL AND "note_context_id" IS NOT NULL AND "source_id" IS NULL AND "source_revision" IS NULL AND "source_snapshot_id" IS NULL)
      )),
	CONSTRAINT "learning_practice_inputs_position" CHECK("position">=0)
);
--> statement-breakpoint
INSERT INTO `__new_learning_practice_inputs`(`slot_id`, `position`, `page_version_id`, `source_id`, `source_revision`, `source_snapshot_id`) SELECT `slot_id`, `position`, `page_version_id`, `source_id`, `source_revision`, `source_snapshot_id` FROM `learning_practice_inputs`;--> statement-breakpoint
DROP TABLE `learning_practice_inputs`;--> statement-breakpoint
ALTER TABLE `__new_learning_practice_inputs` RENAME TO `learning_practice_inputs`;--> statement-breakpoint
CREATE TABLE `__new_material_evidence_inputs` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`version_id` integer,
	`request_id` text,
	`position` integer NOT NULL,
	`page_version_id` integer,
	`note_context_id` text,
	`source_id` integer,
	`source_revision` integer,
	`source_snapshot_id` integer,
	CONSTRAINT `fk_material_evidence_inputs_version_id_material_versions_id_fk` FOREIGN KEY (`version_id`) REFERENCES `material_versions`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_material_evidence_inputs_request_id_material_generation_requests_id_fk` FOREIGN KEY (`request_id`) REFERENCES `material_generation_requests`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_material_evidence_inputs_document_version_id_study_document_versions_id_fk` FOREIGN KEY (`page_version_id`) REFERENCES `page_versions`(`id`),
	CONSTRAINT `fk_material_evidence_inputs_source_id_source_revision_source_snapshot_id_source_extraction_revisions_source_id_revision_snapshot_id_fk` FOREIGN KEY (`source_id`,`source_revision`,`source_snapshot_id`) REFERENCES `source_extraction_revisions`(`source_id`,`revision`,`snapshot_id`),
	CONSTRAINT "exact_content_input_reference" CHECK((
        ("page_version_id" IS NOT NULL AND "note_context_id" IS NULL AND "source_id" IS NULL AND "source_revision" IS NULL AND "source_snapshot_id" IS NULL)
        OR ("page_version_id" IS NULL AND "note_context_id" IS NULL AND "source_id" IS NOT NULL AND "source_revision">0 AND "source_snapshot_id" IS NOT NULL)
        OR ("page_version_id" IS NULL AND "note_context_id" IS NOT NULL AND "source_id" IS NULL AND "source_revision" IS NULL AND "source_snapshot_id" IS NULL)
      )),
	CONSTRAINT "material_evidence_input_owner" CHECK(("version_id" IS NULL)!=("request_id" IS NULL) AND "position">=0)
);
--> statement-breakpoint
INSERT INTO `__new_material_evidence_inputs`(`id`, `version_id`, `request_id`, `position`, `page_version_id`, `source_id`, `source_revision`, `source_snapshot_id`) SELECT `id`, `version_id`, `request_id`, `position`, `page_version_id`, `source_id`, `source_revision`, `source_snapshot_id` FROM `material_evidence_inputs`;--> statement-breakpoint
DROP TABLE `material_evidence_inputs`;--> statement-breakpoint
ALTER TABLE `__new_material_evidence_inputs` RENAME TO `material_evidence_inputs`;--> statement-breakpoint
CREATE INDEX `learning_practice_inputs_page` ON `learning_practice_inputs` (`page_version_id`);--> statement-breakpoint
CREATE INDEX `learning_practice_inputs_source` ON `learning_practice_inputs` (`source_id`,`source_revision`,`source_snapshot_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `material_evidence_inputs_version_owner` ON `material_evidence_inputs` (`id`,`version_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `material_evidence_inputs_version_position` ON `material_evidence_inputs` (`version_id`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `material_evidence_inputs_request_position` ON `material_evidence_inputs` (`request_id`,`position`);--> statement-breakpoint
CREATE INDEX `material_evidence_inputs_page` ON `material_evidence_inputs` (`page_version_id`);--> statement-breakpoint
CREATE INDEX `material_evidence_inputs_source` ON `material_evidence_inputs` (`source_id`,`source_revision`,`source_snapshot_id`);
--> statement-breakpoint
CREATE TRIGGER authored_source_blocks_delete BEFORE DELETE ON blocks WHEN EXISTS(SELECT 1 FROM (SELECT source_id,revision,snapshot_id FROM "note_reply_sources" UNION ALL SELECT source_id,revision,snapshot_id FROM "note_context_sources" UNION ALL SELECT source_id,source_revision,source_snapshot_id FROM "page_inputs" WHERE source_id IS NOT NULL UNION ALL SELECT source_id,source_revision,source_snapshot_id FROM material_evidence_inputs WHERE source_id IS NOT NULL UNION ALL SELECT source_id,source_revision,source_snapshot_id FROM learning_practice_inputs WHERE source_id IS NOT NULL) p WHERE p.snapshot_id=OLD.document_id) BEGIN SELECT RAISE(ABORT,'exact evidence pins source extraction'); END;
--> statement-breakpoint
CREATE TRIGGER authored_source_blocks_update BEFORE UPDATE ON blocks WHEN EXISTS(SELECT 1 FROM (SELECT source_id,revision,snapshot_id FROM "note_reply_sources" UNION ALL SELECT source_id,revision,snapshot_id FROM "note_context_sources" UNION ALL SELECT source_id,source_revision,source_snapshot_id FROM "page_inputs" WHERE source_id IS NOT NULL UNION ALL SELECT source_id,source_revision,source_snapshot_id FROM material_evidence_inputs WHERE source_id IS NOT NULL UNION ALL SELECT source_id,source_revision,source_snapshot_id FROM learning_practice_inputs WHERE source_id IS NOT NULL) p WHERE p.snapshot_id=OLD.document_id) BEGIN SELECT RAISE(ABORT,'exact evidence pins source extraction'); END;
--> statement-breakpoint
CREATE TRIGGER authored_source_content_snapshots_delete BEFORE DELETE ON content_snapshots WHEN EXISTS(SELECT 1 FROM (SELECT source_id,revision,snapshot_id FROM "note_reply_sources" UNION ALL SELECT source_id,revision,snapshot_id FROM "note_context_sources" UNION ALL SELECT source_id,source_revision,source_snapshot_id FROM "page_inputs" WHERE source_id IS NOT NULL UNION ALL SELECT source_id,source_revision,source_snapshot_id FROM material_evidence_inputs WHERE source_id IS NOT NULL UNION ALL SELECT source_id,source_revision,source_snapshot_id FROM learning_practice_inputs WHERE source_id IS NOT NULL) p WHERE p.snapshot_id=OLD.id) BEGIN SELECT RAISE(ABORT,'exact evidence pins source extraction'); END;
--> statement-breakpoint
CREATE TRIGGER authored_source_content_snapshots_update BEFORE UPDATE ON content_snapshots WHEN EXISTS(SELECT 1 FROM (SELECT source_id,revision,snapshot_id FROM "note_reply_sources" UNION ALL SELECT source_id,revision,snapshot_id FROM "note_context_sources" UNION ALL SELECT source_id,source_revision,source_snapshot_id FROM "page_inputs" WHERE source_id IS NOT NULL UNION ALL SELECT source_id,source_revision,source_snapshot_id FROM material_evidence_inputs WHERE source_id IS NOT NULL UNION ALL SELECT source_id,source_revision,source_snapshot_id FROM learning_practice_inputs WHERE source_id IS NOT NULL) p WHERE p.snapshot_id=OLD.id) BEGIN SELECT RAISE(ABORT,'exact evidence pins source extraction'); END;
--> statement-breakpoint
CREATE TRIGGER learning_practice_inputs_available BEFORE INSERT ON learning_practice_inputs
WHEN NEW."page_version_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "page_versions" v JOIN "pages" d ON d.id=v."page_id"
WHERE v.id=NEW."page_version_id" AND v.status='published' AND d.archived_at IS NULL
AND NOT EXISTS(SELECT 1 FROM "page_retirements" r WHERE r.version_id=v.id))
BEGIN SELECT RAISE(ABORT,'exact authored learning input is unavailable'); END;
--> statement-breakpoint
CREATE TRIGGER learning_practice_inputs_capture BEFORE INSERT ON learning_practice_inputs
WHEN NOT EXISTS(SELECT 1 FROM learning_practice_slots p WHERE p.id=NEW.slot_id AND p.status IN ('pending','ready')
 AND json_extract(p.inputs,'$['||NEW.position||'].kind')=CASE WHEN NEW.note_context_id IS NOT NULL THEN 'note' WHEN NEW."page_version_id" IS NULL THEN 'source' ELSE 'page' END
 AND json_extract(p.inputs,'$['||NEW.position||'].contextId') IS NEW.note_context_id
 AND json_extract(p.inputs,'$['||NEW.position||'].versionId') IS CASE WHEN NEW."page_version_id" IS NULL THEN NULL ELSE CAST(NEW."page_version_id" AS TEXT) END
 AND json_extract(p.inputs,'$['||NEW.position||'].sourceId') IS CASE WHEN NEW.source_id IS NULL THEN NULL ELSE CAST(NEW.source_id AS TEXT) END
 AND json_extract(p.inputs,'$['||NEW.position||'].revision') IS CASE WHEN NEW.source_revision IS NULL THEN NULL ELSE CAST(NEW.source_revision AS TEXT) END
 AND json_extract(p.inputs,'$['||NEW.position||'].snapshotId') IS CASE WHEN NEW.source_snapshot_id IS NULL THEN NULL ELSE CAST(NEW.source_snapshot_id AS TEXT) END)
BEGIN SELECT RAISE(ABORT,'practice evidence does not match exact capture'); END;
--> statement-breakpoint
CREATE TRIGGER learning_practice_inputs_immutable BEFORE UPDATE ON learning_practice_inputs
BEGIN SELECT RAISE(ABORT,'exact learning inputs are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER learning_practice_inputs_retained BEFORE DELETE ON learning_practice_inputs
WHEN EXISTS(SELECT 1 FROM learning_practice_slots p JOIN learning_practice_controls c ON c.project_id=p.project_id AND c.epoch=p.epoch
 WHERE p.id=OLD.slot_id AND p.status IN ('pending','ready') AND c.enabled=1)
BEGIN SELECT RAISE(ABORT,'active practice evidence is retained'); END;
--> statement-breakpoint
CREATE TRIGGER material_evidence_inputs_available BEFORE INSERT ON material_evidence_inputs
WHEN NEW."page_version_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "page_versions" v JOIN "pages" d ON d.id=v."page_id"
WHERE v.id=NEW."page_version_id" AND v.status='published' AND d.archived_at IS NULL
AND NOT EXISTS(SELECT 1 FROM "page_retirements" r WHERE r.version_id=v.id))
BEGIN SELECT RAISE(ABORT,'exact authored learning input is unavailable'); END;
--> statement-breakpoint
CREATE TRIGGER material_evidence_inputs_immutable BEFORE UPDATE ON material_evidence_inputs
BEGIN SELECT RAISE(ABORT,'exact learning inputs are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER source_snapshots_published_delete BEFORE DELETE ON source_snapshots WHEN EXISTS(SELECT 1 FROM (SELECT source_id,revision,snapshot_id FROM "note_reply_sources" UNION ALL SELECT source_id,revision,snapshot_id FROM "note_context_sources" UNION ALL SELECT source_id,source_revision,source_snapshot_id FROM "page_inputs" WHERE source_id IS NOT NULL UNION ALL SELECT source_id,source_revision,source_snapshot_id FROM material_evidence_inputs WHERE source_id IS NOT NULL UNION ALL SELECT source_id,source_revision,source_snapshot_id FROM learning_practice_inputs WHERE source_id IS NOT NULL) p WHERE p.source_id=OLD.source_id AND p.revision=OLD.revision) BEGIN SELECT RAISE(ABORT,'exact input pins source revision'); END;
--> statement-breakpoint
CREATE TRIGGER source_snapshots_published_update BEFORE UPDATE ON source_snapshots WHEN EXISTS(SELECT 1 FROM source_extraction_revisions e WHERE e.source_id=OLD.source_id AND e.revision=OLD.revision) OR EXISTS(SELECT 1 FROM (SELECT source_id,revision,snapshot_id FROM "note_reply_sources" UNION ALL SELECT source_id,revision,snapshot_id FROM "note_context_sources" UNION ALL SELECT source_id,source_revision,source_snapshot_id FROM "page_inputs" WHERE source_id IS NOT NULL UNION ALL SELECT source_id,source_revision,source_snapshot_id FROM material_evidence_inputs WHERE source_id IS NOT NULL UNION ALL SELECT source_id,source_revision,source_snapshot_id FROM learning_practice_inputs WHERE source_id IS NOT NULL) p WHERE p.source_id=OLD.source_id AND p.revision=OLD.revision) BEGIN SELECT RAISE(ABORT,'retained source revision is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER page_retirement_dependencies BEFORE INSERT ON "page_retirements"
WHEN EXISTS(SELECT 1 FROM "page_inputs" i JOIN "page_versions" v ON v.id=i.version_id JOIN "page_versions" target ON target.id=NEW.version_id WHERE i."page_version_id"=NEW.version_id AND v."page_id"!=target."page_id" AND NOT EXISTS(SELECT 1 FROM "page_retirements" r WHERE r.version_id=v.id))
 OR EXISTS(SELECT 1 FROM "page_inputs" WHERE "page_version_id"=NEW.version_id AND request_id IS NOT NULL)
 OR EXISTS(SELECT 1 FROM "note_context_pages" WHERE version_id=NEW.version_id)
 OR EXISTS(SELECT 1 FROM material_evidence_inputs WHERE "page_version_id"=NEW.version_id)
 OR EXISTS(SELECT 1 FROM learning_practice_inputs WHERE "page_version_id"=NEW.version_id)
 OR EXISTS(
  SELECT 1 FROM page_transform_requests r
  JOIN json_each(r.request, '$.studyNotes.inputs') j
  WHERE r.cancelled=0 AND r.result_version_id IS NULL
    AND json_extract(j.value, '$.kind')='page'
    AND json_extract(j.value, '$.versionId')=CAST(NEW.version_id AS TEXT)
 )
BEGIN SELECT RAISE(ABORT,'exact authored inputs protect referenced bodies'); END;
--> statement-breakpoint
CREATE TRIGGER material_generation_input_project BEFORE INSERT ON material_evidence_inputs WHEN NEW.request_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM material_generation_requests r WHERE r.id=NEW.request_id AND ((NEW.note_context_id IS NOT NULL AND EXISTS(
   SELECT 1 FROM note_run_contexts c JOIN project_notes p ON p.note_id=c.note_id
   WHERE c.request_id=NEW.note_context_id AND p.project_id=r.project_id
   AND NOT EXISTS(SELECT 1 FROM note_deletions d WHERE d.note_id=c.note_id)
 )) OR (NEW."page_version_id" IS NOT NULL AND EXISTS(SELECT 1 FROM "page_versions" v JOIN "pages" d ON d.id=v."page_id" JOIN "project_pages" p ON p."page_id"=d.id WHERE v.id=NEW."page_version_id" AND v.status='published' AND d.archived_at IS NULL AND p.project_id=r.project_id AND NOT EXISTS(SELECT 1 FROM "page_retirements" x WHERE x.version_id=v.id))) OR (NEW.source_id IS NOT NULL AND EXISTS(SELECT 1 FROM sources s JOIN source_extraction_revisions e ON e.source_id=s.id WHERE s.id=NEW.source_id AND (s.project_id=r.project_id OR EXISTS(
   SELECT 1 FROM note_sources ns JOIN project_notes pn ON pn.note_id=ns.note_id
   WHERE ns.source_id=s.id AND pn.project_id=r.project_id
 )) AND e.revision=NEW.source_revision AND e.snapshot_id=NEW.source_snapshot_id)))) BEGIN SELECT RAISE(ABORT,'exact learning input is outside its project'); END;
--> statement-breakpoint
CREATE TRIGGER material_generation_publication_input_project BEFORE UPDATE OF status ON material_versions
WHEN NEW.status='published' AND OLD.status!='published' AND NEW.generation_request_id IS NOT NULL AND EXISTS(SELECT 1 FROM material_generation_requests r JOIN material_evidence_inputs i ON i.request_id=r.id WHERE r.id=NEW.generation_request_id AND NOT ((i.note_context_id IS NOT NULL AND EXISTS(
   SELECT 1 FROM note_run_contexts c JOIN project_notes p ON p.note_id=c.note_id
   WHERE c.request_id=i.note_context_id AND p.project_id=r.project_id
   AND NOT EXISTS(SELECT 1 FROM note_deletions d WHERE d.note_id=c.note_id)
 )) OR (i."page_version_id" IS NOT NULL AND EXISTS(SELECT 1 FROM "page_versions" v JOIN "pages" d ON d.id=v."page_id" JOIN "project_pages" p ON p."page_id"=d.id WHERE v.id=i."page_version_id" AND v.status='published' AND d.archived_at IS NULL AND p.project_id=r.project_id AND NOT EXISTS(SELECT 1 FROM "page_retirements" x WHERE x.version_id=v.id))) OR (i.source_id IS NOT NULL AND EXISTS(SELECT 1 FROM sources s JOIN source_extraction_revisions e ON e.source_id=s.id WHERE s.id=i.source_id AND (s.project_id=r.project_id OR EXISTS(
   SELECT 1 FROM note_sources ns JOIN project_notes pn ON pn.note_id=ns.note_id
   WHERE ns.source_id=s.id AND pn.project_id=r.project_id
 )) AND e.revision=i.source_revision AND e.snapshot_id=i.source_snapshot_id))))
BEGIN SELECT RAISE(ABORT,'exact learning input is outside its project'); END;
--> statement-breakpoint
CREATE TRIGGER material_generation_receipt_input_project BEFORE UPDATE OF result_version_id ON material_generation_requests
WHEN OLD.result_version_id IS NULL AND NEW.result_version_id IS NOT NULL AND EXISTS(SELECT 1 FROM material_generation_requests r JOIN material_evidence_inputs i ON i.request_id=r.id WHERE r.id=NEW.id AND NOT ((i.note_context_id IS NOT NULL AND EXISTS(
   SELECT 1 FROM note_run_contexts c JOIN project_notes p ON p.note_id=c.note_id
   WHERE c.request_id=i.note_context_id AND p.project_id=r.project_id
   AND NOT EXISTS(SELECT 1 FROM note_deletions d WHERE d.note_id=c.note_id)
 )) OR (i."page_version_id" IS NOT NULL AND EXISTS(SELECT 1 FROM "page_versions" v JOIN "pages" d ON d.id=v."page_id" JOIN "project_pages" p ON p."page_id"=d.id WHERE v.id=i."page_version_id" AND v.status='published' AND d.archived_at IS NULL AND p.project_id=r.project_id AND NOT EXISTS(SELECT 1 FROM "page_retirements" x WHERE x.version_id=v.id))) OR (i.source_id IS NOT NULL AND EXISTS(SELECT 1 FROM sources s JOIN source_extraction_revisions e ON e.source_id=s.id WHERE s.id=i.source_id AND (s.project_id=r.project_id OR EXISTS(
   SELECT 1 FROM note_sources ns JOIN project_notes pn ON pn.note_id=ns.note_id
   WHERE ns.source_id=s.id AND pn.project_id=r.project_id
 )) AND e.revision=i.source_revision AND e.snapshot_id=i.source_snapshot_id))))
BEGIN SELECT RAISE(ABORT,'exact learning input is outside its project'); END;
--> statement-breakpoint
CREATE TRIGGER material_evidence_inputs_owner BEFORE INSERT ON material_evidence_inputs
WHEN (NEW.version_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM material_versions v WHERE v.id=NEW.version_id AND v.status='draft' AND v.kind IN ('quiz','flashcards')))
 OR (NEW.request_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM material_generation_requests r WHERE r.id=NEW.request_id AND r.cancelled=0 AND r.result_version_id IS NULL
 AND json_extract(r.payload,'$.inputs['||NEW.position||'].kind')=CASE WHEN NEW.note_context_id IS NOT NULL THEN 'note' WHEN NEW."page_version_id" IS NULL THEN 'source' ELSE 'page' END
 AND json_extract(r.payload,'$.inputs['||NEW.position||'].contextId') IS NEW.note_context_id
 AND json_extract(r.payload,'$.inputs['||NEW.position||'].versionId') IS CASE WHEN NEW."page_version_id" IS NULL THEN NULL ELSE CAST(NEW."page_version_id" AS TEXT) END
 AND json_extract(r.payload,'$.inputs['||NEW.position||'].sourceId') IS CASE WHEN NEW.source_id IS NULL THEN NULL ELSE CAST(NEW.source_id AS TEXT) END
 AND json_extract(r.payload,'$.inputs['||NEW.position||'].revision') IS CASE WHEN NEW.source_revision IS NULL THEN NULL ELSE CAST(NEW.source_revision AS TEXT) END
 AND json_extract(r.payload,'$.inputs['||NEW.position||'].snapshotId') IS CASE WHEN NEW.source_snapshot_id IS NULL THEN NULL ELSE CAST(NEW.source_snapshot_id AS TEXT) END))
BEGIN SELECT RAISE(ABORT,'exact learning input does not match its owner'); END;
--> statement-breakpoint
CREATE TRIGGER material_evidence_inputs_retained BEFORE DELETE ON material_evidence_inputs
WHEN (OLD.version_id IS NOT NULL AND EXISTS(SELECT 1 FROM material_versions WHERE id=OLD.version_id AND status='published')
 AND NOT (EXISTS(SELECT 1 FROM material_history_members WHERE version_id=OLD.version_id)
 OR EXISTS(SELECT 1 FROM material_versions v JOIN material_deletion_members d ON d.material_id=v.material_id WHERE v.id=OLD.version_id))) OR (OLD.request_id IS NOT NULL AND EXISTS(SELECT 1 FROM material_generation_requests r WHERE r.id=OLD.request_id AND r.cancelled=0))
BEGIN SELECT RAISE(ABORT,'published learning evidence is retained'); END;
--> statement-breakpoint
CREATE TRIGGER material_generation_publish BEFORE UPDATE OF status ON material_versions
WHEN NEW.status='published' AND NEW.creator='agent' AND NEW.operation='generate' AND NOT EXISTS(SELECT 1 FROM material_generation_requests r JOIN material_versions v ON v.generation_request_id=r.id JOIN materials m ON m.id=v.material_id
 WHERE v.id=NEW.id AND r.cancelled=0 AND v.kind IN ('quiz','flashcards') AND json_extract(r.payload,'$.kind')=v.kind
 AND ((json_type(r.payload,'$.autoTitle')='true' AND length(m.title) BETWEEN 1 AND 200 AND m.title=trim(m.title)) OR (coalesce(json_type(r.payload,'$.autoTitle'),'false')!='true' AND json_extract(r.payload,'$.title')=m.title)) AND json_extract(r.payload,'$.instruction') IS v.instruction
 AND EXISTS(SELECT 1 FROM project_materials p WHERE p.material_id=v.material_id AND p.project_id=r.project_id)
 AND json_array_length(r.payload,'$.inputs') BETWEEN 1 AND 20
 AND (SELECT COUNT(*) FROM material_evidence_inputs WHERE request_id=r.id)=json_array_length(r.payload,'$.inputs')
 AND NOT EXISTS(SELECT position,"page_version_id",note_context_id,source_id,source_revision,source_snapshot_id FROM material_evidence_inputs WHERE request_id=r.id
 EXCEPT SELECT position,"page_version_id",note_context_id,source_id,source_revision,source_snapshot_id FROM material_evidence_inputs WHERE version_id=v.id)
 AND NOT EXISTS(SELECT position,"page_version_id",note_context_id,source_id,source_revision,source_snapshot_id FROM material_evidence_inputs WHERE version_id=v.id
 EXCEPT SELECT position,"page_version_id",note_context_id,source_id,source_revision,source_snapshot_id FROM material_evidence_inputs WHERE request_id=r.id))
BEGIN SELECT RAISE(ABORT,'generated publication does not match exact request'); END;
--> statement-breakpoint
CREATE TRIGGER material_generation_receipt_valid BEFORE UPDATE OF result_version_id,result_hash ON material_generation_requests
WHEN OLD.result_version_id IS NULL AND NEW.result_version_id IS NOT NULL AND (length(NEW.result_hash)!=64 OR NEW.result_hash GLOB '*[^0-9a-f]*'
 OR NOT EXISTS(SELECT 1 FROM material_generation_requests r JOIN material_versions v ON v.generation_request_id=r.id JOIN materials m ON m.id=v.material_id
 WHERE v.id=NEW.result_version_id AND r.cancelled=0 AND v.kind IN ('quiz','flashcards') AND json_extract(r.payload,'$.kind')=v.kind
 AND ((json_type(r.payload,'$.autoTitle')='true' AND length(m.title) BETWEEN 1 AND 200 AND m.title=trim(m.title)) OR (coalesce(json_type(r.payload,'$.autoTitle'),'false')!='true' AND json_extract(r.payload,'$.title')=m.title)) AND json_extract(r.payload,'$.instruction') IS v.instruction
 AND EXISTS(SELECT 1 FROM project_materials p WHERE p.material_id=v.material_id AND p.project_id=r.project_id)
 AND json_array_length(r.payload,'$.inputs') BETWEEN 1 AND 20
 AND (SELECT COUNT(*) FROM material_evidence_inputs WHERE request_id=r.id)=json_array_length(r.payload,'$.inputs')
 AND NOT EXISTS(SELECT position,"page_version_id",note_context_id,source_id,source_revision,source_snapshot_id FROM material_evidence_inputs WHERE request_id=r.id
 EXCEPT SELECT position,"page_version_id",note_context_id,source_id,source_revision,source_snapshot_id FROM material_evidence_inputs WHERE version_id=v.id)
 AND NOT EXISTS(SELECT position,"page_version_id",note_context_id,source_id,source_revision,source_snapshot_id FROM material_evidence_inputs WHERE version_id=v.id
 EXCEPT SELECT position,"page_version_id",note_context_id,source_id,source_revision,source_snapshot_id FROM material_evidence_inputs WHERE request_id=r.id) AND r.id=NEW.id AND v.status='published'))
BEGIN SELECT RAISE(ABORT,'generated receipt does not match exact publication'); END;
--> statement-breakpoint
CREATE TRIGGER practice_note_capture_retained BEFORE DELETE ON note_run_contexts
WHEN EXISTS(
  SELECT 1 FROM material_evidence_inputs i
  LEFT JOIN material_generation_requests r ON r.id=i.request_id
  WHERE i.note_context_id=OLD.request_id AND (i.version_id IS NOT NULL OR r.cancelled=0)
) OR EXISTS(
  SELECT 1 FROM learning_practice_inputs i
  JOIN learning_practice_slots p ON p.id=i.slot_id
  JOIN learning_practice_controls c ON c.project_id=p.project_id AND c.epoch=p.epoch
  WHERE i.note_context_id=OLD.request_id AND p.status IN ('pending','ready') AND c.enabled=1
) OR EXISTS(
  SELECT 1 FROM page_transform_requests r
  JOIN json_each(r.request, '$.studyNotes.inputs') j
  WHERE r.cancelled=0 AND r.result_version_id IS NULL
    AND json_extract(j.value, '$.kind')='note'
    AND json_extract(j.value, '$.contextId')=OLD.request_id
)
BEGIN SELECT RAISE(ABORT,'practice evidence pins the exact note context'); END;
--> statement-breakpoint
CREATE TRIGGER practice_note_version_retained BEFORE DELETE ON message_versions
WHEN EXISTS(
  SELECT 1 FROM material_evidence_inputs i
  JOIN note_run_contexts c ON c.request_id=i.note_context_id
  JOIN json_each(c.snapshot, '$.messages') m
  LEFT JOIN material_generation_requests r ON r.id=i.request_id
  WHERE json_extract(m.value, '$.versionId')=CAST(OLD.id AS TEXT)
    AND (i.version_id IS NOT NULL OR r.cancelled=0)
) OR EXISTS(
  SELECT 1 FROM learning_practice_inputs i
  JOIN learning_practice_slots p ON p.id=i.slot_id
  JOIN learning_practice_controls a ON a.project_id=p.project_id AND a.epoch=p.epoch
  JOIN note_run_contexts c ON c.request_id=i.note_context_id
  JOIN json_each(c.snapshot, '$.messages') m
  WHERE json_extract(m.value, '$.versionId')=CAST(OLD.id AS TEXT)
    AND p.status IN ('pending','ready') AND a.enabled=1
) OR EXISTS(
  SELECT 1 FROM page_transform_requests r
  JOIN json_each(r.request, '$.studyNotes.inputs') j
  JOIN note_run_contexts c ON c.request_id=json_extract(j.value, '$.contextId')
  JOIN json_each(c.snapshot, '$.messages') m
  WHERE r.cancelled=0 AND r.result_version_id IS NULL
    AND json_extract(j.value, '$.kind')='note'
    AND json_extract(m.value, '$.versionId')=CAST(OLD.id AS TEXT)
)
BEGIN SELECT RAISE(ABORT,'practice evidence pins the exact note version'); END;
--> statement-breakpoint
DROP TRIGGER "material_generation_intent_insert";
--> statement-breakpoint
CREATE TRIGGER material_generation_intent_insert BEFORE INSERT ON material_generation_requests
WHEN NEW.result_version_id IS NOT NULL OR NEW.result_hash IS NOT NULL
 OR json_type(NEW.payload,'$.inputs') IS NOT 'array' OR json_array_length(NEW.payload,'$.inputs') NOT BETWEEN 1 AND 20
 OR (SELECT COUNT(DISTINCT value) FROM json_each(NEW.payload,'$.inputs'))!=json_array_length(NEW.payload,'$.inputs')
 OR EXISTS(SELECT 1 FROM json_each(NEW.payload,'$.inputs') j WHERE j.type!='object'
 OR json_extract(j.value,'$.kind') IS NULL OR json_extract(j.value,'$.kind') NOT IN ('source','page','note')
 OR (json_extract(j.value,'$.kind')='note' AND (json_type(j.value,'$.contextId') IS NOT 'text'
 OR length(json_extract(j.value,'$.contextId'))!=36))
 OR (json_extract(j.value,'$.kind')='page' AND (json_type(j.value,'$.versionId') IS NOT 'text'
 OR json_extract(j.value,'$.versionId') NOT GLOB '[1-9]*' OR json_extract(j.value,'$.versionId') GLOB '*[^0-9]*'))
 OR (json_extract(j.value,'$.kind')='source' AND (json_type(j.value,'$.sourceId') IS NOT 'text'
 OR json_extract(j.value,'$.sourceId') NOT GLOB '[1-9]*' OR json_extract(j.value,'$.sourceId') GLOB '*[^0-9]*'
 OR json_type(j.value,'$.revision') IS NOT 'text' OR json_extract(j.value,'$.revision') NOT GLOB '[1-9]*' OR json_extract(j.value,'$.revision') GLOB '*[^0-9]*'
 OR json_type(j.value,'$.snapshotId') IS NOT 'text' OR json_extract(j.value,'$.snapshotId') NOT GLOB '[1-9]*' OR json_extract(j.value,'$.snapshotId') GLOB '*[^0-9]*')))
BEGIN SELECT RAISE(ABORT,'invalid exact generation intent'); END;
--> statement-breakpoint
DROP TRIGGER "page_transform_result_hash";
--> statement-breakpoint
CREATE TRIGGER page_transform_result_hash BEFORE UPDATE OF result_version_id ON "page_transform_requests"
WHEN OLD.result_version_id IS NULL AND NEW.result_version_id IS NOT NULL AND (NEW.result_hash IS NULL OR length(NEW.result_hash)!=64 OR NEW.result_hash GLOB '*[^0-9a-f]*' OR NEW.cancelled=1 OR (NEW."note_id" IS NULL AND json_type(NEW.request,'$.merge') IS NOT 'object' AND json_type(NEW.request,'$.studyNotes') IS NOT 'object') OR EXISTS(SELECT 1 FROM "note_deletions" WHERE "note_id"=NEW."note_id"))
BEGIN SELECT RAISE(ABORT,'authored transform cannot complete outside its retained authority'); END;
--> statement-breakpoint
DROP TRIGGER "page_generation_result_insert";
--> statement-breakpoint
CREATE TRIGGER page_generation_result_insert BEFORE INSERT ON "page_generation_requests"
WHEN NEW.result_version_id IS NOT NULL AND (NOT (EXISTS(SELECT 1 FROM "page_versions" v WHERE v.id=NEW.result_version_id AND v."page_id"=NEW."page_id" AND v.creator='agent' AND v.operation IN ('generate','summarize','translate')
 AND NOT EXISTS(SELECT 1 FROM "page_retirements" x WHERE x.version_id=v.id)
 AND ((NEW.expected_version_id IS NULL AND v.status='published' AND v.number=1)
 OR (NEW.expected_version_id IS NOT NULL
  AND (SELECT COUNT(*) FROM "page_version_parents" p WHERE p.version_id=v.id)=1
  AND EXISTS(SELECT 1 FROM "page_version_parents" p WHERE p.version_id=v.id AND p.parent_version_id=NEW.expected_version_id AND p."page_id"=NEW."page_id")
  AND (v.status='published' OR EXISTS(SELECT 1 FROM "page_proposals" p WHERE p.request_id=NEW.id AND p.base_version_id=NEW.expected_version_id AND p.proposed_version_id=v.id)))))) OR NOT (NOT EXISTS(SELECT 1 FROM "page_transform_requests" WHERE id=NEW.id) OR EXISTS(
 SELECT 1 FROM "page_transform_requests" tr
 JOIN "page_versions" v ON v.id=NEW.result_version_id
 JOIN "pages" output ON output.id=v."page_id"
 WHERE tr.id=NEW.id AND tr."note_id" IS NULL AND NEW."note_id" IS NULL
 AND NEW.expected_version_id IS NULL AND tr.cancelled=0
 AND json_type(tr.request,'$.merge')='object'
 AND json_extract(tr.request,'$.contextRequestId')=tr.context_request_id
 AND tr.context_request_id='merge/' || json_extract(tr.request,'$.merge.key')
 AND json_extract(tr.request,'$.editTargetVersionId') IS NULL
 AND json_extract(tr.request,'$.title')=json_extract(tr.request,'$.merge.title')
 AND output.title=json_extract(tr.request,'$.title')
 AND v.operation='generate' AND v.language IS json_extract(tr.request,'$.merge.language')
 AND v.instruction=CASE WHEN tr.instruction!='' THEN tr.instruction ELSE (SELECT group_concat(value,', ') FROM json_each(tr.request,'$.operations')) END
 AND NOT EXISTS(SELECT 1 FROM workflow_retired_correlations r WHERE r.correlation_id IN (tr.id,tr.context_request_id))
 AND NOT EXISTS(SELECT 1 FROM workflow_executions e WHERE e.status='cancelled' AND json_extract(e.payload,'$.event.correlationId') IN (tr.id,tr.context_request_id))
 AND json_type(tr.request,'$.merge.versions')='array'
 AND json_array_length(tr.request,'$.merge.versions') BETWEEN 2 AND 20
 AND (SELECT COUNT(*) FROM "page_inputs" i WHERE i.version_id=v.id)=json_array_length(tr.request,'$.merge.versions')
 AND (SELECT COUNT(DISTINCT b."page_id") FROM json_each(tr.request,'$.merge.versions') j
      JOIN "page_versions" b ON CAST(b.id AS TEXT)=j.value)=json_array_length(tr.request,'$.merge.versions')
 AND NOT EXISTS(
   SELECT 1 FROM json_each(tr.request,'$.merge.versions') j WHERE NOT EXISTS(
     SELECT 1 FROM "page_versions" b
     JOIN "pages" d ON d.id=b."page_id"
     JOIN "page_inputs" i ON i.version_id=v.id AND i."page_version_id"=b.id AND i.position=CAST(j.key AS INTEGER)
     WHERE CAST(b.id AS TEXT)=j.value AND b.status='published'
     AND b."page_id"!=v."page_id" AND d.archived_at IS NULL
     AND NOT EXISTS(SELECT 1 FROM "page_versions" newer WHERE newer."page_id"=b."page_id" AND newer.status='published' AND newer.number>b.number)
     AND NOT EXISTS(SELECT 1 FROM "page_retirements" r WHERE r.version_id=b.id)
     AND NOT EXISTS(SELECT 1 FROM "page_deletions" x WHERE x."page_id"=b."page_id")
   )
 )
) OR EXISTS(
 SELECT 1 FROM page_transform_requests tr
 JOIN page_versions v ON v.id=NEW.result_version_id AND v.page_id=NEW.page_id
 JOIN pages output ON output.id=v.page_id
 WHERE tr.id=NEW.id AND tr.note_id IS NULL AND NEW.note_id IS NULL
 AND NEW.expected_version_id IS NULL AND tr.cancelled=0
 AND json_type(tr.request,'$.studyNotes')='object'
 AND tr.context_request_id='study-notes/' || json_extract(tr.request,'$.studyNotes.key')
 AND json_extract(tr.request,'$.contextRequestId')=tr.context_request_id
 AND json_extract(tr.request,'$.editTargetVersionId') IS NULL
 AND output.title=json_extract(tr.request,'$.studyNotes.title')
 AND v.operation='summarize' AND v.language IS json_extract(tr.request,'$.studyNotes.language')
 AND v.instruction=CASE WHEN tr.instruction!='' THEN tr.instruction ELSE 'summarize, structure' END
 AND NOT EXISTS(SELECT 1 FROM workflow_retired_correlations r WHERE r.correlation_id IN (tr.id,tr.context_request_id))
 AND NOT EXISTS(SELECT 1 FROM workflow_executions e WHERE e.status='cancelled' AND json_extract(e.payload,'$.event.correlationId') IN (tr.id,tr.context_request_id))
 AND json_array_length(tr.request,'$.studyNotes.inputs') BETWEEN 1 AND 20
 AND NOT EXISTS(
   SELECT 1 FROM json_each(tr.request,'$.studyNotes.inputs') j
   WHERE CASE json_extract(j.value,'$.kind')
     WHEN 'page' THEN NOT EXISTS(
       SELECT 1 FROM page_inputs i WHERE i.version_id=v.id
         AND CAST(i.page_version_id AS TEXT)=json_extract(j.value,'$.versionId')
     )
     WHEN 'source' THEN NOT EXISTS(
       SELECT 1 FROM page_inputs i WHERE i.version_id=v.id
         AND CAST(i.source_id AS TEXT)=json_extract(j.value,'$.sourceId')
         AND CAST(i.source_revision AS TEXT)=json_extract(j.value,'$.revision')
         AND CAST(i.source_snapshot_id AS TEXT)=json_extract(j.value,'$.snapshotId')
     )
     WHEN 'note' THEN NOT EXISTS(
       SELECT 1 FROM note_run_contexts c JOIN project_notes p ON p.note_id=c.note_id
       WHERE c.request_id=json_extract(j.value,'$.contextId')
         AND c.intent_key='study-evidence/'||c.request_id
         AND CAST(p.project_id AS TEXT)=json_extract(tr.request,'$.studyNotes.projectId')
         AND NOT EXISTS(SELECT 1 FROM note_deletions d WHERE d.note_id=c.note_id)
         AND NOT EXISTS(
           SELECT 1 FROM json_each(c.snapshot,'$.messages') m
           WHERE NOT EXISTS(
             SELECT 1 FROM page_inputs i WHERE i.version_id=v.id
               AND CAST(i.exact_message_version_id AS TEXT)=json_extract(m.value,'$.versionId')
           )
         )
     )
     ELSE 1
   END
 )
 AND (SELECT COUNT(*) FROM page_inputs i WHERE i.version_id=v.id)=(
   SELECT COUNT(*) FROM json_each(tr.request,'$.studyNotes.inputs') j
   WHERE json_extract(j.value,'$.kind')!='note'
 ) + (
   SELECT COUNT(DISTINCT json_extract(m.value,'$.versionId'))
   FROM json_each(tr.request,'$.studyNotes.inputs') j
   JOIN note_run_contexts c ON c.request_id=json_extract(j.value,'$.contextId')
   JOIN json_each(c.snapshot,'$.messages') m
   WHERE json_extract(j.value,'$.kind')='note'
 )
) OR EXISTS(
 SELECT 1 FROM "page_transform_requests" tr JOIN "note_run_contexts" c ON c.request_id=tr.context_request_id JOIN "page_versions" v ON v.id=NEW.result_version_id
 WHERE tr.id=NEW.id AND (NEW."note_id" IS NULL OR NEW."note_id"=tr."note_id") AND tr.cancelled=0 AND tr."note_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "note_deletions" d WHERE d."note_id"=tr."note_id")
 AND NOT EXISTS(SELECT 1 FROM workflow_retired_correlations r WHERE r.correlation_id IN (tr.id,tr.context_request_id))
 AND NOT EXISTS(SELECT 1 FROM workflow_executions e WHERE e.status='cancelled' AND json_extract(e.payload,'$.event.correlationId') IN (tr.id,tr.context_request_id))
 AND tr.context_request_id=c.request_id AND c."note_id"=tr."note_id"
 AND json_extract(c.snapshot,'$.requestId')=c.request_id AND json_extract(c.snapshot,'$.noteId')=CAST(c."note_id" AS TEXT)
 AND json_extract(tr.request,'$.contextRequestId')=tr.context_request_id
 AND json_extract(tr.request,'$.editTargetVersionId') IS CASE WHEN NEW.expected_version_id IS NULL THEN NULL ELSE CAST(NEW.expected_version_id AS TEXT) END
 AND (NEW.expected_version_id IS NULL OR EXISTS(SELECT 1 FROM json_each(c.snapshot,'$.inputs') j JOIN "page_versions" b ON CAST(json_extract(j.value,'$.input.versionId') AS INTEGER)=b.id
  WHERE json_extract(j.value,'$.input.kind')='page' AND b.id=NEW.expected_version_id
   AND json_extract(j.value,'$.scope.kind')='document' AND json_extract(j.value,'$.snapshotId')=CAST(b.content_snapshot_id AS TEXT)))
 AND NOT EXISTS(SELECT 1 FROM json_each(c.snapshot,'$.inputs') j WHERE
  (json_extract(j.value,'$.input.kind')='page' AND NOT EXISTS(SELECT 1 FROM "page_versions" b JOIN "note_context_pages" p ON p.version_id=b.id AND p.request_id=c.request_id
   WHERE b.id=CAST(json_extract(j.value,'$.input.versionId') AS INTEGER) AND CAST(b.content_snapshot_id AS TEXT)=json_extract(j.value,'$.snapshotId')))
  OR (json_extract(j.value,'$.input.kind')='source' AND NOT EXISTS(SELECT 1 FROM "note_context_sources" p WHERE p.request_id=c.request_id
   AND CAST(p.source_id AS TEXT)=json_extract(j.value,'$.input.sourceId') AND CAST(p.revision AS TEXT)=json_extract(j.value,'$.input.revision')
   AND CAST(p.snapshot_id AS TEXT)=json_extract(j.value,'$.input.snapshotId') AND CAST(p.snapshot_id AS TEXT)=json_extract(j.value,'$.snapshotId')))
  OR json_extract(j.value,'$.input.kind') IS NULL OR json_extract(j.value,'$.input.kind') NOT IN ('page','source'))
 AND (SELECT COUNT(*) FROM "page_inputs" i WHERE i.version_id=NEW.result_version_id)=
  (SELECT COUNT(*) FROM "note_context_pages" WHERE request_id=c.request_id)+(SELECT COUNT(*) FROM "note_context_sources" WHERE request_id=c.request_id)+json_array_length(c.snapshot,'$.messages')
 AND NOT EXISTS(SELECT version_id FROM "note_context_pages" WHERE request_id=c.request_id EXCEPT SELECT "page_version_id" FROM "page_inputs" WHERE version_id=NEW.result_version_id AND "page_version_id" IS NOT NULL)
 AND NOT EXISTS(SELECT "page_version_id" FROM "page_inputs" WHERE version_id=NEW.result_version_id AND "page_version_id" IS NOT NULL EXCEPT SELECT version_id FROM "note_context_pages" WHERE request_id=c.request_id)
 AND NOT EXISTS(SELECT source_id,revision,snapshot_id FROM "note_context_sources" WHERE request_id=c.request_id EXCEPT SELECT source_id,source_revision,source_snapshot_id FROM "page_inputs" WHERE version_id=NEW.result_version_id AND source_id IS NOT NULL)
 AND NOT EXISTS(SELECT source_id,source_revision,source_snapshot_id FROM "page_inputs" WHERE version_id=NEW.result_version_id AND source_id IS NOT NULL EXCEPT SELECT source_id,revision,snapshot_id FROM "note_context_sources" WHERE request_id=c.request_id)
 AND NOT EXISTS(SELECT CAST(json_extract(j.value,'$.versionId') AS INTEGER) FROM json_each(c.snapshot,'$.messages') j EXCEPT SELECT exact_message_version_id FROM "page_inputs" WHERE version_id=NEW.result_version_id AND exact_message_version_id IS NOT NULL)
 AND NOT EXISTS(SELECT exact_message_version_id FROM "page_inputs" WHERE version_id=NEW.result_version_id AND exact_message_version_id IS NOT NULL EXCEPT SELECT CAST(json_extract(j.value,'$.versionId') AS INTEGER) FROM json_each(c.snapshot,'$.messages') j)
 AND v.instruction=CASE WHEN tr.instruction!='' THEN tr.instruction ELSE (SELECT group_concat(value,', ') FROM json_each(tr.request,'$.operations')) END
 AND v.operation=CASE WHEN EXISTS(SELECT 1 FROM json_each(tr.request,'$.operations') WHERE value='translate') THEN 'translate' WHEN EXISTS(SELECT 1 FROM json_each(tr.request,'$.operations') WHERE value='summarize') THEN 'summarize' ELSE 'generate' END
 AND (NEW.expected_version_id IS NOT NULL OR (SELECT title FROM "pages" WHERE id=v."page_id")=json_extract(tr.request,'$.title')))))
BEGIN SELECT RAISE(ABORT,'authored generation result does not match its exact retained authority'); END;
--> statement-breakpoint
DROP TRIGGER "page_generation_result_update";
--> statement-breakpoint
CREATE TRIGGER page_generation_result_update BEFORE UPDATE OF result_version_id ON "page_generation_requests"
WHEN NEW.result_version_id IS NOT NULL AND OLD.result_version_id IS NULL AND (NOT (EXISTS(SELECT 1 FROM "page_versions" v WHERE v.id=NEW.result_version_id AND v."page_id"=NEW."page_id" AND v.creator='agent' AND v.operation IN ('generate','summarize','translate')
 AND NOT EXISTS(SELECT 1 FROM "page_retirements" x WHERE x.version_id=v.id)
 AND ((NEW.expected_version_id IS NULL AND v.status='published' AND v.number=1)
 OR (NEW.expected_version_id IS NOT NULL
  AND (SELECT COUNT(*) FROM "page_version_parents" p WHERE p.version_id=v.id)=1
  AND EXISTS(SELECT 1 FROM "page_version_parents" p WHERE p.version_id=v.id AND p.parent_version_id=NEW.expected_version_id AND p."page_id"=NEW."page_id")
  AND (v.status='published' OR EXISTS(SELECT 1 FROM "page_proposals" p WHERE p.request_id=NEW.id AND p.base_version_id=NEW.expected_version_id AND p.proposed_version_id=v.id)))))) OR NOT (NOT EXISTS(SELECT 1 FROM "page_transform_requests" WHERE id=NEW.id) OR EXISTS(
 SELECT 1 FROM "page_transform_requests" tr
 JOIN "page_versions" v ON v.id=NEW.result_version_id
 JOIN "pages" output ON output.id=v."page_id"
 WHERE tr.id=NEW.id AND tr."note_id" IS NULL AND NEW."note_id" IS NULL
 AND NEW.expected_version_id IS NULL AND tr.cancelled=0
 AND json_type(tr.request,'$.merge')='object'
 AND json_extract(tr.request,'$.contextRequestId')=tr.context_request_id
 AND tr.context_request_id='merge/' || json_extract(tr.request,'$.merge.key')
 AND json_extract(tr.request,'$.editTargetVersionId') IS NULL
 AND json_extract(tr.request,'$.title')=json_extract(tr.request,'$.merge.title')
 AND output.title=json_extract(tr.request,'$.title')
 AND v.operation='generate' AND v.language IS json_extract(tr.request,'$.merge.language')
 AND v.instruction=CASE WHEN tr.instruction!='' THEN tr.instruction ELSE (SELECT group_concat(value,', ') FROM json_each(tr.request,'$.operations')) END
 AND NOT EXISTS(SELECT 1 FROM workflow_retired_correlations r WHERE r.correlation_id IN (tr.id,tr.context_request_id))
 AND NOT EXISTS(SELECT 1 FROM workflow_executions e WHERE e.status='cancelled' AND json_extract(e.payload,'$.event.correlationId') IN (tr.id,tr.context_request_id))
 AND json_type(tr.request,'$.merge.versions')='array'
 AND json_array_length(tr.request,'$.merge.versions') BETWEEN 2 AND 20
 AND (SELECT COUNT(*) FROM "page_inputs" i WHERE i.version_id=v.id)=json_array_length(tr.request,'$.merge.versions')
 AND (SELECT COUNT(DISTINCT b."page_id") FROM json_each(tr.request,'$.merge.versions') j
      JOIN "page_versions" b ON CAST(b.id AS TEXT)=j.value)=json_array_length(tr.request,'$.merge.versions')
 AND NOT EXISTS(
   SELECT 1 FROM json_each(tr.request,'$.merge.versions') j WHERE NOT EXISTS(
     SELECT 1 FROM "page_versions" b
     JOIN "pages" d ON d.id=b."page_id"
     JOIN "page_inputs" i ON i.version_id=v.id AND i."page_version_id"=b.id AND i.position=CAST(j.key AS INTEGER)
     WHERE CAST(b.id AS TEXT)=j.value AND b.status='published'
     AND b."page_id"!=v."page_id" AND d.archived_at IS NULL
     AND NOT EXISTS(SELECT 1 FROM "page_versions" newer WHERE newer."page_id"=b."page_id" AND newer.status='published' AND newer.number>b.number)
     AND NOT EXISTS(SELECT 1 FROM "page_retirements" r WHERE r.version_id=b.id)
     AND NOT EXISTS(SELECT 1 FROM "page_deletions" x WHERE x."page_id"=b."page_id")
   )
 )
) OR EXISTS(
 SELECT 1 FROM page_transform_requests tr
 JOIN page_versions v ON v.id=NEW.result_version_id AND v.page_id=NEW.page_id
 JOIN pages output ON output.id=v.page_id
 WHERE tr.id=NEW.id AND tr.note_id IS NULL AND NEW.note_id IS NULL
 AND NEW.expected_version_id IS NULL AND tr.cancelled=0
 AND json_type(tr.request,'$.studyNotes')='object'
 AND tr.context_request_id='study-notes/' || json_extract(tr.request,'$.studyNotes.key')
 AND json_extract(tr.request,'$.contextRequestId')=tr.context_request_id
 AND json_extract(tr.request,'$.editTargetVersionId') IS NULL
 AND output.title=json_extract(tr.request,'$.studyNotes.title')
 AND v.operation='summarize' AND v.language IS json_extract(tr.request,'$.studyNotes.language')
 AND v.instruction=CASE WHEN tr.instruction!='' THEN tr.instruction ELSE 'summarize, structure' END
 AND NOT EXISTS(SELECT 1 FROM workflow_retired_correlations r WHERE r.correlation_id IN (tr.id,tr.context_request_id))
 AND NOT EXISTS(SELECT 1 FROM workflow_executions e WHERE e.status='cancelled' AND json_extract(e.payload,'$.event.correlationId') IN (tr.id,tr.context_request_id))
 AND json_array_length(tr.request,'$.studyNotes.inputs') BETWEEN 1 AND 20
 AND NOT EXISTS(
   SELECT 1 FROM json_each(tr.request,'$.studyNotes.inputs') j
   WHERE CASE json_extract(j.value,'$.kind')
     WHEN 'page' THEN NOT EXISTS(
       SELECT 1 FROM page_inputs i WHERE i.version_id=v.id
         AND CAST(i.page_version_id AS TEXT)=json_extract(j.value,'$.versionId')
     )
     WHEN 'source' THEN NOT EXISTS(
       SELECT 1 FROM page_inputs i WHERE i.version_id=v.id
         AND CAST(i.source_id AS TEXT)=json_extract(j.value,'$.sourceId')
         AND CAST(i.source_revision AS TEXT)=json_extract(j.value,'$.revision')
         AND CAST(i.source_snapshot_id AS TEXT)=json_extract(j.value,'$.snapshotId')
     )
     WHEN 'note' THEN NOT EXISTS(
       SELECT 1 FROM note_run_contexts c JOIN project_notes p ON p.note_id=c.note_id
       WHERE c.request_id=json_extract(j.value,'$.contextId')
         AND c.intent_key='study-evidence/'||c.request_id
         AND CAST(p.project_id AS TEXT)=json_extract(tr.request,'$.studyNotes.projectId')
         AND NOT EXISTS(SELECT 1 FROM note_deletions d WHERE d.note_id=c.note_id)
         AND NOT EXISTS(
           SELECT 1 FROM json_each(c.snapshot,'$.messages') m
           WHERE NOT EXISTS(
             SELECT 1 FROM page_inputs i WHERE i.version_id=v.id
               AND CAST(i.exact_message_version_id AS TEXT)=json_extract(m.value,'$.versionId')
           )
         )
     )
     ELSE 1
   END
 )
 AND (SELECT COUNT(*) FROM page_inputs i WHERE i.version_id=v.id)=(
   SELECT COUNT(*) FROM json_each(tr.request,'$.studyNotes.inputs') j
   WHERE json_extract(j.value,'$.kind')!='note'
 ) + (
   SELECT COUNT(DISTINCT json_extract(m.value,'$.versionId'))
   FROM json_each(tr.request,'$.studyNotes.inputs') j
   JOIN note_run_contexts c ON c.request_id=json_extract(j.value,'$.contextId')
   JOIN json_each(c.snapshot,'$.messages') m
   WHERE json_extract(j.value,'$.kind')='note'
 )
) OR EXISTS(
 SELECT 1 FROM "page_transform_requests" tr JOIN "note_run_contexts" c ON c.request_id=tr.context_request_id JOIN "page_versions" v ON v.id=NEW.result_version_id
 WHERE tr.id=NEW.id AND (NEW."note_id" IS NULL OR NEW."note_id"=tr."note_id") AND tr.cancelled=0 AND tr."note_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "note_deletions" d WHERE d."note_id"=tr."note_id")
 AND NOT EXISTS(SELECT 1 FROM workflow_retired_correlations r WHERE r.correlation_id IN (tr.id,tr.context_request_id))
 AND NOT EXISTS(SELECT 1 FROM workflow_executions e WHERE e.status='cancelled' AND json_extract(e.payload,'$.event.correlationId') IN (tr.id,tr.context_request_id))
 AND tr.context_request_id=c.request_id AND c."note_id"=tr."note_id"
 AND json_extract(c.snapshot,'$.requestId')=c.request_id AND json_extract(c.snapshot,'$.noteId')=CAST(c."note_id" AS TEXT)
 AND json_extract(tr.request,'$.contextRequestId')=tr.context_request_id
 AND json_extract(tr.request,'$.editTargetVersionId') IS CASE WHEN NEW.expected_version_id IS NULL THEN NULL ELSE CAST(NEW.expected_version_id AS TEXT) END
 AND (NEW.expected_version_id IS NULL OR EXISTS(SELECT 1 FROM json_each(c.snapshot,'$.inputs') j JOIN "page_versions" b ON CAST(json_extract(j.value,'$.input.versionId') AS INTEGER)=b.id
  WHERE json_extract(j.value,'$.input.kind')='page' AND b.id=NEW.expected_version_id
   AND json_extract(j.value,'$.scope.kind')='document' AND json_extract(j.value,'$.snapshotId')=CAST(b.content_snapshot_id AS TEXT)))
 AND NOT EXISTS(SELECT 1 FROM json_each(c.snapshot,'$.inputs') j WHERE
  (json_extract(j.value,'$.input.kind')='page' AND NOT EXISTS(SELECT 1 FROM "page_versions" b JOIN "note_context_pages" p ON p.version_id=b.id AND p.request_id=c.request_id
   WHERE b.id=CAST(json_extract(j.value,'$.input.versionId') AS INTEGER) AND CAST(b.content_snapshot_id AS TEXT)=json_extract(j.value,'$.snapshotId')))
  OR (json_extract(j.value,'$.input.kind')='source' AND NOT EXISTS(SELECT 1 FROM "note_context_sources" p WHERE p.request_id=c.request_id
   AND CAST(p.source_id AS TEXT)=json_extract(j.value,'$.input.sourceId') AND CAST(p.revision AS TEXT)=json_extract(j.value,'$.input.revision')
   AND CAST(p.snapshot_id AS TEXT)=json_extract(j.value,'$.input.snapshotId') AND CAST(p.snapshot_id AS TEXT)=json_extract(j.value,'$.snapshotId')))
  OR json_extract(j.value,'$.input.kind') IS NULL OR json_extract(j.value,'$.input.kind') NOT IN ('page','source'))
 AND (SELECT COUNT(*) FROM "page_inputs" i WHERE i.version_id=NEW.result_version_id)=
  (SELECT COUNT(*) FROM "note_context_pages" WHERE request_id=c.request_id)+(SELECT COUNT(*) FROM "note_context_sources" WHERE request_id=c.request_id)+json_array_length(c.snapshot,'$.messages')
 AND NOT EXISTS(SELECT version_id FROM "note_context_pages" WHERE request_id=c.request_id EXCEPT SELECT "page_version_id" FROM "page_inputs" WHERE version_id=NEW.result_version_id AND "page_version_id" IS NOT NULL)
 AND NOT EXISTS(SELECT "page_version_id" FROM "page_inputs" WHERE version_id=NEW.result_version_id AND "page_version_id" IS NOT NULL EXCEPT SELECT version_id FROM "note_context_pages" WHERE request_id=c.request_id)
 AND NOT EXISTS(SELECT source_id,revision,snapshot_id FROM "note_context_sources" WHERE request_id=c.request_id EXCEPT SELECT source_id,source_revision,source_snapshot_id FROM "page_inputs" WHERE version_id=NEW.result_version_id AND source_id IS NOT NULL)
 AND NOT EXISTS(SELECT source_id,source_revision,source_snapshot_id FROM "page_inputs" WHERE version_id=NEW.result_version_id AND source_id IS NOT NULL EXCEPT SELECT source_id,revision,snapshot_id FROM "note_context_sources" WHERE request_id=c.request_id)
 AND NOT EXISTS(SELECT CAST(json_extract(j.value,'$.versionId') AS INTEGER) FROM json_each(c.snapshot,'$.messages') j EXCEPT SELECT exact_message_version_id FROM "page_inputs" WHERE version_id=NEW.result_version_id AND exact_message_version_id IS NOT NULL)
 AND NOT EXISTS(SELECT exact_message_version_id FROM "page_inputs" WHERE version_id=NEW.result_version_id AND exact_message_version_id IS NOT NULL EXCEPT SELECT CAST(json_extract(j.value,'$.versionId') AS INTEGER) FROM json_each(c.snapshot,'$.messages') j)
 AND v.instruction=CASE WHEN tr.instruction!='' THEN tr.instruction ELSE (SELECT group_concat(value,', ') FROM json_each(tr.request,'$.operations')) END
 AND v.operation=CASE WHEN EXISTS(SELECT 1 FROM json_each(tr.request,'$.operations') WHERE value='translate') THEN 'translate' WHEN EXISTS(SELECT 1 FROM json_each(tr.request,'$.operations') WHERE value='summarize') THEN 'summarize' ELSE 'generate' END
 AND (NEW.expected_version_id IS NOT NULL OR (SELECT title FROM "pages" WHERE id=v."page_id")=json_extract(tr.request,'$.title')))))
BEGIN SELECT RAISE(ABORT,'authored generation result does not match its exact retained authority'); END;
--> statement-breakpoint
DROP TRIGGER page_transform_intent_immutable;
--> statement-breakpoint
CREATE TRIGGER page_transform_intent_immutable BEFORE UPDATE ON page_transform_requests
WHEN (NEW.id IS NOT OLD.id OR NEW.context_request_id IS NOT OLD.context_request_id OR NEW.request IS NOT OLD.request OR NEW.intent_hash IS NOT OLD.intent_hash OR NEW.instruction IS NOT OLD.instruction OR NEW.created_at IS NOT OLD.created_at OR (NEW."note_id" IS NOT OLD."note_id" AND NEW."note_id" IS NOT NULL) OR (OLD.cancelled=1 AND NEW.cancelled!=1) OR (OLD.result_version_id IS NOT NULL AND (NEW.result_version_id IS NOT OLD.result_version_id OR NEW.report IS NOT OLD.report OR NEW.result_hash IS NOT OLD.result_hash OR NEW.event_id IS NOT OLD.event_id))) AND NOT (
 EXISTS(SELECT 1 FROM page_versions v JOIN page_deletions d ON d.page_id=v.page_id
   WHERE v.id=OLD.result_version_id)
 AND NEW.id IS OLD.id AND NEW.context_request_id IS OLD.context_request_id
 AND NEW.intent_hash IS OLD.intent_hash AND NEW.created_at IS OLD.created_at
 AND (NEW.note_id IS OLD.note_id OR NEW.note_id IS NULL)
 AND NEW.cancelled IS OLD.cancelled AND NEW.error_kind IS OLD.error_kind
 AND NEW.result_version_id IS OLD.result_version_id AND NEW.result_hash IS OLD.result_hash
 AND NEW.event_id IS OLD.event_id AND NEW.instruction='' AND NEW.report IS NULL
 AND NEW.request IS (CASE WHEN json_type(OLD.request,'$.merge')='object'
      THEN json_set(OLD.request,'$.title','-','$.merge.title','-','$.merge.instruction','')
      WHEN json_type(OLD.request,'$.studyNotes')='object'
      THEN json_set(OLD.request,'$.title','-','$.studyNotes.title','-','$.studyNotes.instruction','')
      ELSE json_set(OLD.request,'$.title','-') END)
) BEGIN SELECT RAISE(ABORT,'document transform intent and publication are immutable'); END;
--> statement-breakpoint
DROP TRIGGER learning_practice_slot_capture;
--> statement-breakpoint
CREATE TRIGGER learning_practice_slot_capture
BEFORE INSERT ON learning_practice_slots
WHEN NEW.status != 'pending' OR NEW.version_id IS NOT NULL OR NEW.attempt_id IS NOT NULL
  OR NEW.kind IS NOT CASE WHEN NEW.ordinal % 3 = 2 THEN 'open' ELSE 'choice' END
  OR NOT EXISTS (SELECT 1 FROM learning_practice_controls c WHERE c.project_id = NEW.project_id AND c.epoch = NEW.epoch AND c.enabled = 1)
  OR (SELECT COUNT(*) FROM learning_practice_slots p WHERE p.project_id = NEW.project_id AND p.epoch = NEW.epoch AND p.status IN ('pending','ready')) >= 2
  OR NEW.ordinal != (SELECT COALESCE(MAX(p.ordinal) + 1, 0) FROM learning_practice_slots p WHERE p.project_id = NEW.project_id AND p.epoch = NEW.epoch)
  OR json_type(NEW.inputs) IS NOT 'array' OR json_array_length(NEW.inputs) NOT BETWEEN 1 AND 20
  OR (SELECT COUNT(DISTINCT value) FROM json_each(NEW.inputs)) != json_array_length(NEW.inputs)
  OR EXISTS(SELECT 1 FROM json_each(NEW.inputs) j WHERE
    (json_extract(j.value,'$.kind')='page' AND NOT EXISTS(
      SELECT 1 FROM "page_versions" v JOIN "pages" d ON d.id=v."page_id"
      JOIN "project_pages" p ON p."page_id"=d.id AND p.project_id=NEW.project_id
      WHERE CAST(v.id AS TEXT)=json_extract(j.value,'$.versionId') AND v.status='published' AND d.archived_at IS NULL
      AND NOT EXISTS(SELECT 1 FROM "page_retirements" r WHERE r.version_id=v.id)))
    OR (json_extract(j.value,'$.kind')='source' AND NOT EXISTS(
      SELECT 1 FROM source_extraction_revisions e JOIN sources s ON s.id=e.source_id
      WHERE CAST(e.source_id AS TEXT)=json_extract(j.value,'$.sourceId') AND CAST(e.revision AS TEXT)=json_extract(j.value,'$.revision')
      AND CAST(e.snapshot_id AS TEXT)=json_extract(j.value,'$.snapshotId') AND s.project_id=NEW.project_id))
    OR (json_extract(j.value,'$.kind')='note' AND NOT EXISTS(
      SELECT 1 FROM note_run_contexts c JOIN project_notes p ON p.note_id=c.note_id
      WHERE c.request_id=json_extract(j.value,'$.contextId') AND p.project_id=NEW.project_id
      AND c.intent_key='study-evidence/'||c.request_id
      AND NOT EXISTS(SELECT 1 FROM note_deletions d WHERE d.note_id=c.note_id)))
    OR json_extract(j.value,'$.kind') IS NULL OR json_extract(j.value,'$.kind') NOT IN ('source','page','note'))
BEGIN SELECT RAISE(ABORT, 'invalid or unbounded practice slot capture'); END;
