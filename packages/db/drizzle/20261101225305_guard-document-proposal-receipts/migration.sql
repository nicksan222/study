-- Completed receipts remain immutable. New target results must already be retained
-- as exact captured draft proposals; independent and collection results stay published.
DROP TRIGGER material_generation_receipt_valid;
--> statement-breakpoint
CREATE TRIGGER material_generation_receipt_valid BEFORE UPDATE OF result_version_id,result_hash ON material_generation_requests
WHEN OLD.result_version_id IS NULL AND NEW.result_version_id IS NOT NULL AND (length(NEW.result_hash)!=64 OR NEW.result_hash GLOB '*[^0-9a-f]*' OR NOT EXISTS(
 SELECT 1 FROM material_versions v JOIN materials m ON m.id=v.material_id WHERE v.id=NEW.result_version_id AND (json_extract(NEW.payload,'$.kind')='document' OR EXISTS(SELECT 1 FROM project_materials pm WHERE pm.material_id=v.material_id AND pm.project_id=NEW.project_id)) AND v.generation_request_id=NEW.id AND (
   (v.status='published' AND json_extract(NEW.payload,'$.documentTransform.editTargetVersionId') IS NULL)
   OR (v.status='draft' AND NEW.cancelled=0 AND NEW.project_id IS NULL
    AND json_extract(NEW.payload,'$.kind')='document'
    AND json_extract(NEW.payload,'$.scopeId') IS NULL
    AND EXISTS (
     SELECT 1 FROM document_proposals p
     JOIN material_versions base ON base.id=p.base_version_id AND base.material_id=v.material_id
     JOIN material_document_versions proposed_doc ON proposed_doc.version_id=v.id
     JOIN material_document_versions base_doc ON base_doc.version_id=base.id
     JOIN session_run_contexts c ON c.request_id=json_extract(NEW.payload,'$.documentTransform.contextRequestId') AND c.session_id=p.session_id
     JOIN sessions se ON se.id=c.session_id
     WHERE p.request_id=NEW.id AND p.proposed_version_id=v.id
      AND NEW.id='document/' || c.request_id
      AND json_extract(c.snapshot,'$.requestId')=c.request_id
      AND json_extract(c.snapshot,'$.sessionId')=CAST(c.session_id AS TEXT)
      AND CAST(base.id AS TEXT)=json_extract(NEW.payload,'$.documentTransform.editTargetVersionId')
      AND base.kind='document' AND base.status='published' AND base.creator!='import'
      AND proposed_doc.document_id!=base_doc.document_id
      AND EXISTS(SELECT 1 FROM blocks WHERE document_id=proposed_doc.document_id)
      AND (SELECT COUNT(*) FROM material_version_parents WHERE version_id=v.id)=1
      AND EXISTS(SELECT 1 FROM material_version_parents WHERE version_id=v.id AND parent_version_id=base.id AND material_id=base.material_id)
      AND json_array_length(c.snapshot,'$.inputs')=json_array_length(NEW.payload,'$.inputVersionIds')
      AND NOT EXISTS(SELECT 1 FROM json_each(c.snapshot,'$.inputs') i WHERE
       json_extract(NEW.payload,'$.inputVersionIds[' || i.key || ']') IS NOT json_extract(i.value,'$.versionId'))
      AND EXISTS(SELECT 1 FROM json_each(c.snapshot,'$.inputs') i WHERE
       json_extract(i.value,'$.versionId')=CAST(base.id AS TEXT)
       AND json_extract(i.value,'$.materialId')=CAST(base.material_id AS TEXT)
       AND json_extract(i.value,'$.documentId')=CAST(base_doc.document_id AS TEXT)
       AND json_extract(i.value,'$.scope.kind')='document')
    )
   )
  ) AND v.creator='agent' AND v.operation='generate' AND v.kind=json_extract(NEW.payload,'$.kind') AND v.instruction IS json_extract(NEW.payload,'$.instruction')
 AND (SELECT COUNT(*) FROM material_generation_inputs WHERE request_id=NEW.id)=json_array_length(NEW.payload,'$.inputVersionIds')
 AND NOT EXISTS(SELECT 1 FROM material_generation_inputs i JOIN material_versions iv ON iv.id=i.version_id WHERE i.request_id=NEW.id AND json_extract(NEW.payload,'$.kind')!='document' AND NOT EXISTS(SELECT 1 FROM project_materials pm WHERE pm.material_id=iv.material_id AND pm.project_id=NEW.project_id))
 AND NOT EXISTS(SELECT version_id FROM material_generation_inputs WHERE request_id=NEW.id EXCEPT SELECT input_version_id FROM material_version_inputs WHERE version_id=v.id)
 AND NOT EXISTS(SELECT input_version_id FROM material_version_inputs WHERE version_id=v.id EXCEPT SELECT version_id FROM material_generation_inputs WHERE request_id=NEW.id)
))
BEGIN SELECT RAISE(ABORT, 'generation receipt does not identify its retained output'); END;
