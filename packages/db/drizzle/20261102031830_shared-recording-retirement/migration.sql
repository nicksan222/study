DROP TRIGGER recording_posts_immutable;
--> statement-breakpoint
CREATE TRIGGER recording_posts_immutable BEFORE UPDATE ON recording_posts
WHEN (NEW.request_id IS NOT OLD.request_id OR NEW.recording_id IS NOT OLD.recording_id OR NEW.session_id IS NOT OLD.session_id OR NEW.name IS NOT OLD.name OR NEW.wav IS NOT OLD.wav OR NEW.duration_ms IS NOT OLD.duration_ms OR NEW.created_at IS NOT OLD.created_at OR (OLD.message_id IS NOT NULL AND (NEW.message_id IS NOT OLD.message_id OR NEW.source_id IS NOT OLD.source_id))) AND NOT (EXISTS(SELECT 1 FROM material_deletion_requests d JOIN source_recording_imports sr ON sr.request_id=OLD.request_id JOIN material_imports i ON i.source_id=sr.source_id JOIN material_deletion_members m ON m.material_id=i.material_id AND m.deletion_id=d.deletion_id WHERE d.request_id=OLD.request_id AND EXISTS(SELECT 1 FROM material_deletions cleanup WHERE cleanup.material_id=d.deletion_id AND cleanup.status IN ('pending','failed'))) AND NEW.name='-' AND NEW.wav=zeroblob(46) AND NEW.duration_ms=0 AND NEW.request_id IS OLD.request_id AND NEW.recording_id IS OLD.recording_id AND NEW.session_id IS OLD.session_id AND NEW.project_id IS OLD.project_id AND NEW.source_id IS OLD.source_id AND NEW.message_id IS OLD.message_id AND NEW.created_at IS OLD.created_at)
BEGIN SELECT RAISE(ABORT,'recording snapshot and receipt are immutable'); END;
--> statement-breakpoint
DROP TRIGGER recording_chunks_captured_delete;
--> statement-breakpoint
CREATE TRIGGER recording_chunks_captured_delete BEFORE DELETE ON recording_chunks
WHEN EXISTS(SELECT 1 FROM recording_posts p JOIN sessions sess ON sess.id=p.session_id WHERE p.recording_id=OLD.recording_id)
 AND NOT EXISTS(
   SELECT 1 FROM recording_posts p
   JOIN material_deletion_requests d ON d.request_id=p.request_id
   JOIN source_recording_imports sr ON sr.request_id=p.request_id
   JOIN material_imports i ON i.source_id=sr.source_id
   JOIN material_deletion_members m ON m.material_id=i.material_id AND m.deletion_id=d.deletion_id
   JOIN material_deletions cleanup ON cleanup.material_id=d.deletion_id
   WHERE p.recording_id=OLD.recording_id AND p.message_id IS NULL AND cleanup.status IN ('pending','failed')
 )
BEGIN SELECT RAISE(ABORT,'captured recording PCM is retained'); END;
