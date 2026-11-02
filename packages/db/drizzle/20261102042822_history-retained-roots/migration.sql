DROP TRIGGER material_history_members_valid;
--> statement-breakpoint
CREATE TRIGGER material_history_members_valid BEFORE INSERT ON material_history_members
WHEN NOT EXISTS(SELECT 1 FROM material_history_prunes p JOIN material_versions v ON v.material_id=p.material_id, json_each(p.selection) j
WHERE p.operation_id=NEW.operation_id AND p.status='pending' AND v.id=NEW.version_id AND CAST(v.id AS TEXT)=j.value AND v.status='published'
AND (SELECT count(*) FROM material_versions newer WHERE newer.material_id=v.material_id AND newer.status='published' AND newer.number>v.number AND NOT EXISTS(SELECT 1 FROM material_history_members retired WHERE retired.version_id=newer.id))>=p.keep_latest
AND NOT EXISTS(SELECT 1 FROM document_proposals d WHERE (v.id IN(d.base_version_id,d.proposed_version_id) OR EXISTS(SELECT 1 FROM material_generation_inputs i WHERE i.request_id=d.request_id AND i.version_id=v.id)) AND NOT EXISTS(SELECT 1 FROM document_proposal_receipts r WHERE r.request_id=d.request_id AND r.result_version_id IS NOT NULL))
AND NOT EXISTS(SELECT 1 FROM material_source_snapshots s LEFT JOIN source_processing sp ON sp.source_id=s.source_id WHERE s.version_id=v.id AND (v.operation='original' OR (s.document_id IS NOT NULL AND sp.document_id=s.document_id))))
BEGIN SELECT RAISE(ABORT,'history cannot prune protected roots'); END;

