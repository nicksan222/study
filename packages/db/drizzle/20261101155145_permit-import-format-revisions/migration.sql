-- A bound import keeps its initial display category while each revision pins its actual format.
DROP TRIGGER material_publish_audio;
--> statement-breakpoint
CREATE TRIGGER material_publish_audio BEFORE UPDATE OF status ON material_versions
WHEN new.status='published' AND new.kind='audio' AND NOT EXISTS(SELECT 1 FROM material_source_snapshots pin
JOIN material_audio_versions payload ON payload.version_id=pin.version_id AND payload.source_id=pin.source_id
JOIN source_snapshots ss ON ss.source_id=pin.source_id AND ss.revision=pin.revision
JOIN sources s ON s.id=pin.source_id
WHERE pin.version_id=new.id AND json_valid(pin.metadata)
AND json_extract(pin.metadata,'$.id')=CAST(pin.source_id AS TEXT)
AND json_extract(pin.metadata,'$.kind')=ss.kind AND json_extract(pin.metadata,'$.mime')=ss.mime
AND json_extract(pin.metadata,'$.uri') IS ss.uri
AND json_extract(pin.metadata,'$.sizeBytes')=CAST(length(ss.bytes) AS TEXT) AND (ss.kind='audio' AND lower(ss.mime) LIKE 'audio/%' OR EXISTS(SELECT 1 FROM material_imports i WHERE i.material_id=new.material_id AND i.source_id=pin.source_id)))
BEGIN SELECT RAISE(ABORT, 'published source requires a valid immutable revision'); END;
--> statement-breakpoint
DROP TRIGGER material_publish_video;
--> statement-breakpoint
CREATE TRIGGER material_publish_video BEFORE UPDATE OF status ON material_versions
WHEN new.status='published' AND new.kind='video' AND NOT EXISTS(SELECT 1 FROM material_source_snapshots pin
JOIN material_video_versions payload ON payload.version_id=pin.version_id AND payload.source_id=pin.source_id
JOIN source_snapshots ss ON ss.source_id=pin.source_id AND ss.revision=pin.revision
JOIN sources s ON s.id=pin.source_id
WHERE pin.version_id=new.id AND json_valid(pin.metadata)
AND json_extract(pin.metadata,'$.id')=CAST(pin.source_id AS TEXT)
AND json_extract(pin.metadata,'$.kind')=ss.kind AND json_extract(pin.metadata,'$.mime')=ss.mime
AND json_extract(pin.metadata,'$.uri') IS ss.uri
AND json_extract(pin.metadata,'$.sizeBytes')=CAST(length(ss.bytes) AS TEXT) AND (ss.kind='video' AND lower(ss.mime) LIKE 'video/%' OR EXISTS(SELECT 1 FROM material_imports i WHERE i.material_id=new.material_id AND i.source_id=pin.source_id)))
BEGIN SELECT RAISE(ABORT, 'published source requires a valid immutable revision'); END;
--> statement-breakpoint
DROP TRIGGER material_publish_image;
--> statement-breakpoint
CREATE TRIGGER material_publish_image BEFORE UPDATE OF status ON material_versions
WHEN new.status='published' AND new.kind='image' AND NOT EXISTS(SELECT 1 FROM material_source_snapshots pin
JOIN material_image_versions payload ON payload.version_id=pin.version_id AND payload.source_id=pin.source_id
JOIN source_snapshots ss ON ss.source_id=pin.source_id AND ss.revision=pin.revision
JOIN sources s ON s.id=pin.source_id
WHERE pin.version_id=new.id AND json_valid(pin.metadata)
AND json_extract(pin.metadata,'$.id')=CAST(pin.source_id AS TEXT)
AND json_extract(pin.metadata,'$.kind')=ss.kind AND json_extract(pin.metadata,'$.mime')=ss.mime
AND json_extract(pin.metadata,'$.uri') IS ss.uri
AND json_extract(pin.metadata,'$.sizeBytes')=CAST(length(ss.bytes) AS TEXT) AND (ss.kind='image' AND lower(ss.mime) LIKE 'image/%' OR EXISTS(SELECT 1 FROM material_imports i WHERE i.material_id=new.material_id AND i.source_id=pin.source_id)))
BEGIN SELECT RAISE(ABORT, 'published source requires a valid immutable revision'); END;
--> statement-breakpoint
DROP TRIGGER material_publish_link;
--> statement-breakpoint
CREATE TRIGGER material_publish_link BEFORE UPDATE OF status ON material_versions
WHEN new.status='published' AND new.kind='link' AND NOT EXISTS(SELECT 1 FROM material_source_snapshots pin
JOIN material_link_versions payload ON payload.version_id=pin.version_id AND payload.source_id=pin.source_id
JOIN source_snapshots ss ON ss.source_id=pin.source_id AND ss.revision=pin.revision
JOIN sources s ON s.id=pin.source_id
WHERE pin.version_id=new.id AND json_valid(pin.metadata)
AND json_extract(pin.metadata,'$.id')=CAST(pin.source_id AS TEXT)
AND json_extract(pin.metadata,'$.kind')=ss.kind AND json_extract(pin.metadata,'$.mime')=ss.mime
AND json_extract(pin.metadata,'$.uri') IS ss.uri
AND json_extract(pin.metadata,'$.sizeBytes')=CAST(length(ss.bytes) AS TEXT) AND (ss.kind IN ('link','web') AND (ss.uri LIKE 'https://%' OR ss.uri LIKE 'http://%') OR EXISTS(SELECT 1 FROM material_imports i WHERE i.material_id=new.material_id AND i.source_id=pin.source_id)))
BEGIN SELECT RAISE(ABORT, 'published source requires a valid immutable revision'); END;
