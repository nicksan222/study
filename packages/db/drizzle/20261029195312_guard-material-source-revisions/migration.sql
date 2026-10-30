DROP TRIGGER material_source_snapshots_published_update;
--> statement-breakpoint
CREATE TRIGGER material_source_snapshots_published_update BEFORE UPDATE ON material_source_snapshots
WHEN EXISTS(SELECT 1 FROM material_versions v JOIN projects p ON p.id=v.project_id WHERE v.id IN(old.version_id,new.version_id) AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published source revision is immutable'); END;
--> statement-breakpoint
DROP TRIGGER material_publish_file;
--> statement-breakpoint
CREATE TRIGGER material_publish_file BEFORE UPDATE OF status ON material_versions
WHEN new.status='published' AND new.kind='file' AND NOT EXISTS(SELECT 1 FROM material_source_snapshots pin
JOIN material_file_versions payload ON payload.version_id=pin.version_id AND payload.source_id=pin.source_id
JOIN source_snapshots ss ON ss.source_id=pin.source_id AND ss.revision=pin.revision
JOIN sources s ON s.id=pin.source_id
WHERE pin.version_id=new.id AND s.project_id=new.project_id AND json_valid(pin.metadata)
AND json_extract(pin.metadata,'$.id')=CAST(pin.source_id AS TEXT)
AND json_extract(pin.metadata,'$.projectId')=CAST(new.project_id AS TEXT)
AND json_extract(pin.metadata,'$.kind')=ss.kind AND json_extract(pin.metadata,'$.mime')=ss.mime
AND json_extract(pin.metadata,'$.uri') IS ss.uri
AND json_extract(pin.metadata,'$.sizeBytes')=CAST(length(ss.bytes) AS TEXT))
BEGIN SELECT RAISE(ABORT, 'published source requires a valid immutable revision'); END;
--> statement-breakpoint
DROP TRIGGER material_publish_audio;
--> statement-breakpoint
CREATE TRIGGER material_publish_audio BEFORE UPDATE OF status ON material_versions
WHEN new.status='published' AND new.kind='audio' AND NOT EXISTS(SELECT 1 FROM material_source_snapshots pin
JOIN material_audio_versions payload ON payload.version_id=pin.version_id AND payload.source_id=pin.source_id
JOIN source_snapshots ss ON ss.source_id=pin.source_id AND ss.revision=pin.revision
JOIN sources s ON s.id=pin.source_id
WHERE pin.version_id=new.id AND s.project_id=new.project_id AND json_valid(pin.metadata)
AND json_extract(pin.metadata,'$.id')=CAST(pin.source_id AS TEXT)
AND json_extract(pin.metadata,'$.projectId')=CAST(new.project_id AS TEXT)
AND json_extract(pin.metadata,'$.kind')=ss.kind AND json_extract(pin.metadata,'$.mime')=ss.mime
AND json_extract(pin.metadata,'$.uri') IS ss.uri
AND json_extract(pin.metadata,'$.sizeBytes')=CAST(length(ss.bytes) AS TEXT) AND ss.kind='audio' AND lower(ss.mime) LIKE 'audio/%')
BEGIN SELECT RAISE(ABORT, 'published source requires a valid immutable revision'); END;
--> statement-breakpoint
DROP TRIGGER material_publish_video;
--> statement-breakpoint
CREATE TRIGGER material_publish_video BEFORE UPDATE OF status ON material_versions
WHEN new.status='published' AND new.kind='video' AND NOT EXISTS(SELECT 1 FROM material_source_snapshots pin
JOIN material_video_versions payload ON payload.version_id=pin.version_id AND payload.source_id=pin.source_id
JOIN source_snapshots ss ON ss.source_id=pin.source_id AND ss.revision=pin.revision
JOIN sources s ON s.id=pin.source_id
WHERE pin.version_id=new.id AND s.project_id=new.project_id AND json_valid(pin.metadata)
AND json_extract(pin.metadata,'$.id')=CAST(pin.source_id AS TEXT)
AND json_extract(pin.metadata,'$.projectId')=CAST(new.project_id AS TEXT)
AND json_extract(pin.metadata,'$.kind')=ss.kind AND json_extract(pin.metadata,'$.mime')=ss.mime
AND json_extract(pin.metadata,'$.uri') IS ss.uri
AND json_extract(pin.metadata,'$.sizeBytes')=CAST(length(ss.bytes) AS TEXT) AND ss.kind='video' AND lower(ss.mime) LIKE 'video/%')
BEGIN SELECT RAISE(ABORT, 'published source requires a valid immutable revision'); END;
--> statement-breakpoint
DROP TRIGGER material_publish_image;
--> statement-breakpoint
CREATE TRIGGER material_publish_image BEFORE UPDATE OF status ON material_versions
WHEN new.status='published' AND new.kind='image' AND NOT EXISTS(SELECT 1 FROM material_source_snapshots pin
JOIN material_image_versions payload ON payload.version_id=pin.version_id AND payload.source_id=pin.source_id
JOIN source_snapshots ss ON ss.source_id=pin.source_id AND ss.revision=pin.revision
JOIN sources s ON s.id=pin.source_id
WHERE pin.version_id=new.id AND s.project_id=new.project_id AND json_valid(pin.metadata)
AND json_extract(pin.metadata,'$.id')=CAST(pin.source_id AS TEXT)
AND json_extract(pin.metadata,'$.projectId')=CAST(new.project_id AS TEXT)
AND json_extract(pin.metadata,'$.kind')=ss.kind AND json_extract(pin.metadata,'$.mime')=ss.mime
AND json_extract(pin.metadata,'$.uri') IS ss.uri
AND json_extract(pin.metadata,'$.sizeBytes')=CAST(length(ss.bytes) AS TEXT) AND ss.kind='image' AND lower(ss.mime) LIKE 'image/%')
BEGIN SELECT RAISE(ABORT, 'published source requires a valid immutable revision'); END;
--> statement-breakpoint
DROP TRIGGER material_publish_link;
--> statement-breakpoint
CREATE TRIGGER material_publish_link BEFORE UPDATE OF status ON material_versions
WHEN new.status='published' AND new.kind='link' AND NOT EXISTS(SELECT 1 FROM material_source_snapshots pin
JOIN material_link_versions payload ON payload.version_id=pin.version_id AND payload.source_id=pin.source_id
JOIN source_snapshots ss ON ss.source_id=pin.source_id AND ss.revision=pin.revision
JOIN sources s ON s.id=pin.source_id
WHERE pin.version_id=new.id AND s.project_id=new.project_id AND json_valid(pin.metadata)
AND json_extract(pin.metadata,'$.id')=CAST(pin.source_id AS TEXT)
AND json_extract(pin.metadata,'$.projectId')=CAST(new.project_id AS TEXT)
AND json_extract(pin.metadata,'$.kind')=ss.kind AND json_extract(pin.metadata,'$.mime')=ss.mime
AND json_extract(pin.metadata,'$.uri') IS ss.uri
AND ss.kind IN ('link','web') AND (ss.uri LIKE 'https://%' OR ss.uri LIKE 'http://%'))
BEGIN SELECT RAISE(ABORT, 'published source requires a valid immutable revision'); END;
