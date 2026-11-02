CREATE TRIGGER conversation_history_intents_update BEFORE UPDATE ON conversation_history_intents BEGIN SELECT RAISE(ABORT,'retired capture intent is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER conversation_history_intents_delete BEFORE DELETE ON conversation_history_intents BEGIN SELECT RAISE(ABORT,'retired capture intent is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER conversation_history_intents_valid BEFORE INSERT ON conversation_history_intents
WHEN NOT EXISTS(SELECT 1 FROM session_run_contexts c JOIN material_history_requests r ON r.request_id=c.request_id WHERE c.request_id=NEW.request_id AND c.session_id=NEW.session_id AND c.intent_key=NEW.intent_key AND r.kind='context')
BEGIN SELECT RAISE(ABORT,'retired intent requires exact captured context'); END;
--> statement-breakpoint
CREATE TRIGGER session_history_intent_insert BEFORE INSERT ON session_run_contexts
WHEN EXISTS(SELECT 1 FROM conversation_history_intents WHERE session_id=NEW.session_id AND intent_key=NEW.intent_key)
BEGIN SELECT RAISE(ABORT,'pruned run intent cannot capture newer content'); END;
--> statement-breakpoint
CREATE TRIGGER generation_history_publication BEFORE UPDATE ON material_generation_requests
WHEN EXISTS(SELECT 1 FROM material_history_requests WHERE request_id=OLD.id) AND NOT (
(NEW.cancelled=1 AND NEW.payload='{}' AND NEW.result_metadata IS NULL AND NEW.result_version_id IS NULL AND NEW.result_hash IS NULL) OR (NEW.result_version_id IS NULL AND NEW.result_hash IS NULL AND NEW.payload IS OLD.payload AND NEW.result_metadata IS OLD.result_metadata AND NEW.cancelled IS OLD.cancelled))
BEGIN SELECT RAISE(ABORT,'retired generation cannot publish'); END;
--> statement-breakpoint
CREATE TRIGGER material_version_inputs_history_capture BEFORE INSERT ON material_version_inputs WHEN EXISTS(SELECT 1 FROM material_history_members WHERE version_id=NEW.input_version_id)
AND NOT EXISTS(SELECT 1 FROM material_versions revision
 JOIN material_version_parents p ON p.version_id=revision.id
 JOIN material_versions parent ON parent.id=p.parent_version_id AND parent.material_id=revision.material_id
 JOIN material_version_inputs inherited ON inherited.version_id=parent.id AND inherited.input_version_id=NEW.input_version_id
 WHERE revision.id=NEW.version_id AND revision.kind='document' AND revision.creator='user' AND revision.operation='edit'
 AND revision.generation_request_id IS NULL AND parent.status='published'
 AND NOT EXISTS(SELECT 1 FROM material_deletion_members d WHERE d.material_id=parent.material_id)
 AND NOT EXISTS(SELECT 1 FROM material_history_members h WHERE h.version_id=parent.id)) BEGIN SELECT RAISE(ABORT,'pruned version cannot be linked as new input'); END;
--> statement-breakpoint
CREATE TRIGGER material_version_parents_history_capture BEFORE INSERT ON material_version_parents WHEN EXISTS(SELECT 1 FROM material_history_members WHERE version_id=NEW.parent_version_id) BEGIN SELECT RAISE(ABORT,'pruned version cannot be linked as new input'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_attempts_history_insert BEFORE INSERT ON material_quiz_attempts WHEN EXISTS(SELECT 1 FROM material_history_members WHERE version_id=NEW.version_id) BEGIN SELECT RAISE(ABORT,'pruned practice content is unavailable'); END;
--> statement-breakpoint
CREATE TRIGGER material_card_reviews_history_insert BEFORE INSERT ON material_card_reviews WHEN EXISTS(SELECT 1 FROM material_history_members WHERE version_id=NEW.version_id) BEGIN SELECT RAISE(ABORT,'pruned practice content is unavailable'); END;
--> statement-breakpoint
CREATE TRIGGER sessions_history_selection BEFORE UPDATE OF selection ON sessions WHEN EXISTS(SELECT 1 FROM json_each(NEW.selection) j JOIN material_history_members m ON CAST(m.version_id AS TEXT)=json_extract(j.value,'$.versionId')) BEGIN SELECT RAISE(ABORT,'pruned version cannot be selected'); END;
--> statement-breakpoint
DROP TRIGGER material_attempt_delete;
--> statement-breakpoint
CREATE TRIGGER material_attempt_delete BEFORE DELETE ON material_quiz_attempts
WHEN ((old.status='completed' AND EXISTS(SELECT 1 FROM material_versions v WHERE v.id=old.version_id AND v.status='published')) AND NOT (EXISTS(SELECT 1 FROM material_deletion_members dm JOIN material_deletions d ON d.material_id=dm.deletion_id WHERE dm.material_id=(SELECT material_id FROM material_versions WHERE id=OLD.version_id) AND d.status IN ('pending','failed')))) AND NOT (EXISTS(SELECT 1 FROM material_history_members m JOIN material_history_prunes p ON p.operation_id=m.operation_id WHERE m.version_id=OLD.version_id AND p.status IN ('pending','failed')))
BEGIN SELECT RAISE(ABORT, 'completed attempts cannot be deleted'); END;
--> statement-breakpoint
DROP TRIGGER material_review_delete;
--> statement-breakpoint
CREATE TRIGGER material_review_delete BEFORE DELETE ON material_card_reviews
WHEN ((EXISTS(SELECT 1 FROM material_versions v WHERE v.id=old.version_id AND v.status='published')) AND NOT (EXISTS(SELECT 1 FROM material_deletion_members dm JOIN material_deletions d ON d.material_id=dm.deletion_id WHERE dm.material_id=(SELECT material_id FROM material_versions WHERE id=OLD.version_id) AND d.status IN ('pending','failed')))) AND NOT (EXISTS(SELECT 1 FROM material_history_members m JOIN material_history_prunes p ON p.operation_id=m.operation_id WHERE m.version_id=OLD.version_id AND p.status IN ('pending','failed')))
BEGIN SELECT RAISE(ABORT, 'card reviews are append only'); END;
--> statement-breakpoint
DROP TRIGGER material_quiz_responses_completed_delete;
--> statement-breakpoint
CREATE TRIGGER material_quiz_responses_completed_delete BEFORE DELETE ON material_quiz_responses
WHEN ((EXISTS(SELECT 1 FROM material_quiz_attempts a JOIN material_versions v ON v.id=a.version_id WHERE a.id=old.attempt_id AND a.status='completed')) AND NOT (EXISTS(SELECT 1 FROM material_deletion_members dm JOIN material_deletions d ON d.material_id=dm.deletion_id WHERE dm.material_id=(SELECT material_id FROM material_versions WHERE id=OLD.version_id) AND d.status IN ('pending','failed')))) AND NOT (EXISTS(SELECT 1 FROM material_history_members m JOIN material_history_prunes p ON p.operation_id=m.operation_id WHERE m.version_id=OLD.version_id AND p.status IN ('pending','failed')))
BEGIN SELECT RAISE(ABORT, 'completed quiz answers are immutable'); END;
--> statement-breakpoint
DROP TRIGGER material_quiz_selections_completed_delete;
--> statement-breakpoint
CREATE TRIGGER material_quiz_selections_completed_delete BEFORE DELETE ON material_quiz_selections
WHEN ((EXISTS(SELECT 1 FROM material_quiz_attempts a JOIN material_versions v ON v.id=a.version_id WHERE a.id=old.attempt_id AND a.status='completed')) AND NOT (EXISTS(SELECT 1 FROM material_deletion_members dm JOIN material_deletions d ON d.material_id=dm.deletion_id WHERE dm.material_id=(SELECT material_id FROM material_versions WHERE id=(SELECT version_id FROM material_quiz_attempts WHERE id=OLD.attempt_id)) AND d.status IN ('pending','failed')))) AND NOT (EXISTS(SELECT 1 FROM material_history_members m JOIN material_history_prunes p ON p.operation_id=m.operation_id WHERE m.version_id=(SELECT version_id FROM material_quiz_attempts WHERE id=OLD.attempt_id) AND p.status IN ('pending','failed')))
BEGIN SELECT RAISE(ABORT, 'completed quiz answers are immutable'); END;
--> statement-breakpoint
DROP TRIGGER learning_practice_selection_delete;
--> statement-breakpoint
CREATE TRIGGER learning_practice_selection_delete
BEFORE DELETE ON material_quiz_selections
WHEN ((EXISTS (
  SELECT 1 FROM learning_practice_slots p JOIN projects owner ON owner.id = p.project_id
  WHERE p.attempt_id = OLD.attempt_id AND p.status = 'answered'
)) AND NOT (EXISTS(SELECT 1 FROM material_deletion_members dm JOIN material_deletions d ON d.material_id=dm.deletion_id WHERE dm.material_id=(SELECT material_id FROM material_versions WHERE id=(SELECT version_id FROM material_quiz_attempts WHERE id=OLD.attempt_id)) AND d.status IN ('pending','failed')))) AND NOT (EXISTS(SELECT 1 FROM material_history_members m JOIN material_history_prunes p ON p.operation_id=m.operation_id WHERE m.version_id=(SELECT version_id FROM material_quiz_attempts WHERE id=OLD.attempt_id) AND p.status IN ('pending','failed')))
BEGIN SELECT RAISE(ABORT, 'committed practice answers are immutable'); END;

--> statement-breakpoint
-- A retained inheritance proof must itself remain available after pruning.
DROP TRIGGER material_deletion_publication;
--> statement-breakpoint
CREATE TRIGGER material_deletion_publication BEFORE UPDATE OF status ON material_versions
WHEN NEW.status='published' AND OLD.status!='published' AND (
 EXISTS(SELECT 1 FROM material_deletion_members WHERE material_id=NEW.material_id)
 OR EXISTS(SELECT 1 FROM material_version_inputs i JOIN material_versions v ON v.id=i.input_version_id JOIN material_deletion_members d ON d.material_id=v.material_id WHERE i.version_id=NEW.id AND NOT EXISTS(SELECT 1 FROM material_versions revision
 JOIN material_version_parents p ON p.version_id=revision.id
 JOIN material_versions parent ON parent.id=p.parent_version_id AND parent.material_id=revision.material_id
 JOIN material_version_inputs inherited ON inherited.version_id=parent.id AND inherited.input_version_id=i.input_version_id
 WHERE revision.id=NEW.id AND revision.kind='document' AND revision.creator='user' AND revision.operation='edit'
 AND revision.generation_request_id IS NULL AND parent.status='published'
 AND NOT EXISTS(SELECT 1 FROM material_deletion_members d WHERE d.material_id=parent.material_id)
 AND NOT EXISTS(SELECT 1 FROM material_history_members h WHERE h.version_id=parent.id)))
 OR EXISTS(SELECT 1 FROM material_deletion_requests WHERE request_id=NEW.generation_request_id))
BEGIN SELECT RAISE(ABORT,'deleted Material cannot publish'); END;
--> statement-breakpoint
DROP TRIGGER material_deletion_input_insert;
--> statement-breakpoint
CREATE TRIGGER material_deletion_input_insert BEFORE INSERT ON material_version_inputs
WHEN EXISTS(SELECT 1 FROM material_versions v JOIN material_deletion_members d ON d.material_id=v.material_id WHERE v.id=NEW.version_id)
 OR (EXISTS(SELECT 1 FROM material_versions v JOIN material_deletion_members d ON d.material_id=v.material_id WHERE v.id=NEW.input_version_id)
 AND NOT EXISTS(SELECT 1 FROM material_versions revision
 JOIN material_version_parents p ON p.version_id=revision.id
 JOIN material_versions parent ON parent.id=p.parent_version_id AND parent.material_id=revision.material_id
 JOIN material_version_inputs inherited ON inherited.version_id=parent.id AND inherited.input_version_id=NEW.input_version_id
 WHERE revision.id=NEW.version_id AND revision.kind='document' AND revision.creator='user' AND revision.operation='edit'
 AND revision.generation_request_id IS NULL AND parent.status='published'
 AND NOT EXISTS(SELECT 1 FROM material_deletion_members d WHERE d.material_id=parent.material_id)
 AND NOT EXISTS(SELECT 1 FROM material_history_members h WHERE h.version_id=parent.id)))
BEGIN SELECT RAISE(ABORT,'deleted Material cannot be used'); END;
--> statement-breakpoint
DROP TRIGGER document_asset_deleted_acquisition;
--> statement-breakpoint
CREATE TRIGGER document_asset_deleted_acquisition BEFORE INSERT ON document_assets
WHEN (EXISTS(SELECT 1 FROM source_material_deletion_assets retired WHERE retired.source_id=NEW.source_id AND retired.revision=NEW.revision) OR EXISTS(SELECT 1 FROM source_history_revisions retired WHERE retired.source_id=NEW.source_id AND retired.revision=NEW.revision)) AND NOT EXISTS(SELECT 1 FROM material_versions owner JOIN (
 SELECT dv.version_id,a.source_id,a.revision FROM material_document_versions dv JOIN document_assets a ON a.document_id=dv.document_id
 UNION ALL SELECT version_id,source_id,revision FROM material_source_snapshots
 ) asset ON asset.version_id=owner.id
 WHERE asset.source_id=NEW.source_id AND asset.revision=NEW.revision AND owner.status='published'
 AND NOT EXISTS(SELECT 1 FROM material_deletion_members d WHERE d.material_id=owner.material_id)
 AND NOT EXISTS(SELECT 1 FROM material_history_members h WHERE h.version_id=owner.id)
 )
BEGIN SELECT RAISE(ABORT,'deleted image requires a retained published owner'); END;
--> statement-breakpoint
DROP TRIGGER material_document_deleted_assets_insert;
--> statement-breakpoint
CREATE TRIGGER material_document_deleted_assets_insert BEFORE INSERT ON material_document_versions
WHEN EXISTS(SELECT 1 FROM document_assets a WHERE a.document_id=NEW.document_id AND (EXISTS(SELECT 1 FROM source_material_deletion_assets retired WHERE retired.source_id=a.source_id AND retired.revision=a.revision) OR EXISTS(SELECT 1 FROM source_history_revisions retired WHERE retired.source_id=a.source_id AND retired.revision=a.revision)) AND NOT EXISTS(SELECT 1 FROM material_versions owner JOIN (
 SELECT dv.version_id,a.source_id,a.revision FROM material_document_versions dv JOIN document_assets a ON a.document_id=dv.document_id
 UNION ALL SELECT version_id,source_id,revision FROM material_source_snapshots
 ) asset ON asset.version_id=owner.id
 WHERE asset.source_id=a.source_id AND asset.revision=a.revision AND owner.status='published'
 AND NOT EXISTS(SELECT 1 FROM material_deletion_members d WHERE d.material_id=owner.material_id)
 AND NOT EXISTS(SELECT 1 FROM material_history_members h WHERE h.version_id=owner.id)
 AND (owner.material_id=(SELECT material_id FROM material_versions WHERE id=NEW.version_id) OR EXISTS(
 SELECT 1 FROM material_version_inputs i WHERE i.version_id=NEW.version_id AND i.input_version_id=owner.id))))
BEGIN SELECT RAISE(ABORT,'deleted image requires explicit retained ownership'); END;
--> statement-breakpoint
DROP TRIGGER material_document_deleted_assets_update;
--> statement-breakpoint
CREATE TRIGGER material_document_deleted_assets_update BEFORE UPDATE ON material_document_versions
WHEN EXISTS(SELECT 1 FROM document_assets a WHERE a.document_id=NEW.document_id AND (EXISTS(SELECT 1 FROM source_material_deletion_assets retired WHERE retired.source_id=a.source_id AND retired.revision=a.revision) OR EXISTS(SELECT 1 FROM source_history_revisions retired WHERE retired.source_id=a.source_id AND retired.revision=a.revision)) AND NOT EXISTS(SELECT 1 FROM material_versions owner JOIN (
 SELECT dv.version_id,a.source_id,a.revision FROM material_document_versions dv JOIN document_assets a ON a.document_id=dv.document_id
 UNION ALL SELECT version_id,source_id,revision FROM material_source_snapshots
 ) asset ON asset.version_id=owner.id
 WHERE asset.source_id=a.source_id AND asset.revision=a.revision AND owner.status='published'
 AND NOT EXISTS(SELECT 1 FROM material_deletion_members d WHERE d.material_id=owner.material_id)
 AND NOT EXISTS(SELECT 1 FROM material_history_members h WHERE h.version_id=owner.id)
 AND (owner.material_id=(SELECT material_id FROM material_versions WHERE id=NEW.version_id) OR EXISTS(
 SELECT 1 FROM material_version_inputs i WHERE i.version_id=NEW.version_id AND i.input_version_id=owner.id))))
BEGIN SELECT RAISE(ABORT,'deleted image requires explicit retained ownership'); END;
--> statement-breakpoint
DROP TRIGGER material_document_deleted_assets_publish;
--> statement-breakpoint
CREATE TRIGGER material_document_deleted_assets_publish BEFORE UPDATE OF status ON material_versions
WHEN NEW.status='published' AND OLD.status!='published' AND EXISTS(
 SELECT 1 FROM material_document_versions dv JOIN document_assets a ON a.document_id=dv.document_id
 WHERE dv.version_id=NEW.id AND (EXISTS(SELECT 1 FROM source_material_deletion_assets retired WHERE retired.source_id=a.source_id AND retired.revision=a.revision) OR EXISTS(SELECT 1 FROM source_history_revisions retired WHERE retired.source_id=a.source_id AND retired.revision=a.revision)) AND NOT EXISTS(SELECT 1 FROM material_versions owner JOIN (
 SELECT dv.version_id,a.source_id,a.revision FROM material_document_versions dv JOIN document_assets a ON a.document_id=dv.document_id
 UNION ALL SELECT version_id,source_id,revision FROM material_source_snapshots
 ) asset ON asset.version_id=owner.id
 WHERE asset.source_id=a.source_id AND asset.revision=a.revision AND owner.status='published'
 AND NOT EXISTS(SELECT 1 FROM material_deletion_members d WHERE d.material_id=owner.material_id)
 AND NOT EXISTS(SELECT 1 FROM material_history_members h WHERE h.version_id=owner.id)
 AND (owner.material_id=(SELECT material_id FROM material_versions WHERE id=NEW.id) OR EXISTS(
 SELECT 1 FROM material_version_inputs i WHERE i.version_id=NEW.id AND i.input_version_id=owner.id))))
BEGIN SELECT RAISE(ABORT,'deleted image cannot acquire a new publication owner'); END;
