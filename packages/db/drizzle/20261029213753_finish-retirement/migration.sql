UPDATE sqlite_sequence SET seq = max(seq, coalesce((SELECT seq FROM retirement_message_sequence), 0)) WHERE name = 'message_versions';
--> statement-breakpoint
INSERT INTO sqlite_sequence(name, seq) SELECT 'message_versions', seq FROM retirement_message_sequence WHERE NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name = 'message_versions');
--> statement-breakpoint
DROP TABLE retirement_message_sequence;
--> statement-breakpoint
CREATE TRIGGER message_fts_ad AFTER DELETE ON message_versions WHEN old.status = 'complete' BEGIN
    INSERT INTO message_fts (message_fts, rowid, text) VALUES ('delete', old.id, old.text);
END;
--> statement-breakpoint
CREATE TRIGGER message_fts_ai AFTER INSERT ON message_versions WHEN new.status = 'complete' BEGIN
    INSERT INTO message_fts (rowid, text) VALUES (new.id, new.text);
END;
--> statement-breakpoint
CREATE TRIGGER message_fts_finish AFTER UPDATE OF status ON message_versions
WHEN old.status != 'complete' AND new.status = 'complete' BEGIN
    INSERT INTO message_fts (rowid, text) VALUES (new.id, new.text);
END;
--> statement-breakpoint
CREATE TRIGGER conversation_recording_posts_validate_insert BEFORE INSERT ON conversation_recording_posts
WHEN NOT EXISTS (
 SELECT 1 FROM messages m JOIN sessions s ON s.id=m.session_id
 JOIN message_versions v ON v.id=m.active_version_id AND v.message_id=m.id
 JOIN message_parts p ON p.message_id=m.id AND p.ordinal=0 JOIN sources src ON src.id=p.source_id
 WHERE m.id=NEW.message_id AND m.session_id=NEW.session_id AND m.role='user' AND m.recording_ms IS NOT NULL AND m.recorded_in=src.id AND v.origin='typed' AND v.status='complete' AND v.text='' AND src.project_id=s.project_id AND src.origin='recording' AND src.kind='audio' AND src.mime LIKE 'audio/%'
)
BEGIN SELECT RAISE(ABORT,'invalid conversation recording post'); END;
