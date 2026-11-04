CREATE TABLE `study_document_transform_requests` (
	`id` text PRIMARY KEY,
	`context_request_id` text NOT NULL,
	`session_id` integer,
	`request` text NOT NULL,
	`intent_hash` text NOT NULL,
	`instruction` text NOT NULL,
	`event_id` text NOT NULL,
	`cancelled` integer DEFAULT false NOT NULL,
	`error_kind` text,
	`result_version_id` integer,
	`report` text,
	`result_hash` text,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_study_document_transform_requests_session_id_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_study_document_transform_requests_result_version_id_study_document_versions_id_fk` FOREIGN KEY (`result_version_id`) REFERENCES `study_document_versions`(`id`),
	CONSTRAINT "study_document_transform_request_check" CHECK(json_valid("request")),
	CONSTRAINT "study_document_transform_report_check" CHECK("report" IS NULL OR json_valid("report"))
);
--> statement-breakpoint
CREATE TABLE `session_context_documents` (
	`request_id` text NOT NULL,
	`version_id` integer NOT NULL,
	CONSTRAINT `session_context_documents_pk` PRIMARY KEY(`request_id`, `version_id`),
	CONSTRAINT `fk_session_context_documents_request_id_session_run_contexts_request_id_fk` FOREIGN KEY (`request_id`) REFERENCES `session_run_contexts`(`request_id`) ON DELETE CASCADE,
	CONSTRAINT `fk_session_context_documents_version_id_study_document_versions_id_fk` FOREIGN KEY (`version_id`) REFERENCES `study_document_versions`(`id`)
);
--> statement-breakpoint
CREATE TABLE `session_context_sources` (
	`request_id` text NOT NULL,
	`source_id` integer NOT NULL,
	`revision` integer NOT NULL,
	`snapshot_id` integer NOT NULL,
	CONSTRAINT `session_context_sources_pk` PRIMARY KEY(`request_id`, `source_id`, `revision`, `snapshot_id`),
	CONSTRAINT `fk_session_context_sources_request_id_session_run_contexts_request_id_fk` FOREIGN KEY (`request_id`) REFERENCES `session_run_contexts`(`request_id`) ON DELETE CASCADE,
	CONSTRAINT `fk_session_context_sources_source_id_revision_snapshot_id_source_extraction_revisions_source_id_revision_snapshot_id_fk` FOREIGN KEY (`source_id`,`revision`,`snapshot_id`) REFERENCES `source_extraction_revisions`(`source_id`,`revision`,`snapshot_id`)
);
--> statement-breakpoint
ALTER TABLE `citations` ADD `authored_version_id` integer REFERENCES study_document_versions(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `citations` ADD `source_revision` integer;--> statement-breakpoint
CREATE INDEX `study_document_transform_sessions_idx` ON `study_document_transform_requests` (`session_id`,`id`);
--> statement-breakpoint
CREATE TEMP TABLE cutover_selection_references AS
SELECT CAST(x.material_version_id AS TEXT) old_id,
 json_object('kind','document','versionId',CAST(x.document_version_id AS TEXT)) input,
 CAST(x.new_snapshot_id AS TEXT) snapshot_id, CAST(x.document_id AS TEXT) document_id
FROM legacy_document_versions x WHERE x.document_version_id IS NOT NULL
UNION ALL
SELECT CAST(x.version_id AS TEXT),
 json_object('kind','source','sourceId',CAST(x.source_id AS TEXT),'revision',CAST(x.revision AS TEXT),'snapshotId',CAST(x.document_id AS TEXT)),
 CAST(x.document_id AS TEXT),NULL
FROM material_source_snapshots x JOIN source_extraction_revisions e ON e.source_id=x.source_id AND e.revision=x.revision AND e.snapshot_id=x.document_id;
--> statement-breakpoint
DROP TRIGGER session_run_contexts_immutable;
--> statement-breakpoint
UPDATE sessions SET selection=(SELECT coalesce(json_group_array(json(CASE WHEN json_extract(j.value,'$.input.kind') IS NOT NULL THEN j.value ELSE json_set(json_remove(j.value,'$.versionId','$.materialId','$.documentId'),'$.input',json(m.input),'$.scope',json(CASE WHEN json_extract(j.value,'$.scope.kind')='ranges' THEN json_set(json_extract(j.value,'$.scope'),'$.ranges',json((SELECT coalesce(json_group_array(json(json_remove(r.value,'$.versionId','$.documentId'))),'[]') FROM json_each(j.value,'$.scope.ranges') r))) ELSE json_extract(j.value,'$.scope') END)) END)),'[]') FROM json_each(sessions.selection) j LEFT JOIN cutover_selection_references m ON m.old_id=CAST(json_extract(j.value,'$.versionId') AS TEXT)) WHERE NOT EXISTS(SELECT 1 FROM json_each(sessions.selection) j LEFT JOIN cutover_selection_references m ON m.old_id=CAST(json_extract(j.value,'$.versionId') AS TEXT) WHERE json_extract(j.value,'$.input.kind') IS NULL AND m.old_id IS NULL);
--> statement-breakpoint
UPDATE session_run_contexts SET snapshot=json_set(snapshot,'$.inputs',json((SELECT coalesce(json_group_array(json(CASE WHEN json_extract(j.value,'$.input.kind') IS NOT NULL THEN j.value ELSE json_set(json_set(json_remove(j.value,'$.versionId','$.materialId','$.documentId'),'$.input',json(m.input),'$.scope',json(CASE WHEN json_extract(j.value,'$.scope.kind')='ranges' THEN json_set(json_extract(j.value,'$.scope'),'$.ranges',json((SELECT coalesce(json_group_array(json(json_remove(r.value,'$.versionId','$.documentId'))),'[]') FROM json_each(j.value,'$.scope.ranges') r))) ELSE json_extract(j.value,'$.scope') END)),'$.snapshotId',m.snapshot_id,'$.documentId',m.document_id) END)),'[]') FROM json_each(session_run_contexts.snapshot,'$.inputs') j LEFT JOIN cutover_selection_references m ON m.old_id=CAST(json_extract(j.value,'$.versionId') AS TEXT)))) WHERE NOT EXISTS(SELECT 1 FROM json_each(session_run_contexts.snapshot,'$.inputs') j LEFT JOIN cutover_selection_references m ON m.old_id=CAST(json_extract(j.value,'$.versionId') AS TEXT) WHERE json_extract(j.value,'$.input.kind') IS NULL AND m.old_id IS NULL);
--> statement-breakpoint
UPDATE conversation_reply_requests SET snapshot=json_set(snapshot,'$.context',json((SELECT c.snapshot FROM session_run_contexts c WHERE c.request_id=json_extract(conversation_reply_requests.snapshot,'$.context.requestId')))) WHERE json_extract(snapshot,'$.context.requestId') IS NOT NULL AND EXISTS(SELECT 1 FROM session_run_contexts c WHERE c.request_id=json_extract(conversation_reply_requests.snapshot,'$.context.requestId') AND NOT EXISTS(SELECT 1 FROM json_each(c.snapshot,'$.inputs') j WHERE json_extract(j.value,'$.input.kind') IS NULL));
--> statement-breakpoint
INSERT OR IGNORE INTO session_context_documents(request_id,version_id) SELECT c.request_id,CAST(json_extract(j.value,'$.input.versionId') AS INTEGER) FROM session_run_contexts c,json_each(c.snapshot,'$.inputs') j WHERE json_extract(j.value,'$.input.kind')='document';
--> statement-breakpoint
INSERT OR IGNORE INTO session_context_sources(request_id,source_id,revision,snapshot_id) SELECT c.request_id,CAST(json_extract(j.value,'$.input.sourceId') AS INTEGER),CAST(json_extract(j.value,'$.input.revision') AS INTEGER),CAST(json_extract(j.value,'$.input.snapshotId') AS INTEGER) FROM session_run_contexts c,json_each(c.snapshot,'$.inputs') j WHERE json_extract(j.value,'$.input.kind')='source';
--> statement-breakpoint
UPDATE citations SET authored_version_id=(SELECT x.document_version_id FROM legacy_document_versions x WHERE x.material_version_id=citations.material_version_id),document_id=coalesce((SELECT x.new_snapshot_id FROM legacy_document_versions x WHERE x.material_version_id=citations.material_version_id),document_id),source_revision=(SELECT x.revision FROM material_source_snapshots x WHERE x.version_id=citations.material_version_id) WHERE material_version_id IS NOT NULL;
--> statement-breakpoint
UPDATE citations SET source_revision=(SELECT e.revision FROM source_extraction_revisions e WHERE e.source_id=citations.source_id AND e.snapshot_id=citations.document_id ORDER BY e.revision LIMIT 1) WHERE source_id IS NOT NULL AND source_revision IS NULL;
--> statement-breakpoint
UPDATE material_generation_requests SET cancelled=1 WHERE json_extract(payload,'$.kind')='document' AND result_version_id IS NULL;
--> statement-breakpoint
UPDATE citations SET source_id=(SELECT x.source_id FROM material_source_snapshots x WHERE x.version_id=citations.material_version_id)
WHERE material_version_id IN(SELECT version_id FROM material_source_snapshots);
--> statement-breakpoint
INSERT INTO study_document_transform_requests(id,context_request_id,session_id,request,intent_hash,instruction,event_id,cancelled,error_kind,result_version_id,report,result_hash,created_at)
SELECT g.id,json_extract(g.payload,'$.documentTransform.contextRequestId'),c.session_id,
 json_patch(json_object('contextRequestId',json_extract(g.payload,'$.documentTransform.contextRequestId'),'title',json_extract(g.payload,'$.title'),'operations',json(json_extract(g.payload,'$.documentTransform.operations'))),
 CASE WHEN b.document_version_id IS NULL THEN '{}' ELSE json_object('editTargetVersionId',CAST(b.document_version_id AS TEXT)) END),
 coalesce(g.result_hash,'retained-request'),coalesce(json_extract(g.payload,'$.instruction'),json_extract(c.snapshot,'$.instruction'),''),g.id,
 CASE WHEN g.result_version_id IS NULL THEN 1 ELSE g.cancelled END,
 CASE WHEN g.result_version_id IS NULL THEN 'cancelled' END,r.document_version_id,g.result_metadata,g.result_hash,g.created_at
FROM material_generation_requests g
LEFT JOIN session_run_contexts c ON c.request_id=json_extract(g.payload,'$.documentTransform.contextRequestId')
LEFT JOIN legacy_document_versions b ON b.material_version_id=CAST(json_extract(g.payload,'$.documentTransform.editTargetVersionId') AS INTEGER)
LEFT JOIN legacy_document_versions r ON r.material_version_id=g.result_version_id
WHERE json_extract(g.payload,'$.kind')='document' AND (g.result_version_id IS NULL OR r.document_version_id IS NOT NULL);
--> statement-breakpoint
INSERT OR IGNORE INTO workflow_retired_correlations(correlation_id,event_type)
SELECT id,'MaterialGenerationRequested' FROM study_document_transform_requests;
--> statement-breakpoint
INSERT OR IGNORE INTO workflow_retired_executions(execution_id,correlation_id)
SELECT r.execution_id,e.correlation_id FROM workflow_receipts r JOIN workflow_events e ON e.event_id=r.event_id
WHERE e.correlation_id IN(SELECT id FROM study_document_transform_requests) AND r.subscription='material-generation';
--> statement-breakpoint
UPDATE workflow_events SET type='DocumentGenerationRequested',payload=json_set(json_remove(payload,'$.kind','$.projectId'),'$.type','DocumentGenerationRequested')
WHERE type='MaterialGenerationRequested' AND json_extract(payload,'$.kind')='document';
--> statement-breakpoint
UPDATE workflow_events SET type='DocumentGenerationFailed',payload=json_set(json_remove(payload,'$.kind','$.projectId'),'$.type','DocumentGenerationFailed')
WHERE type='MaterialGenerationFailed' AND json_extract(payload,'$.kind')='document';
--> statement-breakpoint
CREATE TRIGGER session_run_contexts_immutable BEFORE UPDATE ON session_run_contexts BEGIN SELECT RAISE(ABORT,'captured session context is immutable'); END;
--> statement-breakpoint
DROP TABLE cutover_selection_references;
--> statement-breakpoint
CREATE TRIGGER study_document_transform_intent_immutable BEFORE UPDATE ON study_document_transform_requests WHEN NEW.id IS NOT OLD.id OR NEW.context_request_id IS NOT OLD.context_request_id OR NEW.request IS NOT OLD.request OR NEW.intent_hash IS NOT OLD.intent_hash OR NEW.instruction IS NOT OLD.instruction OR NEW.created_at IS NOT OLD.created_at OR (NEW.session_id IS NOT OLD.session_id AND NEW.session_id IS NOT NULL) OR (OLD.cancelled=1 AND NEW.cancelled!=1) OR (OLD.result_version_id IS NOT NULL AND (NEW.result_version_id IS NOT OLD.result_version_id OR NEW.report IS NOT OLD.report OR NEW.result_hash IS NOT OLD.result_hash OR NEW.event_id IS NOT OLD.event_id)) BEGIN SELECT RAISE(ABORT,'document transform intent and publication are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_transform_publication_owner BEFORE UPDATE OF result_version_id ON study_document_transform_requests WHEN NEW.result_version_id IS NOT NULL AND (NEW.report IS NULL OR NEW.result_hash IS NULL OR NOT EXISTS(SELECT 1 FROM study_document_generation_requests p WHERE p.id=NEW.id AND p.result_version_id=NEW.result_version_id)) BEGIN SELECT RAISE(ABORT,'document transform requires its exact authored publication receipt'); END;
