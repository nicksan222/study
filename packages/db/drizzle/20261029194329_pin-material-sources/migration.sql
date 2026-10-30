-- Reconcile current input before capturing immutable published Source metadata.
INSERT INTO source_processing(source_id,revision,request_id)
SELECT s.id,coalesce((SELECT max(revision) FROM source_snapshots WHERE source_id=s.id),1),'migration-source:' || s.id
FROM sources s WHERE NOT EXISTS(SELECT 1 FROM source_processing p WHERE p.source_id=s.id);
--> statement-breakpoint
INSERT INTO source_snapshots(source_id,revision,bytes,kind,mime,uri)
SELECT s.id,p.revision,coalesce(b.bytes,X''),s.kind,s.mime,s.uri FROM sources s
JOIN source_processing p ON p.source_id=s.id LEFT JOIN source_blobs b ON b.source_id=s.id
WHERE NOT EXISTS(SELECT 1 FROM source_snapshots ss WHERE ss.source_id=s.id AND ss.revision=p.revision);
--> statement-breakpoint
INSERT INTO source_snapshots(source_id,revision,bytes,kind,mime,uri)
SELECT s.id,(SELECT max(revision)+1 FROM source_snapshots WHERE source_id=s.id),coalesce(b.bytes,X''),s.kind,s.mime,s.uri
FROM sources s JOIN source_processing p ON p.source_id=s.id
JOIN source_snapshots ss ON ss.source_id=s.id AND ss.revision=p.revision
LEFT JOIN source_blobs b ON b.source_id=s.id
WHERE ss.bytes IS NOT coalesce(b.bytes,X'') OR ss.kind IS NOT s.kind OR ss.mime IS NOT s.mime OR ss.uri IS NOT s.uri;
--> statement-breakpoint
UPDATE source_processing SET revision=(SELECT max(revision) FROM source_snapshots WHERE source_id=source_processing.source_id),
request_id='migration-source-revision:' || source_id || ':' || (SELECT max(revision) FROM source_snapshots WHERE source_id=source_processing.source_id),published_request_id=NULL
WHERE EXISTS(SELECT 1 FROM sources s LEFT JOIN source_blobs b ON b.source_id=s.id JOIN source_snapshots ss ON ss.source_id=s.id AND ss.revision=source_processing.revision
WHERE s.id=source_processing.source_id AND (ss.bytes IS NOT coalesce(b.bytes,X'') OR ss.kind IS NOT s.kind OR ss.mime IS NOT s.mime OR ss.uri IS NOT s.uri));
--> statement-breakpoint
INSERT INTO workflow_events(event_id,type,causation_id,correlation_id,input_version,depth,payload,created_at)
SELECT p.request_id,'SourceProcessingRequested',NULL,p.request_id,p.revision,0,
json_object('type','SourceProcessingRequested','eventId',p.request_id,'causationId',NULL,'correlationId',p.request_id,'inputVersion',p.revision,'depth',0,'sourceId',CAST(p.source_id AS TEXT),'requestId',p.request_id),unixepoch()*1000
FROM source_processing p WHERE p.request_id='migration-source-revision:' || p.source_id || ':' || p.revision;
--> statement-breakpoint
INSERT INTO material_source_snapshots(version_id, source_id, revision, metadata)
SELECT c.version_id, s.id, p.revision, json_object(
  'id', CAST(s.id AS TEXT), 'name', s.name, 'kind', s.kind, 'mime', s.mime,
  'origin', s.origin, 'projectId', CASE WHEN s.project_id IS NULL THEN NULL ELSE CAST(s.project_id AS TEXT) END,
  'projectName', pr.name, 'sizeBytes', CAST(s.size_bytes AS TEXT), 'sha256', lower(hex(s.sha256)),
  'uri', s.uri, 'createdAt', CAST(s.created_at AS TEXT))
FROM (SELECT version_id, source_id FROM material_file_versions UNION ALL SELECT version_id, source_id FROM material_audio_versions UNION ALL SELECT version_id, source_id FROM material_video_versions UNION ALL SELECT version_id, source_id FROM material_image_versions UNION ALL SELECT version_id, source_id FROM material_link_versions) c JOIN sources s ON s.id=c.source_id
JOIN source_processing p ON p.source_id=s.id LEFT JOIN projects pr ON pr.id=s.project_id;
--> statement-breakpoint
DROP TRIGGER sources_material_update;
--> statement-breakpoint
DROP TRIGGER source_blobs_material_update;
--> statement-breakpoint
CREATE TRIGGER sources_material_update BEFORE UPDATE ON sources
WHEN EXISTS (SELECT 1 FROM (SELECT version_id, source_id FROM material_file_versions UNION ALL SELECT version_id, source_id FROM material_audio_versions UNION ALL SELECT version_id, source_id FROM material_video_versions UNION ALL SELECT version_id, source_id FROM material_image_versions UNION ALL SELECT version_id, source_id FROM material_link_versions) c JOIN material_versions v ON v.id=c.version_id JOIN projects p ON p.id=v.project_id LEFT JOIN material_source_snapshots pin ON pin.version_id=c.version_id AND pin.source_id=c.source_id WHERE c.source_id IN (old.id, new.id) AND v.status='published' AND pin.version_id IS NULL)
BEGIN SELECT RAISE(ABORT, 'unpinned published source content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER source_blobs_material_update BEFORE UPDATE ON source_blobs
WHEN EXISTS (SELECT 1 FROM (SELECT version_id, source_id FROM material_file_versions UNION ALL SELECT version_id, source_id FROM material_audio_versions UNION ALL SELECT version_id, source_id FROM material_video_versions UNION ALL SELECT version_id, source_id FROM material_image_versions UNION ALL SELECT version_id, source_id FROM material_link_versions) c JOIN material_versions v ON v.id=c.version_id JOIN projects p ON p.id=v.project_id LEFT JOIN material_source_snapshots pin ON pin.version_id=c.version_id AND pin.source_id=c.source_id WHERE c.source_id IN (old.source_id, new.source_id) AND v.status='published' AND pin.version_id IS NULL)
BEGIN SELECT RAISE(ABORT, 'unpinned published source content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_source_snapshots_published_update BEFORE UPDATE ON material_source_snapshots
WHEN EXISTS (SELECT 1 FROM material_versions v JOIN projects p ON p.id=v.project_id WHERE v.id=old.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published source revision is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER source_snapshots_published_update BEFORE UPDATE ON source_snapshots
WHEN EXISTS (SELECT 1 FROM material_source_snapshots pin JOIN material_versions v ON v.id=pin.version_id JOIN projects p ON p.id=v.project_id WHERE pin.source_id=old.source_id AND pin.revision=old.revision AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published source revision is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_source_snapshots_published_delete BEFORE DELETE ON material_source_snapshots
WHEN EXISTS (SELECT 1 FROM material_versions v JOIN projects p ON p.id=v.project_id WHERE v.id=old.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published source revision is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER source_snapshots_published_delete BEFORE DELETE ON source_snapshots
WHEN EXISTS (SELECT 1 FROM material_source_snapshots pin JOIN material_versions v ON v.id=pin.version_id JOIN projects p ON p.id=v.project_id WHERE pin.source_id=old.source_id AND pin.revision=old.revision AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published source revision is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_source_snapshots_published_insert BEFORE INSERT ON material_source_snapshots
WHEN EXISTS (SELECT 1 FROM material_versions v JOIN projects p ON p.id=v.project_id WHERE v.id=new.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published source revision is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_source_snapshots_match_insert BEFORE INSERT ON material_source_snapshots
WHEN NOT EXISTS (SELECT 1 FROM (SELECT version_id, source_id FROM material_file_versions UNION ALL SELECT version_id, source_id FROM material_audio_versions UNION ALL SELECT version_id, source_id FROM material_video_versions UNION ALL SELECT version_id, source_id FROM material_image_versions UNION ALL SELECT version_id, source_id FROM material_link_versions) c WHERE c.version_id=new.version_id AND c.source_id=new.source_id)
BEGIN SELECT RAISE(ABORT, 'material source revision must match content'); END;
--> statement-breakpoint
CREATE TRIGGER material_source_snapshots_match_update BEFORE UPDATE ON material_source_snapshots
WHEN NOT EXISTS (SELECT 1 FROM (SELECT version_id, source_id FROM material_file_versions UNION ALL SELECT version_id, source_id FROM material_audio_versions UNION ALL SELECT version_id, source_id FROM material_video_versions UNION ALL SELECT version_id, source_id FROM material_image_versions UNION ALL SELECT version_id, source_id FROM material_link_versions) c WHERE c.version_id=new.version_id AND c.source_id=new.source_id)
BEGIN SELECT RAISE(ABORT, 'material source revision must match content'); END;
