DROP TRIGGER study_document_annotation_revisions_update;
--> statement-breakpoint
UPDATE study_document_annotation_revisions SET payload=json_remove(json_set(payload,
 '$.id',CAST(annotation_id AS TEXT),'$.target.documentId',CAST(document_id AS TEXT),
 '$.target.range.versionId',CAST(version_id AS TEXT),'$.target.range.snapshotId',CAST(snapshot_id AS TEXT)),
 '$.target.materialId','$.target.range.documentId') WHERE json_type(payload,'$.target.materialId') IS NOT NULL;
--> statement-breakpoint
INSERT INTO study_document_citation_assessments(version_id,marker,payload)
SELECT x.document_version_id,a.marker,json_object(
 'claim',json_object('documentId',CAST(x.document_id AS TEXT),'range',json_object('versionId',CAST(x.document_version_id AS TEXT),'snapshotId',CAST(x.new_snapshot_id AS TEXT),'blockId',json_extract(a.payload,'$.claim.range.blockId'),'start',json_extract(a.payload,'$.claim.range.start'),'end',json_extract(a.payload,'$.claim.range.end'))),
 'evidence',json(CASE WHEN i.document_version_id IS NOT NULL THEN json_object('kind','document','versionId',CAST(i.document_version_id AS TEXT)) WHEN i.source_id IS NOT NULL THEN json_object('kind','source','sourceId',CAST(i.source_id AS TEXT),'revision',CAST(i.source_revision AS TEXT),'snapshotId',CAST(i.source_snapshot_id AS TEXT)) ELSE json_object('kind','legacy_material','versionId',CAST(i.legacy_material_version_id AS TEXT)) END),
 'evidenceRange',json_object('blockId',json_extract(a.payload,'$.evidence.range.blockId'),'start',json_extract(a.payload,'$.evidence.range.start'),'end',json_extract(a.payload,'$.evidence.range.end')),
 'marker',a.marker,'judgment',json_extract(a.payload,'$.judgment'),'note',json_extract(a.payload,'$.note'),'suppliedBy','user','independentVerification',json('false'),
 'citation',json_object('marker',a.marker,'input',json(CASE WHEN i.document_version_id IS NOT NULL THEN json_object('kind','document','versionId',CAST(i.document_version_id AS TEXT)) WHEN i.source_id IS NOT NULL THEN json_object('kind','source','sourceId',CAST(i.source_id AS TEXT),'revision',CAST(i.source_revision AS TEXT),'snapshotId',CAST(i.source_snapshot_id AS TEXT)) ELSE json_object('kind','legacy_material','versionId',CAST(i.legacy_material_version_id AS TEXT)) END),'anchor',json(c.anchor),'quote',c.quote,'target',json(json_remove(c.target,'$.versionId','$.documentId'))))
FROM material_citation_assessments a JOIN legacy_document_versions x ON x.material_version_id=a.claim_version_id JOIN study_document_citations c ON c.version_id=x.document_version_id AND c.marker=a.marker JOIN study_document_inputs i ON i.id=c.input_id;
--> statement-breakpoint
DROP TRIGGER study_document_citations_update;
--> statement-breakpoint
UPDATE study_document_citations SET target=json_remove(target,'$.versionId','$.documentId') WHERE target IS NOT NULL;
--> statement-breakpoint
CREATE TRIGGER study_document_citations_update BEFORE UPDATE ON study_document_citations WHEN EXISTS(SELECT 1 FROM study_document_versions WHERE id IN(OLD.version_id,NEW.version_id) AND status='published') BEGIN SELECT RAISE(ABORT,'published document evidence is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_annotation_revisions_update BEFORE UPDATE ON study_document_annotation_revisions BEGIN SELECT RAISE(ABORT,'annotation revisions are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_annotation_head BEFORE UPDATE ON study_document_annotations
WHEN NEW.id!=OLD.id OR NEW.document_id!=OLD.document_id OR NEW.revision!=OLD.revision+1 OR NOT EXISTS(SELECT 1 FROM study_document_annotation_revisions WHERE annotation_id=NEW.id AND revision=NEW.revision)
BEGIN SELECT RAISE(ABORT,'annotation head requires exact next revision'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_annotation_revision_owner BEFORE INSERT ON study_document_annotation_revisions
WHEN NOT EXISTS(SELECT 1 FROM study_document_annotations a JOIN study_document_versions v ON v.id=NEW.version_id AND v.document_id=a.document_id WHERE a.id=NEW.annotation_id AND a.document_id=NEW.document_id AND v.status='published' AND (NEW.revision=a.revision+1 OR (NEW.revision=1 AND a.revision=1))
AND CAST(json_extract(NEW.payload,'$.id') AS INTEGER)=NEW.annotation_id AND CAST(json_extract(NEW.payload,'$.revision') AS INTEGER)=NEW.revision AND CAST(json_extract(NEW.payload,'$.target.documentId') AS INTEGER)=NEW.document_id AND CAST(json_extract(NEW.payload,'$.target.range.versionId') AS INTEGER)=NEW.version_id AND CAST(json_extract(NEW.payload,'$.target.range.snapshotId') AS INTEGER)=NEW.snapshot_id)
BEGIN SELECT RAISE(ABORT,'annotation revision requires exact published ownership'); END;
--> statement-breakpoint
DROP TRIGGER study_document_input_message;
--> statement-breakpoint
CREATE TRIGGER study_document_input_message BEFORE INSERT ON study_document_inputs
WHEN NEW.exact_message_version_id IS NOT NULL AND NOT (
 (NEW.message_version_id=NEW.exact_message_version_id AND EXISTS(SELECT 1 FROM message_versions WHERE id=NEW.message_version_id AND status='complete')) OR
 (NEW.message_version_id IS NULL AND EXISTS(SELECT 1 FROM study_document_inputs i JOIN study_document_versions old ON old.id=i.version_id JOIN study_document_versions child ON child.id=NEW.version_id AND child.document_id=old.document_id WHERE i.exact_message_version_id=NEW.exact_message_version_id AND old.status='published')))
BEGIN SELECT RAISE(ABORT,'message input requires exact complete or inherited message version'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_generation_intent BEFORE UPDATE ON study_document_generation_requests
WHEN NEW.id IS NOT OLD.id OR NEW.document_id IS NOT OLD.document_id OR NEW.expected_version_id IS NOT OLD.expected_version_id OR NEW.intent_hash IS NOT OLD.intent_hash OR NEW.created_at IS NOT OLD.created_at OR (NEW.session_id IS NOT OLD.session_id AND NEW.session_id IS NOT NULL) OR (OLD.result_version_id IS NOT NULL AND NEW.result_version_id IS NOT OLD.result_version_id)
BEGIN SELECT RAISE(ABORT,'generation publication intent and result are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_proposals_immutable_update BEFORE UPDATE ON study_document_proposals BEGIN SELECT RAISE(ABORT,'document evidence is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_proposal_receipts_immutable_update BEFORE UPDATE ON study_document_proposal_receipts BEGIN SELECT RAISE(ABORT,'document evidence is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_citation_assessments_immutable_update BEFORE UPDATE ON study_document_citation_assessments BEGIN SELECT RAISE(ABORT,'document evidence is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_retirement_dependencies BEFORE INSERT ON study_document_retirements
WHEN EXISTS(SELECT 1 FROM study_document_inputs i JOIN study_document_versions v ON v.id=i.version_id JOIN study_document_versions target ON target.id=NEW.version_id WHERE i.document_version_id=NEW.version_id AND v.document_id!=target.document_id AND NOT EXISTS(SELECT 1 FROM study_document_retirements r WHERE r.version_id=v.id))
 OR EXISTS(SELECT 1 FROM study_document_inputs WHERE document_version_id=NEW.version_id AND request_id IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'exact authored inputs protect referenced bodies'); END;
--> statement-breakpoint
DROP TRIGGER document_asset_insert;
--> statement-breakpoint
CREATE TRIGGER document_asset_insert AFTER INSERT ON blocks WHEN new.kind='image'
BEGIN
INSERT INTO document_assets(document_id,block_id,source_id,revision)
SELECT new.document_id,new.editing_id,CAST(json_extract(new.content,'$.sourceId') AS INTEGER),json_extract(new.content,'$.revision');
END;
