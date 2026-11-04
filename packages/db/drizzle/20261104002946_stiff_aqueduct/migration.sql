DROP TRIGGER IF EXISTS learning_practice_slot_answer;
--> statement-breakpoint
DROP TRIGGER IF EXISTS learning_practice_slot_retained;
--> statement-breakpoint
DROP TRIGGER IF EXISTS learning_practice_retry_capture;
--> statement-breakpoint
DROP TRIGGER IF EXISTS learning_practice_retry_transition;
--> statement-breakpoint
DROP TRIGGER IF EXISTS learning_practice_failure_clear;
--> statement-breakpoint
DROP TRIGGER IF EXISTS learning_practice_slot_publication;
--> statement-breakpoint
DROP TRIGGER IF EXISTS material_deletion_practice_capture;
--> statement-breakpoint
DROP TRIGGER IF EXISTS learning_practice_slot_immutable;
--> statement-breakpoint
DROP TRIGGER IF EXISTS history_practice_capture;
--> statement-breakpoint
DROP TRIGGER IF EXISTS learning_practice_slot_capture;
--> statement-breakpoint
DROP TRIGGER IF EXISTS material_generation_publish;
--> statement-breakpoint
DROP TRIGGER IF EXISTS material_generation_receipt_valid;
--> statement-breakpoint
DROP TRIGGER IF EXISTS material_generation_intent_immutable;
--> statement-breakpoint
DROP TRIGGER IF EXISTS material_generation_cancel_fence;
--> statement-breakpoint
CREATE TABLE `learning_practice_inputs` (
	`slot_id` text NOT NULL,
	`position` integer NOT NULL,
	`document_version_id` integer,
	`source_id` integer,
	`source_revision` integer,
	`source_snapshot_id` integer,
	CONSTRAINT `learning_practice_inputs_pk` PRIMARY KEY(`slot_id`, `position`),
	CONSTRAINT `fk_learning_practice_inputs_slot_id_learning_practice_slots_id_fk` FOREIGN KEY (`slot_id`) REFERENCES `learning_practice_slots`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_learning_practice_inputs_document_version_id_study_document_versions_id_fk` FOREIGN KEY (`document_version_id`) REFERENCES `study_document_versions`(`id`),
	CONSTRAINT `fk_learning_practice_inputs_source_id_source_revision_source_snapshot_id_source_extraction_revisions_source_id_revision_snapshot_id_fk` FOREIGN KEY (`source_id`,`source_revision`,`source_snapshot_id`) REFERENCES `source_extraction_revisions`(`source_id`,`revision`,`snapshot_id`),
	CONSTRAINT "exact_content_input_reference" CHECK((("document_version_id" IS NOT NULL AND "source_id" IS NULL AND "source_revision" IS NULL AND "source_snapshot_id" IS NULL) OR ("document_version_id" IS NULL AND "source_id" IS NOT NULL AND "source_revision">0 AND "source_snapshot_id" IS NOT NULL))),
	CONSTRAINT "learning_practice_inputs_position" CHECK("position">=0)
);
--> statement-breakpoint
CREATE TABLE `material_evidence_citations` (
	`version_id` integer NOT NULL,
	`marker` integer NOT NULL,
	`input_id` integer NOT NULL,
	`anchor` text NOT NULL,
	`target` text,
	`quote` text NOT NULL,
	CONSTRAINT `material_evidence_citations_pk` PRIMARY KEY(`version_id`, `marker`),
	CONSTRAINT `fk_material_evidence_citations_input_id_version_id_material_evidence_inputs_id_version_id_fk` FOREIGN KEY (`input_id`,`version_id`) REFERENCES `material_evidence_inputs`(`id`,`version_id`) ON DELETE CASCADE,
	CONSTRAINT "material_evidence_citation_value" CHECK("marker" BETWEEN 1 AND 4294967295 AND json_valid("anchor") AND ("target" IS NULL OR json_valid("target")) AND length("quote")>0)
);
--> statement-breakpoint
CREATE TABLE `material_evidence_inputs` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`version_id` integer,
	`request_id` text,
	`position` integer NOT NULL,
	`document_version_id` integer,
	`source_id` integer,
	`source_revision` integer,
	`source_snapshot_id` integer,
	CONSTRAINT `fk_material_evidence_inputs_version_id_material_versions_id_fk` FOREIGN KEY (`version_id`) REFERENCES `material_versions`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_material_evidence_inputs_request_id_material_generation_requests_id_fk` FOREIGN KEY (`request_id`) REFERENCES `material_generation_requests`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_material_evidence_inputs_document_version_id_study_document_versions_id_fk` FOREIGN KEY (`document_version_id`) REFERENCES `study_document_versions`(`id`),
	CONSTRAINT `fk_material_evidence_inputs_source_id_source_revision_source_snapshot_id_source_extraction_revisions_source_id_revision_snapshot_id_fk` FOREIGN KEY (`source_id`,`source_revision`,`source_snapshot_id`) REFERENCES `source_extraction_revisions`(`source_id`,`revision`,`snapshot_id`),
	CONSTRAINT "exact_content_input_reference" CHECK((("document_version_id" IS NOT NULL AND "source_id" IS NULL AND "source_revision" IS NULL AND "source_snapshot_id" IS NULL) OR ("document_version_id" IS NULL AND "source_id" IS NOT NULL AND "source_revision">0 AND "source_snapshot_id" IS NOT NULL))),
	CONSTRAINT "material_evidence_input_owner" CHECK(("version_id" IS NULL)!=("request_id" IS NULL) AND "position">=0)
);
--> statement-breakpoint
ALTER TABLE `learning_practice_slots` RENAME COLUMN `input_version_ids` TO `inputs`;
--> statement-breakpoint
PRAGMA foreign_keys=OFF;
--> statement-breakpoint
CREATE TABLE `__new_learning_practice_slots` (
	`id` text PRIMARY KEY,
	`project_id` integer NOT NULL,
	`epoch` text NOT NULL,
	`ordinal` integer NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`generation_attempt` integer DEFAULT '0' NOT NULL,
	`failure_kind` text,
	`inputs` text NOT NULL,
	`version_id` integer,
	`attempt_id` integer,
	CONSTRAINT `fk_learning_practice_slots_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_learning_practice_slots_version_id_material_versions_id_fk` FOREIGN KEY (`version_id`) REFERENCES `material_versions`(`id`),
	CONSTRAINT `fk_learning_practice_slots_attempt_id_material_quiz_attempts_id_fk` FOREIGN KEY (`attempt_id`) REFERENCES `material_quiz_attempts`(`id`),
	CONSTRAINT "learning_practice_slot_values" CHECK(length("id") > 0 AND length("epoch") > 0 AND "ordinal" >= 0 AND "kind" IN ('choice', 'open') AND "status" IN ('pending', 'ready', 'answered', 'cancelled') AND json_valid("inputs") AND (("version_id" IS NULL) = ("attempt_id" IS NULL)) AND ("status" NOT IN ('ready', 'answered') OR "version_id" IS NOT NULL))
);
--> statement-breakpoint
INSERT INTO `__new_learning_practice_slots`(`id`, `project_id`, `epoch`, `ordinal`, `kind`, `status`, `generation_attempt`, `failure_kind`, `inputs`, `version_id`, `attempt_id`) SELECT `id`, `project_id`, `epoch`, `ordinal`, `kind`, `status`, `generation_attempt`, `failure_kind`, `inputs`, `version_id`, `attempt_id` FROM `learning_practice_slots`;
--> statement-breakpoint
DROP TABLE `learning_practice_slots`;
--> statement-breakpoint
ALTER TABLE `__new_learning_practice_slots` RENAME TO `learning_practice_slots`;
--> statement-breakpoint
PRAGMA foreign_keys=ON;
--> statement-breakpoint
CREATE UNIQUE INDEX `learning_practice_slot_ordinal` ON `learning_practice_slots` (`project_id`,`epoch`,`ordinal`);
--> statement-breakpoint
CREATE INDEX `learning_practice_slot_status` ON `learning_practice_slots` (`project_id`,`epoch`,`status`);
--> statement-breakpoint
CREATE INDEX `learning_practice_inputs_document` ON `learning_practice_inputs` (`document_version_id`);
--> statement-breakpoint
CREATE INDEX `learning_practice_inputs_source` ON `learning_practice_inputs` (`source_id`,`source_revision`,`source_snapshot_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `material_evidence_inputs_version_owner` ON `material_evidence_inputs` (`id`,`version_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `material_evidence_inputs_version_position` ON `material_evidence_inputs` (`version_id`,`position`);
--> statement-breakpoint
CREATE UNIQUE INDEX `material_evidence_inputs_request_position` ON `material_evidence_inputs` (`request_id`,`position`);
--> statement-breakpoint
CREATE INDEX `material_evidence_inputs_document` ON `material_evidence_inputs` (`document_version_id`);
--> statement-breakpoint
CREATE INDEX `material_evidence_inputs_source` ON `material_evidence_inputs` (`source_id`,`source_revision`,`source_snapshot_id`);
--> statement-breakpoint
CREATE TEMP TABLE cutover_content_inputs AS
SELECT l.material_version_id old_id,l.document_version_id document_version_id,NULL source_id,NULL source_revision,NULL source_snapshot_id,
 json_object('kind','document','versionId',CAST(l.document_version_id AS TEXT)) input
FROM legacy_document_versions l JOIN study_document_versions v ON v.id=l.document_version_id
WHERE l.retired=0 AND v.status='published' AND NOT EXISTS(SELECT 1 FROM study_document_retirements r WHERE r.version_id=v.id)
UNION ALL
SELECT m.version_id,NULL,m.source_id,m.revision,m.document_id,
 json_object('kind','source','sourceId',CAST(m.source_id AS TEXT),'revision',CAST(m.revision AS TEXT),'snapshotId',CAST(m.document_id AS TEXT))
FROM material_source_snapshots m JOIN source_extraction_revisions e ON e.source_id=m.source_id AND e.revision=m.revision AND e.snapshot_id=m.document_id;
--> statement-breakpoint
INSERT INTO material_evidence_inputs(version_id,position,document_version_id,source_id,source_revision,source_snapshot_id)
SELECT i.version_id,ROW_NUMBER() OVER(PARTITION BY i.version_id ORDER BY i.input_version_id)-1,m.document_version_id,m.source_id,m.source_revision,m.source_snapshot_id
FROM material_version_inputs i JOIN cutover_content_inputs m ON m.old_id=i.input_version_id
JOIN material_versions v ON v.id=i.version_id WHERE v.kind IN ('diagram','quiz','flashcards');
--> statement-breakpoint
INSERT INTO material_evidence_inputs(request_id,position,document_version_id,source_id,source_revision,source_snapshot_id)
SELECT i.request_id,i.position,m.document_version_id,m.source_id,m.source_revision,m.source_snapshot_id
FROM material_generation_inputs i JOIN cutover_content_inputs m ON m.old_id=i.version_id
JOIN material_generation_requests r ON r.id=i.request_id WHERE json_extract(r.payload,'$.kind') IN ('diagram','quiz','flashcards');
--> statement-breakpoint
INSERT INTO material_evidence_citations(version_id,marker,input_id,anchor,target,quote)
SELECT c.version_id,c.marker,i.id,c.anchor,
 CASE WHEN c.target IS NULL THEN NULL ELSE json_object('blockId',json_extract(c.target,'$.blockId'),'start',json_extract(c.target,'$.start'),'end',json_extract(c.target,'$.end')) END,c.quote
FROM material_version_citations c JOIN cutover_content_inputs m ON m.old_id=c.input_version_id
JOIN material_evidence_inputs i ON i.version_id=c.version_id AND i.document_version_id IS m.document_version_id
 AND i.source_id IS m.source_id AND i.source_revision IS m.source_revision AND i.source_snapshot_id IS m.source_snapshot_id;
--> statement-breakpoint
UPDATE material_generation_requests AS r SET payload=json_set(json_remove(payload,'$.inputVersionIds'),'$.inputs',json((
SELECT json_group_array(json(input)) FROM (SELECT m.input FROM json_each(r.payload,'$.inputVersionIds') j JOIN cutover_content_inputs m ON CAST(m.old_id AS TEXT)=j.value ORDER BY CAST(j.key AS INTEGER)))))
WHERE json_extract(payload,'$.kind') IN ('diagram','quiz','flashcards')
AND NOT EXISTS(SELECT 1 FROM json_each(r.payload,'$.inputVersionIds') j WHERE NOT EXISTS(SELECT 1 FROM cutover_content_inputs m WHERE CAST(m.old_id AS TEXT)=j.value));
--> statement-breakpoint
UPDATE material_generation_requests SET cancelled=1,payload='{}',result_metadata=NULL
WHERE json_extract(payload,'$.kind') IN ('diagram','quiz','flashcards') AND json_type(payload,'$.inputs') IS NOT 'array';
--> statement-breakpoint
DELETE FROM material_evidence_inputs WHERE request_id IN(SELECT id FROM material_generation_requests WHERE payload='{}');
--> statement-breakpoint
CREATE TEMP TABLE cutover_practice_inputs AS SELECT p.id,p.inputs old_inputs,
(SELECT json_group_array(json(input)) FROM (SELECT m.input FROM json_each(p.inputs) j JOIN cutover_content_inputs m ON CAST(m.old_id AS TEXT)=j.value ORDER BY CAST(j.key AS INTEGER))) inputs,
EXISTS(SELECT 1 FROM json_each(p.inputs) j WHERE NOT EXISTS(SELECT 1 FROM cutover_content_inputs m WHERE CAST(m.old_id AS TEXT)=j.value)) unsupported
FROM learning_practice_slots p;
--> statement-breakpoint
UPDATE learning_practice_slots AS p SET inputs=(SELECT inputs FROM cutover_practice_inputs c WHERE c.id=p.id),
status=CASE WHEN (SELECT unsupported FROM cutover_practice_inputs c WHERE c.id=p.id)=1 THEN 'cancelled' ELSE status END;
--> statement-breakpoint
UPDATE learning_practice_controls SET enabled=0 WHERE EXISTS(SELECT 1 FROM learning_practice_slots p JOIN cutover_practice_inputs c ON c.id=p.id WHERE p.project_id=learning_practice_controls.project_id AND p.epoch=learning_practice_controls.epoch AND c.unsupported=1);
--> statement-breakpoint
INSERT INTO learning_practice_inputs(slot_id,position,document_version_id,source_id,source_revision,source_snapshot_id)
SELECT p.id,CAST(j.key AS INTEGER),m.document_version_id,m.source_id,m.source_revision,m.source_snapshot_id
FROM learning_practice_slots p JOIN cutover_practice_inputs c ON c.id=p.id JOIN json_each(c.old_inputs) j
JOIN cutover_content_inputs m ON CAST(m.old_id AS TEXT)=j.value
WHERE p.status IN ('pending','ready') AND c.unsupported=0;
--> statement-breakpoint
CREATE TRIGGER learning_practice_slot_answer
BEFORE UPDATE OF status ON learning_practice_slots
WHEN NEW.status = 'answered' AND OLD.status != 'answered' AND NOT EXISTS (
  SELECT 1 FROM material_quiz_responses r WHERE r.attempt_id = NEW.attempt_id AND r.version_id = NEW.version_id
)
BEGIN SELECT RAISE(ABORT, 'practice answer requires a canonical response'); END;
--> statement-breakpoint
CREATE TRIGGER learning_practice_slot_retained
BEFORE DELETE ON learning_practice_slots
WHEN EXISTS (SELECT 1 FROM projects WHERE id = OLD.project_id)
BEGIN SELECT RAISE(ABORT, 'practice slot is retained'); END;
--> statement-breakpoint
CREATE TRIGGER learning_practice_retry_capture
BEFORE INSERT ON learning_practice_slots
WHEN NEW.generation_attempt != 0 OR NEW.failure_kind IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'practice slots start with an unfailed first generation'); END;
--> statement-breakpoint
CREATE TRIGGER learning_practice_retry_transition
BEFORE UPDATE OF generation_attempt ON learning_practice_slots
WHEN NEW.generation_attempt IS NOT OLD.generation_attempt AND (
  OLD.status != 'pending' OR NEW.status != 'pending'
  OR OLD.failure_kind IS NULL OR NEW.failure_kind IS NOT NULL
  OR typeof(NEW.generation_attempt) != 'integer'
  OR NEW.generation_attempt != OLD.generation_attempt + 1
  OR NEW.generation_attempt > 9007199254740991
)
BEGIN SELECT RAISE(ABORT, 'practice retry must advance a failed generation exactly once'); END;
--> statement-breakpoint
CREATE TRIGGER learning_practice_failure_clear
BEFORE UPDATE OF failure_kind ON learning_practice_slots
WHEN OLD.failure_kind IS NOT NULL AND NEW.failure_kind IS NULL
  AND NEW.generation_attempt = OLD.generation_attempt
  AND NEW.status = 'pending'
BEGIN SELECT RAISE(ABORT, 'practice failures require an explicit retry'); END;
--> statement-breakpoint
CREATE TRIGGER learning_practice_slot_publication
BEFORE UPDATE OF version_id,attempt_id,status ON learning_practice_slots
WHEN OLD.version_id IS NULL AND NEW.version_id IS NOT NULL AND (
  NEW.status != 'ready' OR NOT EXISTS (
    SELECT 1 FROM learning_practice_controls c JOIN material_generation_scopes g ON g.id = c.epoch AND g.project_id = c.project_id
    JOIN material_versions v ON v.id = NEW.version_id AND EXISTS(SELECT 1 FROM project_materials pm WHERE pm.material_id=v.material_id AND pm.project_id=c.project_id)
    JOIN material_generation_requests r ON r.id = NEW.id AND r.project_id = c.project_id AND r.result_version_id = v.id
    JOIN material_quiz_attempts a ON a.id = NEW.attempt_id AND a.version_id = v.id
    WHERE c.project_id = NEW.project_id AND c.epoch = NEW.epoch AND c.enabled = 1 AND g.enabled = 1
      AND v.status = 'published' AND v.kind = 'quiz' AND v.generation_request_id = NEW.id
      AND json_extract(r.payload, '$.scopeId') = NEW.epoch
      AND json_extract(r.payload, '$.questionSpec.count') = 1 AND json_extract(r.payload, '$.questionSpec.kind') = NEW.kind
      AND json_extract(r.payload, '$.inputs') = json(NEW.inputs)
      AND (SELECT COUNT(*) FROM material_quiz_questions q WHERE q.version_id = v.id) = 1
      AND NOT EXISTS (SELECT 1 FROM material_quiz_questions q WHERE q.version_id = v.id AND ((NEW.kind = 'open' AND q.kind != 'open') OR (NEW.kind = 'choice' AND q.kind NOT IN ('single_choice','multiple_choice'))))
  )
)
BEGIN SELECT RAISE(ABORT, 'practice publication does not match its slot'); END;
--> statement-breakpoint
CREATE TRIGGER learning_practice_slot_immutable
BEFORE UPDATE ON learning_practice_slots
WHEN ((NEW.id IS NOT OLD.id OR NEW.project_id IS NOT OLD.project_id OR NEW.epoch IS NOT OLD.epoch
  OR NEW.ordinal IS NOT OLD.ordinal OR NEW.kind IS NOT OLD.kind OR NEW.inputs IS NOT OLD.inputs
  OR (OLD.version_id IS NOT NULL AND (NEW.version_id IS NOT OLD.version_id OR NEW.attempt_id IS NOT OLD.attempt_id))
  OR (OLD.status IN ('answered','cancelled') AND NEW.status IS NOT OLD.status)
  OR (OLD.status = 'ready' AND NEW.status NOT IN ('ready','answered','cancelled'))
  OR (OLD.status = 'pending' AND NEW.status NOT IN ('pending','ready','cancelled'))) AND NOT (EXISTS(SELECT 1 FROM material_versions v JOIN material_deletion_members d ON d.material_id=v.material_id WHERE v.id=OLD.version_id) AND NEW.status='cancelled' AND NEW.version_id IS NULL AND NEW.attempt_id IS NULL AND NEW.id IS OLD.id AND NEW.project_id IS OLD.project_id AND NEW.epoch IS OLD.epoch AND NEW.ordinal IS OLD.ordinal AND NEW.kind IS OLD.kind AND NEW.inputs IS OLD.inputs AND NEW.generation_attempt IS OLD.generation_attempt AND NEW.failure_kind IS OLD.failure_kind)) AND NOT (EXISTS(SELECT 1 FROM material_history_members h JOIN material_history_prunes p ON p.operation_id=h.operation_id WHERE h.version_id=OLD.version_id AND p.status IN ('pending','failed')) AND NEW.status='cancelled' AND NEW.version_id IS NULL AND NEW.attempt_id IS NULL AND NEW.id IS OLD.id AND NEW.project_id IS OLD.project_id AND NEW.epoch IS OLD.epoch AND NEW.ordinal IS OLD.ordinal AND NEW.kind IS OLD.kind AND NEW.inputs IS OLD.inputs AND NEW.generation_attempt IS OLD.generation_attempt AND NEW.failure_kind IS OLD.failure_kind)
BEGIN SELECT RAISE(ABORT, 'practice slot intent and receipts are immutable'); END;
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
    (json_extract(j.value,'$.kind')='document' AND NOT EXISTS(
      SELECT 1 FROM study_document_versions v JOIN study_documents d ON d.id=v.document_id
      JOIN project_documents p ON p.document_id=d.id AND p.project_id=NEW.project_id
      WHERE CAST(v.id AS TEXT)=json_extract(j.value,'$.versionId') AND v.status='published' AND d.archived_at IS NULL
      AND NOT EXISTS(SELECT 1 FROM study_document_retirements r WHERE r.version_id=v.id)))
    OR (json_extract(j.value,'$.kind')='source' AND NOT EXISTS(
      SELECT 1 FROM source_extraction_revisions e JOIN sources s ON s.id=e.source_id
      WHERE CAST(e.source_id AS TEXT)=json_extract(j.value,'$.sourceId') AND CAST(e.revision AS TEXT)=json_extract(j.value,'$.revision')
      AND CAST(e.snapshot_id AS TEXT)=json_extract(j.value,'$.snapshotId') AND s.project_id=NEW.project_id))
    OR json_extract(j.value,'$.kind') IS NULL OR json_extract(j.value,'$.kind') NOT IN ('source','document'))
BEGIN SELECT RAISE(ABORT, 'invalid or unbounded practice slot capture'); END;
--> statement-breakpoint
CREATE TRIGGER material_generation_intent_immutable BEFORE UPDATE ON material_generation_requests
WHEN NEW.id IS NOT OLD.id OR NEW.project_id IS NOT OLD.project_id OR NEW.created_at IS NOT OLD.created_at
 OR (NEW.payload IS NOT OLD.payload AND NOT (NEW.payload='{}' AND NEW.cancelled=1 AND NEW.result_metadata IS NULL AND (EXISTS(SELECT 1 FROM session_generation_retirements x WHERE x.request_id=OLD.id) OR EXISTS(SELECT 1 FROM (SELECT request_id,kind FROM material_deletion_requests UNION ALL SELECT request_id,kind FROM material_history_requests) md WHERE md.request_id=OLD.id AND md.kind='generation'))))
BEGIN SELECT RAISE(ABORT, 'generation intent is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_generation_cancel_fence BEFORE UPDATE ON material_generation_requests
WHEN (OLD.cancelled=1 AND NEW.cancelled!=1) OR (NEW.cancelled=1 AND OLD.result_version_id IS NULL AND NEW.result_version_id IS NOT NULL)
 OR (OLD.result_version_id IS NOT NULL AND NEW.result_metadata IS NOT OLD.result_metadata
 AND NOT (NEW.result_metadata IS NULL AND NEW.payload='{}' AND NEW.cancelled=1 AND (EXISTS(SELECT 1 FROM session_generation_retirements x WHERE x.request_id=OLD.id) OR EXISTS(SELECT 1 FROM (SELECT request_id,kind FROM material_deletion_requests UNION ALL SELECT request_id,kind FROM material_history_requests) md WHERE md.request_id=OLD.id AND md.kind='generation'))))
BEGIN SELECT RAISE(ABORT, 'generation cancellation and result metadata are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_evidence_inputs_owner BEFORE INSERT ON material_evidence_inputs
WHEN (NEW.version_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM material_versions v WHERE v.id=NEW.version_id AND v.status='draft' AND v.kind IN ('diagram','quiz','flashcards')))
 OR (NEW.request_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM material_generation_requests r WHERE r.id=NEW.request_id AND r.cancelled=0 AND r.result_version_id IS NULL
 AND json_extract(r.payload,'$.inputs['||NEW.position||'].kind')=CASE WHEN NEW.document_version_id IS NULL THEN 'source' ELSE 'document' END
 AND json_extract(r.payload,'$.inputs['||NEW.position||'].versionId') IS CASE WHEN NEW.document_version_id IS NULL THEN NULL ELSE CAST(NEW.document_version_id AS TEXT) END
 AND json_extract(r.payload,'$.inputs['||NEW.position||'].sourceId') IS CASE WHEN NEW.source_id IS NULL THEN NULL ELSE CAST(NEW.source_id AS TEXT) END
 AND json_extract(r.payload,'$.inputs['||NEW.position||'].revision') IS CASE WHEN NEW.source_revision IS NULL THEN NULL ELSE CAST(NEW.source_revision AS TEXT) END
 AND json_extract(r.payload,'$.inputs['||NEW.position||'].snapshotId') IS CASE WHEN NEW.source_snapshot_id IS NULL THEN NULL ELSE CAST(NEW.source_snapshot_id AS TEXT) END))
BEGIN SELECT RAISE(ABORT,'exact learning input does not match its owner'); END;
--> statement-breakpoint
CREATE TRIGGER material_evidence_inputs_available BEFORE INSERT ON material_evidence_inputs
WHEN NEW.document_version_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM study_document_versions v JOIN study_documents d ON d.id=v.document_id
WHERE v.id=NEW.document_version_id AND v.status='published' AND d.archived_at IS NULL
AND NOT EXISTS(SELECT 1 FROM study_document_retirements r WHERE r.version_id=v.id))
BEGIN SELECT RAISE(ABORT,'exact authored learning input is unavailable'); END;
--> statement-breakpoint
CREATE TRIGGER material_evidence_inputs_immutable BEFORE UPDATE ON material_evidence_inputs
BEGIN SELECT RAISE(ABORT,'exact learning inputs are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER learning_practice_inputs_available BEFORE INSERT ON learning_practice_inputs
WHEN NEW.document_version_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM study_document_versions v JOIN study_documents d ON d.id=v.document_id
WHERE v.id=NEW.document_version_id AND v.status='published' AND d.archived_at IS NULL
AND NOT EXISTS(SELECT 1 FROM study_document_retirements r WHERE r.version_id=v.id))
BEGIN SELECT RAISE(ABORT,'exact authored learning input is unavailable'); END;
--> statement-breakpoint
CREATE TRIGGER learning_practice_inputs_immutable BEFORE UPDATE ON learning_practice_inputs
BEGIN SELECT RAISE(ABORT,'exact learning inputs are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_generation_publish BEFORE UPDATE OF status ON material_versions
WHEN NEW.status='published' AND NEW.creator='agent' AND NEW.operation='generate' AND NOT EXISTS(SELECT 1 FROM material_generation_requests r JOIN material_versions v ON v.generation_request_id=r.id JOIN materials m ON m.id=v.material_id
 WHERE v.id=NEW.id AND r.cancelled=0 AND v.kind IN ('diagram','quiz','flashcards') AND json_extract(r.payload,'$.kind')=v.kind
 AND json_extract(r.payload,'$.title')=m.title AND json_extract(r.payload,'$.instruction') IS v.instruction
 AND EXISTS(SELECT 1 FROM project_materials p WHERE p.material_id=v.material_id AND p.project_id=r.project_id)
 AND json_array_length(r.payload,'$.inputs') BETWEEN 1 AND 20
 AND (SELECT COUNT(*) FROM material_evidence_inputs WHERE request_id=r.id)=json_array_length(r.payload,'$.inputs')
 AND NOT EXISTS(SELECT position,document_version_id,source_id,source_revision,source_snapshot_id FROM material_evidence_inputs WHERE request_id=r.id
 EXCEPT SELECT position,document_version_id,source_id,source_revision,source_snapshot_id FROM material_evidence_inputs WHERE version_id=v.id)
 AND NOT EXISTS(SELECT position,document_version_id,source_id,source_revision,source_snapshot_id FROM material_evidence_inputs WHERE version_id=v.id
 EXCEPT SELECT position,document_version_id,source_id,source_revision,source_snapshot_id FROM material_evidence_inputs WHERE request_id=r.id))
BEGIN SELECT RAISE(ABORT,'generated publication does not match exact request'); END;
--> statement-breakpoint
CREATE TRIGGER material_generation_receipt_valid BEFORE UPDATE OF result_version_id,result_hash ON material_generation_requests
WHEN OLD.result_version_id IS NULL AND NEW.result_version_id IS NOT NULL AND (length(NEW.result_hash)!=64 OR NEW.result_hash GLOB '*[^0-9a-f]*'
 OR NOT EXISTS(SELECT 1 FROM material_generation_requests r JOIN material_versions v ON v.generation_request_id=r.id JOIN materials m ON m.id=v.material_id
 WHERE v.id=NEW.result_version_id AND r.cancelled=0 AND v.kind IN ('diagram','quiz','flashcards') AND json_extract(r.payload,'$.kind')=v.kind
 AND json_extract(r.payload,'$.title')=m.title AND json_extract(r.payload,'$.instruction') IS v.instruction
 AND EXISTS(SELECT 1 FROM project_materials p WHERE p.material_id=v.material_id AND p.project_id=r.project_id)
 AND json_array_length(r.payload,'$.inputs') BETWEEN 1 AND 20
 AND (SELECT COUNT(*) FROM material_evidence_inputs WHERE request_id=r.id)=json_array_length(r.payload,'$.inputs')
 AND NOT EXISTS(SELECT position,document_version_id,source_id,source_revision,source_snapshot_id FROM material_evidence_inputs WHERE request_id=r.id
 EXCEPT SELECT position,document_version_id,source_id,source_revision,source_snapshot_id FROM material_evidence_inputs WHERE version_id=v.id)
 AND NOT EXISTS(SELECT position,document_version_id,source_id,source_revision,source_snapshot_id FROM material_evidence_inputs WHERE version_id=v.id
 EXCEPT SELECT position,document_version_id,source_id,source_revision,source_snapshot_id FROM material_evidence_inputs WHERE request_id=r.id) AND r.id=NEW.id AND v.status='published'))
BEGIN SELECT RAISE(ABORT,'generated receipt does not match exact publication'); END;
--> statement-breakpoint
CREATE TRIGGER material_evidence_citations_draft BEFORE INSERT ON material_evidence_citations
WHEN NOT EXISTS(SELECT 1 FROM material_versions WHERE id=NEW.version_id AND status='draft')
BEGIN SELECT RAISE(ABORT,'published learning citations are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_evidence_citations_immutable BEFORE UPDATE ON material_evidence_citations
BEGIN SELECT RAISE(ABORT,'exact learning citations are immutable'); END;
--> statement-breakpoint
DROP TABLE cutover_practice_inputs;
--> statement-breakpoint
DROP TABLE cutover_content_inputs;

--> statement-breakpoint
CREATE TRIGGER material_evidence_inputs_retained BEFORE DELETE ON material_evidence_inputs
WHEN (OLD.version_id IS NOT NULL AND EXISTS(SELECT 1 FROM material_versions WHERE id=OLD.version_id AND status='published')
 AND NOT (EXISTS(SELECT 1 FROM material_history_members WHERE version_id=OLD.version_id)
 OR EXISTS(SELECT 1 FROM material_versions v JOIN material_deletion_members d ON d.material_id=v.material_id WHERE v.id=OLD.version_id))) OR (OLD.request_id IS NOT NULL AND EXISTS(SELECT 1 FROM material_generation_requests r WHERE r.id=OLD.request_id AND r.cancelled=0))
BEGIN SELECT RAISE(ABORT,'published learning evidence is retained'); END;
--> statement-breakpoint
CREATE TRIGGER material_evidence_citations_retained BEFORE DELETE ON material_evidence_citations
WHEN EXISTS(SELECT 1 FROM material_versions WHERE id=OLD.version_id AND status='published') AND NOT (EXISTS(SELECT 1 FROM material_history_members WHERE version_id=OLD.version_id)
 OR EXISTS(SELECT 1 FROM material_versions v JOIN material_deletion_members d ON d.material_id=v.material_id WHERE v.id=OLD.version_id))
BEGIN SELECT RAISE(ABORT,'published learning citations are retained'); END;
--> statement-breakpoint
CREATE TRIGGER learning_practice_inputs_capture BEFORE INSERT ON learning_practice_inputs
WHEN NOT EXISTS(SELECT 1 FROM learning_practice_slots p WHERE p.id=NEW.slot_id AND p.status IN ('pending','ready')
 AND json_extract(p.inputs,'$['||NEW.position||'].kind')=CASE WHEN NEW.document_version_id IS NULL THEN 'source' ELSE 'document' END
 AND json_extract(p.inputs,'$['||NEW.position||'].versionId') IS CASE WHEN NEW.document_version_id IS NULL THEN NULL ELSE CAST(NEW.document_version_id AS TEXT) END
 AND json_extract(p.inputs,'$['||NEW.position||'].sourceId') IS CASE WHEN NEW.source_id IS NULL THEN NULL ELSE CAST(NEW.source_id AS TEXT) END
 AND json_extract(p.inputs,'$['||NEW.position||'].revision') IS CASE WHEN NEW.source_revision IS NULL THEN NULL ELSE CAST(NEW.source_revision AS TEXT) END
 AND json_extract(p.inputs,'$['||NEW.position||'].snapshotId') IS CASE WHEN NEW.source_snapshot_id IS NULL THEN NULL ELSE CAST(NEW.source_snapshot_id AS TEXT) END)
BEGIN SELECT RAISE(ABORT,'practice evidence does not match exact capture'); END;
--> statement-breakpoint
CREATE TRIGGER learning_practice_inputs_retained BEFORE DELETE ON learning_practice_inputs
WHEN EXISTS(SELECT 1 FROM learning_practice_slots p JOIN learning_practice_controls c ON c.project_id=p.project_id AND c.epoch=p.epoch
 WHERE p.id=OLD.slot_id AND p.status IN ('pending','ready') AND c.enabled=1)
BEGIN SELECT RAISE(ABORT,'active practice evidence is retained'); END;
