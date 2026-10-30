CREATE TRIGGER conversation_recording_posts_validate_insert BEFORE INSERT ON conversation_recording_posts
WHEN NOT EXISTS (
 SELECT 1 FROM messages m JOIN sessions s ON s.id=m.session_id
 JOIN message_versions v ON v.id=m.active_version_id AND v.message_id=m.id
 JOIN message_parts p ON p.message_id=m.id AND p.ordinal=0 JOIN sources src ON src.id=p.source_id
 WHERE m.id=NEW.message_id AND m.session_id=NEW.session_id AND m.role='user' AND m.recording_ms IS NOT NULL AND m.recorded_in=src.id AND v.origin='typed' AND v.status='complete' AND v.text='' AND src.project_id=s.project_id AND src.origin='recording' AND src.kind='audio' AND src.mime LIKE 'audio/%'
)
BEGIN SELECT RAISE(ABORT,'invalid conversation recording post'); END;
--> statement-breakpoint
CREATE TRIGGER conversation_recording_posts_immutable BEFORE UPDATE ON conversation_recording_posts
BEGIN SELECT RAISE(ABORT,'conversation recording post is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER conversation_recording_posts_retain BEFORE DELETE ON conversation_recording_posts
WHEN EXISTS(SELECT 1 FROM sessions s JOIN projects p ON p.id=s.project_id WHERE s.id=OLD.session_id)
BEGIN SELECT RAISE(ABORT,'conversation recording post is retained'); END;
--> statement-breakpoint
CREATE TRIGGER source_recording_imports_validate_insert BEFORE INSERT ON source_recording_imports
WHEN NOT EXISTS(SELECT 1 FROM sources src JOIN source_blobs b ON b.source_id=src.id JOIN sessions s ON s.id=NEW.session_id WHERE src.id=NEW.source_id AND src.project_id=NEW.project_id AND s.project_id=NEW.project_id AND src.origin='recording' AND src.kind='audio' AND src.mime='audio/wav' AND NEW.duration_ms=CAST((length(b.bytes)-44+16)/32 AS INTEGER))
BEGIN SELECT RAISE(ABORT,'invalid recording source receipt'); END;
--> statement-breakpoint
CREATE TRIGGER source_recording_imports_immutable BEFORE UPDATE ON source_recording_imports
BEGIN SELECT RAISE(ABORT,'recording source receipt is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER source_recording_imports_retain BEFORE DELETE ON source_recording_imports
WHEN EXISTS(SELECT 1 FROM projects WHERE id=OLD.project_id)
BEGIN SELECT RAISE(ABORT,'recording source receipt is retained'); END;
--> statement-breakpoint
CREATE TRIGGER recording_posts_validate_insert BEFORE INSERT ON recording_posts
WHEN NEW.source_id IS NOT NULL OR NEW.message_id IS NOT NULL OR NOT EXISTS(SELECT 1 FROM recordings r JOIN sessions s ON s.id=r.session_id WHERE r.id=NEW.recording_id AND r.session_id=NEW.session_id AND s.project_id=NEW.project_id) OR NEW.duration_ms != CAST((length(NEW.wav)-44+16)/32 AS INTEGER)
BEGIN SELECT RAISE(ABORT,'invalid recording snapshot'); END;
--> statement-breakpoint
CREATE TRIGGER recording_posts_immutable BEFORE UPDATE ON recording_posts
WHEN NEW.request_id IS NOT OLD.request_id OR NEW.recording_id IS NOT OLD.recording_id OR NEW.session_id IS NOT OLD.session_id OR NEW.project_id IS NOT OLD.project_id OR NEW.name IS NOT OLD.name OR NEW.wav IS NOT OLD.wav OR NEW.duration_ms IS NOT OLD.duration_ms OR NEW.created_at IS NOT OLD.created_at OR (OLD.message_id IS NOT NULL AND (NEW.message_id IS NOT OLD.message_id OR NEW.source_id IS NOT OLD.source_id))
BEGIN SELECT RAISE(ABORT,'recording snapshot and receipt are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER recording_posts_result_valid BEFORE UPDATE OF source_id,message_id ON recording_posts
WHEN NEW.message_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM source_recording_imports src JOIN conversation_recording_posts p ON p.request_id=src.request_id WHERE src.request_id=NEW.request_id AND src.source_id=NEW.source_id AND src.project_id=NEW.project_id AND src.session_id=NEW.session_id AND p.session_id=NEW.session_id AND p.message_id=NEW.message_id)
BEGIN SELECT RAISE(ABORT,'recording receipt does not identify its output'); END;
--> statement-breakpoint
CREATE TRIGGER recording_posts_retain BEFORE DELETE ON recording_posts
WHEN EXISTS(SELECT 1 FROM sessions s JOIN projects p ON p.id=s.project_id WHERE s.id=OLD.session_id)
BEGIN SELECT RAISE(ABORT,'recording intent is retained'); END;
--> statement-breakpoint
CREATE TRIGGER recording_chunks_captured_insert BEFORE INSERT ON recording_chunks
WHEN EXISTS(SELECT 1 FROM recording_posts WHERE recording_id=NEW.recording_id) OR (SELECT COALESCE(SUM(length(pcm)),0) FROM recording_chunks WHERE recording_id=NEW.recording_id)+length(NEW.pcm)>115200000
BEGIN SELECT RAISE(ABORT,'recording is captured or exceeds its size limit'); END;
--> statement-breakpoint
CREATE TRIGGER recording_chunks_captured_update BEFORE UPDATE ON recording_chunks
WHEN EXISTS(SELECT 1 FROM recording_posts WHERE recording_id IN(OLD.recording_id,NEW.recording_id))
BEGIN SELECT RAISE(ABORT,'captured recording PCM is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER recording_chunks_captured_delete BEFORE DELETE ON recording_chunks
WHEN EXISTS(SELECT 1 FROM recording_posts p JOIN sessions s ON s.id=p.session_id JOIN projects project ON project.id=s.project_id WHERE p.recording_id=OLD.recording_id)
BEGIN SELECT RAISE(ABORT,'captured recording PCM is retained'); END;

--> statement-breakpoint
CREATE TRIGGER source_recording_capture_frozen BEFORE UPDATE ON sources
WHEN EXISTS(SELECT 1 FROM source_recording_imports WHERE source_id=OLD.id)
BEGIN SELECT RAISE(ABORT,'imported recording metadata is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER source_recording_bytes_frozen BEFORE UPDATE ON source_blobs
WHEN EXISTS(SELECT 1 FROM source_recording_imports WHERE source_id IN(OLD.source_id,NEW.source_id))
BEGIN SELECT RAISE(ABORT,'imported recording bytes are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER recordings_captured_update BEFORE UPDATE ON recordings
WHEN EXISTS(SELECT 1 FROM recording_posts WHERE recording_id IN(OLD.id,NEW.id))
BEGIN SELECT RAISE(ABORT,'captured recording identity is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER source_recording_bytes_retained BEFORE DELETE ON source_blobs
WHEN EXISTS(SELECT 1 FROM source_recording_imports r JOIN sources src ON src.id=r.source_id WHERE r.source_id=OLD.source_id)
BEGIN SELECT RAISE(ABORT,'imported recording bytes are retained'); END;
