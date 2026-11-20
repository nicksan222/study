CREATE TABLE `page_attachments` (
	`page_id` integer NOT NULL,
	`source_id` integer NOT NULL,
	CONSTRAINT `page_attachments_pk` PRIMARY KEY(`page_id`, `source_id`),
	CONSTRAINT `fk_page_attachments_page_id_pages_id_fk` FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_page_attachments_source_id_sources_id_fk` FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `page_attachments_source_idx` ON `page_attachments` (`source_id`);
--> statement-breakpoint
DROP TRIGGER page_generation_result_insert;
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
 JOIN page_versions b ON b.id=NEW.expected_version_id
 JOIN page_versions v ON v.id=NEW.result_version_id
 JOIN pages d ON d.id=b.page_id
 JOIN page_proposals p ON p.request_id=tr.id AND p.base_version_id=b.id AND p.proposed_version_id=v.id
 WHERE tr.id=NEW.id AND tr.note_id IS NULL AND NEW.note_id IS NULL AND tr.cancelled=0
 AND json_type(tr.request,'$.improvement')='object'
 AND json_extract(tr.request,'$.contextRequestId')=tr.context_request_id
 AND tr.context_request_id='improve/' || json_extract(tr.request,'$.improvement.key')
 AND json_extract(tr.request,'$.editTargetVersionId')=CAST(b.id AS TEXT)
 AND json_extract(tr.request,'$.improvement.versionId')=CAST(b.id AS TEXT)
 AND json_extract(tr.request,'$.improvement.instruction')=tr.instruction
 AND b.page_id=NEW.page_id AND v.status='draft' AND v.operation='generate'
 AND v.language=json_extract(tr.request,'$.improvement.language')
 AND v.instruction=CASE WHEN tr.instruction!='' THEN tr.instruction ELSE 'clarity, grammar' END
 AND d.archived_at IS NULL
 AND NOT EXISTS(SELECT 1 FROM page_deletions x WHERE x.page_id=d.id)
 AND (json_extract(tr.request,'$.improvement.projectId') IS NULL OR EXISTS(
   SELECT 1 FROM project_pages m WHERE m.page_id=d.id AND CAST(m.project_id AS TEXT)=json_extract(tr.request,'$.improvement.projectId')
 ))
 AND NOT EXISTS(SELECT 1 FROM workflow_retired_correlations r WHERE r.correlation_id IN (tr.id,tr.context_request_id))
 AND NOT EXISTS(SELECT 1 FROM workflow_executions e WHERE e.status='cancelled' AND json_extract(e.payload,'$.event.correlationId') IN (tr.id,tr.context_request_id))
 AND EXISTS(SELECT 1 FROM page_inputs i WHERE i.version_id=v.id AND i.page_version_id=b.id)
 AND NOT EXISTS(
   SELECT page_version_id,source_id,source_revision,source_snapshot_id,exact_message_version_id FROM page_inputs WHERE version_id=v.id
   EXCEPT SELECT page_version_id,source_id,source_revision,source_snapshot_id,exact_message_version_id FROM page_inputs WHERE version_id=b.id
   EXCEPT SELECT b.id,NULL,NULL,NULL,NULL
 )
 AND NOT EXISTS(
   SELECT page_version_id,source_id,source_revision,source_snapshot_id,exact_message_version_id FROM page_inputs WHERE version_id=b.id
   EXCEPT SELECT page_version_id,source_id,source_revision,source_snapshot_id,exact_message_version_id FROM page_inputs WHERE version_id=v.id
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
DROP TRIGGER page_generation_result_update;
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
 JOIN page_versions b ON b.id=NEW.expected_version_id
 JOIN page_versions v ON v.id=NEW.result_version_id
 JOIN pages d ON d.id=b.page_id
 JOIN page_proposals p ON p.request_id=tr.id AND p.base_version_id=b.id AND p.proposed_version_id=v.id
 WHERE tr.id=NEW.id AND tr.note_id IS NULL AND NEW.note_id IS NULL AND tr.cancelled=0
 AND json_type(tr.request,'$.improvement')='object'
 AND json_extract(tr.request,'$.contextRequestId')=tr.context_request_id
 AND tr.context_request_id='improve/' || json_extract(tr.request,'$.improvement.key')
 AND json_extract(tr.request,'$.editTargetVersionId')=CAST(b.id AS TEXT)
 AND json_extract(tr.request,'$.improvement.versionId')=CAST(b.id AS TEXT)
 AND json_extract(tr.request,'$.improvement.instruction')=tr.instruction
 AND b.page_id=NEW.page_id AND v.status='draft' AND v.operation='generate'
 AND v.language=json_extract(tr.request,'$.improvement.language')
 AND v.instruction=CASE WHEN tr.instruction!='' THEN tr.instruction ELSE 'clarity, grammar' END
 AND d.archived_at IS NULL
 AND NOT EXISTS(SELECT 1 FROM page_deletions x WHERE x.page_id=d.id)
 AND (json_extract(tr.request,'$.improvement.projectId') IS NULL OR EXISTS(
   SELECT 1 FROM project_pages m WHERE m.page_id=d.id AND CAST(m.project_id AS TEXT)=json_extract(tr.request,'$.improvement.projectId')
 ))
 AND NOT EXISTS(SELECT 1 FROM workflow_retired_correlations r WHERE r.correlation_id IN (tr.id,tr.context_request_id))
 AND NOT EXISTS(SELECT 1 FROM workflow_executions e WHERE e.status='cancelled' AND json_extract(e.payload,'$.event.correlationId') IN (tr.id,tr.context_request_id))
 AND EXISTS(SELECT 1 FROM page_inputs i WHERE i.version_id=v.id AND i.page_version_id=b.id)
 AND NOT EXISTS(
   SELECT page_version_id,source_id,source_revision,source_snapshot_id,exact_message_version_id FROM page_inputs WHERE version_id=v.id
   EXCEPT SELECT page_version_id,source_id,source_revision,source_snapshot_id,exact_message_version_id FROM page_inputs WHERE version_id=b.id
   EXCEPT SELECT b.id,NULL,NULL,NULL,NULL
 )
 AND NOT EXISTS(
   SELECT page_version_id,source_id,source_revision,source_snapshot_id,exact_message_version_id FROM page_inputs WHERE version_id=b.id
   EXCEPT SELECT page_version_id,source_id,source_revision,source_snapshot_id,exact_message_version_id FROM page_inputs WHERE version_id=v.id
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
DROP TRIGGER page_proposal_receipt_exact_owner;
--> statement-breakpoint
CREATE TRIGGER page_proposal_receipt_exact_owner BEFORE INSERT ON "page_proposal_receipts"
WHEN NOT (EXISTS(SELECT 1 FROM "page_proposals" p JOIN "page_versions" base ON base.id=p.base_version_id JOIN "page_versions" proposed ON proposed.id=p.proposed_version_id JOIN "page_versions" current ON current.id=NEW.current_version_id
 WHERE p.request_id=NEW.request_id AND current."page_id"=base."page_id" AND current.status='published'
 AND NOT EXISTS(SELECT 1 FROM "page_retirements" x WHERE x.version_id IN (base.id,proposed.id,current.id))
 AND NOT EXISTS(SELECT 1 FROM "page_transform_requests" t WHERE t.id=p.request_id AND (t.cancelled=1 OR (t."note_id" IS NULL AND NOT (
  json_type(t.request,'$.improvement')='object' AND NEW.operation='apply'
  AND t.result_version_id=p.proposed_version_id
  AND json_extract(t.request,'$.improvement.versionId')=CAST(p.base_version_id AS TEXT)
 )) OR EXISTS(SELECT 1 FROM "note_deletions" d WHERE d."note_id"=t."note_id")))
 AND NOT EXISTS(SELECT 1 FROM "page_proposal_receipts" old WHERE old.request_id=NEW.request_id AND old.operation=NEW.operation AND old.result_version_id IS NOT NULL)
 AND ((NEW.outcome='conflict' AND NOT EXISTS(SELECT 1 FROM "page_versions" newer WHERE newer."page_id"=current."page_id" AND newer.status='published' AND newer.number>current.number))
 OR EXISTS(SELECT 1 FROM "page_versions" result WHERE result.id=NEW.result_version_id AND result.status='published'
 AND NOT EXISTS(SELECT 1 FROM "page_retirements" x WHERE x.version_id=result.id)
 AND NOT EXISTS(SELECT position,"page_version_id",source_id,source_revision,source_snapshot_id,exact_message_version_id FROM "page_inputs" WHERE version_id=proposed.id EXCEPT SELECT position,"page_version_id",source_id,source_revision,source_snapshot_id,exact_message_version_id FROM "page_inputs" WHERE version_id=result.id) AND NOT EXISTS(SELECT position,"page_version_id",source_id,source_revision,source_snapshot_id,exact_message_version_id FROM "page_inputs" WHERE version_id=result.id EXCEPT SELECT position,"page_version_id",source_id,source_revision,source_snapshot_id,exact_message_version_id FROM "page_inputs" WHERE version_id=proposed.id) AND NOT EXISTS(SELECT c.marker,c.quote,i.position,i."page_version_id",i.source_id,i.source_revision,i.source_snapshot_id,i.exact_message_version_id FROM "page_citations" c JOIN "page_inputs" i ON i.id=c.input_id WHERE c.version_id=proposed.id EXCEPT SELECT c.marker,c.quote,i.position,i."page_version_id",i.source_id,i.source_revision,i.source_snapshot_id,i.exact_message_version_id FROM "page_citations" c JOIN "page_inputs" i ON i.id=c.input_id WHERE c.version_id=result.id) AND NOT EXISTS(SELECT c.marker,c.quote,i.position,i."page_version_id",i.source_id,i.source_revision,i.source_snapshot_id,i.exact_message_version_id FROM "page_citations" c JOIN "page_inputs" i ON i.id=c.input_id WHERE c.version_id=result.id EXCEPT SELECT c.marker,c.quote,i.position,i."page_version_id",i.source_id,i.source_revision,i.source_snapshot_id,i.exact_message_version_id FROM "page_citations" c JOIN "page_inputs" i ON i.id=c.input_id WHERE c.version_id=proposed.id) AND NOT EXISTS(SELECT 1 FROM "page_citations" ca JOIN "page_citations" cb ON cb.version_id=result.id AND cb.marker=ca.marker WHERE ca.version_id=proposed.id AND (NOT (ca.anchor IS cb.anchor OR (ca.anchor IS NOT NULL AND cb.anchor IS NOT NULL AND NOT EXISTS(SELECT fullkey,type,atom FROM json_tree(ca.anchor) EXCEPT SELECT fullkey,type,atom FROM json_tree(cb.anchor)) AND NOT EXISTS(SELECT fullkey,type,atom FROM json_tree(cb.anchor) EXCEPT SELECT fullkey,type,atom FROM json_tree(ca.anchor)))) OR NOT (ca.target IS cb.target OR (ca.target IS NOT NULL AND cb.target IS NOT NULL AND NOT EXISTS(SELECT fullkey,type,atom FROM json_tree(ca.target) EXCEPT SELECT fullkey,type,atom FROM json_tree(cb.target)) AND NOT EXISTS(SELECT fullkey,type,atom FROM json_tree(cb.target) EXCEPT SELECT fullkey,type,atom FROM json_tree(ca.target))))))
 AND ((NEW.outcome='applied' AND result."page_id"=base."page_id" AND current.id=base.id AND result.creator='user' AND result.operation='edit'
 AND result.instruction IS proposed.instruction AND result.language IS proposed.language
 AND EXISTS(SELECT 1 FROM "page_version_parents" parent WHERE parent.version_id=result.id AND parent.parent_version_id=base.id)
 AND NOT EXISTS(SELECT 1 FROM "page_version_parents" parent WHERE parent.version_id=result.id AND parent.parent_version_id!=base.id)
 AND NOT EXISTS(SELECT 1 FROM "page_versions" middle WHERE middle."page_id"=base."page_id" AND middle.status='published' AND middle.number>base.number AND middle.number<result.number)
 AND ((SELECT meta FROM content_snapshots WHERE id=proposed.content_snapshot_id) IS (SELECT meta FROM content_snapshots WHERE id=result.content_snapshot_id) OR ((SELECT meta FROM content_snapshots WHERE id=proposed.content_snapshot_id) IS NOT NULL AND (SELECT meta FROM content_snapshots WHERE id=result.content_snapshot_id) IS NOT NULL AND NOT EXISTS(SELECT fullkey,type,atom FROM json_tree((SELECT meta FROM content_snapshots WHERE id=proposed.content_snapshot_id)) EXCEPT SELECT fullkey,type,atom FROM json_tree((SELECT meta FROM content_snapshots WHERE id=result.content_snapshot_id))) AND NOT EXISTS(SELECT fullkey,type,atom FROM json_tree((SELECT meta FROM content_snapshots WHERE id=result.content_snapshot_id)) EXCEPT SELECT fullkey,type,atom FROM json_tree((SELECT meta FROM content_snapshots WHERE id=proposed.content_snapshot_id)))))
 AND (SELECT COUNT(*) FROM blocks WHERE document_id=proposed.content_snapshot_id)=(SELECT COUNT(*) FROM blocks WHERE document_id=result.content_snapshot_id)
 AND NOT EXISTS(SELECT 1 FROM blocks ob WHERE ob.document_id=proposed.content_snapshot_id AND NOT EXISTS(SELECT 1 FROM blocks nb WHERE nb.document_id=result.content_snapshot_id
 AND nb.ordinal=ob.ordinal AND nb.kind=ob.kind AND nb.text=ob.text AND nb.editing_id=ob.editing_id
 AND (ob.content IS nb.content OR (ob.content IS NOT NULL AND nb.content IS NOT NULL AND NOT EXISTS(SELECT fullkey,type,atom FROM json_tree(ob.content) EXCEPT SELECT fullkey,type,atom FROM json_tree(nb.content)) AND NOT EXISTS(SELECT fullkey,type,atom FROM json_tree(nb.content) EXCEPT SELECT fullkey,type,atom FROM json_tree(ob.content)))) AND (ob.anchor IS nb.anchor OR (ob.anchor IS NOT NULL AND nb.anchor IS NOT NULL AND NOT EXISTS(SELECT fullkey,type,atom FROM json_tree(ob.anchor) EXCEPT SELECT fullkey,type,atom FROM json_tree(nb.anchor)) AND NOT EXISTS(SELECT fullkey,type,atom FROM json_tree(nb.anchor) EXCEPT SELECT fullkey,type,atom FROM json_tree(ob.anchor)))))))
 OR (NEW.outcome='kept' AND result."page_id"!=base."page_id" AND result.number=1 AND result.creator='agent'
 AND result.operation=CASE WHEN proposed.operation='translate' THEN 'translate' ELSE 'generate' END
 AND result.instruction=coalesce(proposed.instruction,'Retained proposal') AND result.language IS proposed.language
 AND NOT EXISTS(SELECT 1 FROM "page_version_parents" parent WHERE parent.version_id=result.id)
 AND NOT EXISTS(SELECT 1 FROM "page_versions" newer WHERE newer."page_id"=current."page_id" AND newer.status='published' AND newer.number>current.number)
 AND NOT EXISTS(SELECT 1 FROM blocks old JOIN blocks fresh ON fresh.editing_id=old.editing_id WHERE old.document_id=proposed.content_snapshot_id AND fresh.document_id=result.content_snapshot_id)
 AND ((SELECT meta FROM content_snapshots WHERE id=proposed.content_snapshot_id) IS (SELECT meta FROM content_snapshots WHERE id=result.content_snapshot_id) OR ((SELECT meta FROM content_snapshots WHERE id=proposed.content_snapshot_id) IS NOT NULL AND (SELECT meta FROM content_snapshots WHERE id=result.content_snapshot_id) IS NOT NULL AND NOT EXISTS(SELECT fullkey,type,atom FROM json_tree((SELECT meta FROM content_snapshots WHERE id=proposed.content_snapshot_id)) EXCEPT SELECT fullkey,type,atom FROM json_tree((SELECT meta FROM content_snapshots WHERE id=result.content_snapshot_id))) AND NOT EXISTS(SELECT fullkey,type,atom FROM json_tree((SELECT meta FROM content_snapshots WHERE id=result.content_snapshot_id)) EXCEPT SELECT fullkey,type,atom FROM json_tree((SELECT meta FROM content_snapshots WHERE id=proposed.content_snapshot_id)))))
 AND (SELECT COUNT(*) FROM blocks WHERE document_id=proposed.content_snapshot_id)=(SELECT COUNT(*) FROM blocks WHERE document_id=result.content_snapshot_id)
 AND NOT EXISTS(SELECT 1 FROM blocks ob WHERE ob.document_id=proposed.content_snapshot_id AND NOT EXISTS(SELECT 1 FROM blocks nb WHERE nb.document_id=result.content_snapshot_id
 AND nb.ordinal=ob.ordinal AND nb.kind=ob.kind AND nb.text=ob.text AND nb.editing_id!=ob.editing_id
 AND (ob.content IS nb.content OR (ob.content IS NOT NULL AND nb.content IS NOT NULL AND NOT EXISTS(SELECT fullkey,type,atom FROM json_tree(ob.content) EXCEPT SELECT fullkey,type,atom FROM json_tree(nb.content)) AND NOT EXISTS(SELECT fullkey,type,atom FROM json_tree(nb.content) EXCEPT SELECT fullkey,type,atom FROM json_tree(ob.content)))) AND (ob.anchor IS nb.anchor OR (ob.anchor IS NOT NULL AND nb.anchor IS NOT NULL AND NOT EXISTS(SELECT fullkey,type,atom FROM json_tree(ob.anchor) EXCEPT SELECT fullkey,type,atom FROM json_tree(nb.anchor)) AND NOT EXISTS(SELECT fullkey,type,atom FROM json_tree(nb.anchor) EXCEPT SELECT fullkey,type,atom FROM json_tree(ob.anchor))))))))))))
BEGIN SELECT RAISE(ABORT,'proposal receipt requires its exact retained result and target'); END;
--> statement-breakpoint
DROP TRIGGER page_transform_intent_immutable;
--> statement-breakpoint
CREATE TRIGGER page_transform_intent_immutable BEFORE UPDATE ON page_transform_requests
WHEN (NEW.id IS NOT OLD.id OR NEW.context_request_id IS NOT OLD.context_request_id OR NEW.request IS NOT OLD.request OR NEW.intent_hash IS NOT OLD.intent_hash OR NEW.instruction IS NOT OLD.instruction OR NEW.created_at IS NOT OLD.created_at OR (NEW."note_id" IS NOT OLD."note_id" AND NEW."note_id" IS NOT NULL) OR (OLD.cancelled=1 AND NEW.cancelled!=1) OR (OLD.result_version_id IS NOT NULL AND (NEW.result_version_id IS NOT OLD.result_version_id OR NEW.report IS NOT OLD.report OR NEW.result_hash IS NOT OLD.result_hash OR NEW.event_id IS NOT OLD.event_id))) AND NOT (
 EXISTS(SELECT 1 FROM page_versions v JOIN page_deletions d ON d.page_id=v.page_id
   WHERE v.id=OLD.result_version_id OR
     CAST(v.id AS TEXT)=json_extract(OLD.request,'$.improvement.versionId'))
 AND NEW.id IS OLD.id AND NEW.context_request_id IS OLD.context_request_id
 AND NEW.intent_hash IS OLD.intent_hash AND NEW.created_at IS OLD.created_at
 AND (NEW.note_id IS OLD.note_id OR NEW.note_id IS NULL)
 AND NEW.cancelled IS CASE WHEN json_type(OLD.request,'$.improvement')='object' THEN 1 ELSE OLD.cancelled END AND NEW.error_kind IS OLD.error_kind
 AND NEW.result_version_id IS OLD.result_version_id AND NEW.result_hash IS OLD.result_hash
 AND NEW.event_id IS OLD.event_id AND NEW.instruction='' AND NEW.report IS NULL
 AND NEW.request IS (CASE WHEN json_type(OLD.request,'$.merge')='object'
      THEN json_set(OLD.request,'$.title','-','$.merge.title','-','$.merge.instruction','')
      WHEN json_type(OLD.request,'$.improvement')='object'
      THEN json_set(OLD.request,'$.title','-','$.improvement.instruction','')
      ELSE json_set(OLD.request,'$.title','-') END)
) BEGIN SELECT RAISE(ABORT,'document transform intent and publication are immutable'); END;
--> statement-breakpoint
DROP TRIGGER page_transform_result_hash;
--> statement-breakpoint
CREATE TRIGGER page_transform_result_hash BEFORE UPDATE OF result_version_id ON page_transform_requests
WHEN OLD.result_version_id IS NULL AND NEW.result_version_id IS NOT NULL AND (
 NEW.result_hash IS NULL OR length(NEW.result_hash)!=64 OR NEW.result_hash GLOB '*[^0-9a-f]*'
 OR NEW.cancelled=1
 OR (NEW.note_id IS NULL AND json_type(NEW.request,'$.merge') IS NOT 'object'
   AND json_type(NEW.request,'$.improvement') IS NOT 'object')
 OR EXISTS(SELECT 1 FROM note_deletions WHERE note_id=NEW.note_id)
)
BEGIN SELECT RAISE(ABORT,'authored transform cannot complete outside its retained authority'); END;
