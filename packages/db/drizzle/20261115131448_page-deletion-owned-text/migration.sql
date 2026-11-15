DROP TRIGGER page_versions_sealed_update;
--> statement-breakpoint
CREATE TRIGGER page_versions_sealed_update BEFORE UPDATE ON page_versions
WHEN OLD.status='published' AND NOT (
 EXISTS(SELECT 1 FROM page_deletions d WHERE d.page_id=OLD.page_id)
 AND EXISTS(SELECT 1 FROM page_retirements r WHERE r.version_id=OLD.id)
 AND NEW.id IS OLD.id AND NEW.page_id IS OLD.page_id AND NEW.number IS OLD.number
 AND NEW.status IS OLD.status AND NEW.operation IS OLD.operation AND NEW.creator IS OLD.creator
 AND NEW.content_snapshot_id IS OLD.content_snapshot_id AND NEW.created_at IS OLD.created_at
 AND NEW.published_at IS OLD.published_at AND NEW.instruction IS NULL AND NEW.language IS NULL
) BEGIN SELECT RAISE(ABORT,'published document versions are immutable'); END;
--> statement-breakpoint
DROP TRIGGER page_annotation_revisions_delete;
--> statement-breakpoint
CREATE TRIGGER page_annotation_revisions_delete BEFORE DELETE ON page_annotation_revisions
WHEN NOT EXISTS(SELECT 1 FROM page_deletions d WHERE d.page_id=OLD.page_id)
BEGIN SELECT RAISE(ABORT,'annotation history requires entity deletion'); END;
--> statement-breakpoint
CREATE TRIGGER page_annotation_retired_insert BEFORE INSERT ON page_annotation_revisions
WHEN EXISTS(SELECT 1 FROM page_deletions d WHERE d.page_id=NEW.page_id)
 OR EXISTS(SELECT 1 FROM page_retirements r WHERE r.version_id=NEW.version_id)
BEGIN SELECT RAISE(ABORT,'retired annotation content cannot be recreated'); END;
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
      ELSE json_set(OLD.request,'$.title','-') END)
) BEGIN SELECT RAISE(ABORT,'document transform intent and publication are immutable'); END;
--> statement-breakpoint
UPDATE pages SET title='-',description=NULL
WHERE id IN (SELECT page_id FROM page_deletions);
--> statement-breakpoint
UPDATE page_versions SET instruction=NULL,language=NULL
WHERE page_id IN (SELECT page_id FROM page_deletions);
--> statement-breakpoint
DELETE FROM page_annotation_revisions WHERE page_id IN (SELECT page_id FROM page_deletions);
--> statement-breakpoint
UPDATE page_transform_requests SET instruction='',report=NULL,
 request=CASE WHEN json_type(request,'$.merge')='object'
   THEN json_set(request,'$.title','-','$.merge.title','-','$.merge.instruction','')
   ELSE json_set(request,'$.title','-') END
WHERE result_version_id IN (SELECT v.id FROM page_versions v JOIN page_deletions d ON d.page_id=v.page_id);
