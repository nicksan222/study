DROP TRIGGER source_recording_bytes_retained;
--> statement-breakpoint
CREATE TRIGGER source_recording_bytes_retained BEFORE DELETE ON source_blobs
WHEN (EXISTS(SELECT 1 FROM source_recording_imports r JOIN sources src ON src.id=r.source_id WHERE r.source_id=OLD.source_id)) AND NOT (EXISTS(SELECT 1 FROM material_deletion_members dm JOIN material_deletions d ON d.material_id=dm.deletion_id WHERE dm.material_id=(SELECT material_id FROM material_imports WHERE source_id=OLD.source_id) AND (d.status IN ('pending','failed') OR (d.status='completed'
      AND EXISTS(SELECT 1 FROM source_material_deletion_assets a JOIN material_deletions cleanup ON cleanup.material_id=a.deletion_id
        WHERE a.source_id=OLD.source_id AND cleanup.status IN ('pending','failed'))
      AND NOT EXISTS(SELECT 1 FROM material_source_snapshots retained WHERE retained.source_id=OLD.source_id)))))
BEGIN SELECT RAISE(ABORT,'imported recording bytes are retained'); END;
--> statement-breakpoint
DROP TRIGGER source_recording_capture_frozen;
--> statement-breakpoint
CREATE TRIGGER source_recording_capture_frozen BEFORE UPDATE ON sources
WHEN (EXISTS(SELECT 1 FROM source_recording_imports WHERE source_id=OLD.id) AND (
 NEW.id IS NOT OLD.id OR NEW.origin IS NOT OLD.origin OR NEW.kind IS NOT OLD.kind OR NEW.mime IS NOT OLD.mime OR NEW.name IS NOT OLD.name OR NEW.size_bytes IS NOT OLD.size_bytes OR NEW.sha256 IS NOT OLD.sha256 OR NEW.uri IS NOT OLD.uri OR NEW.created_at IS NOT OLD.created_at)) AND NOT (EXISTS(SELECT 1 FROM material_deletion_members dm JOIN material_deletions d ON d.material_id=dm.deletion_id WHERE dm.material_id=(SELECT material_id FROM material_imports WHERE source_id=OLD.id) AND (d.status IN ('pending','failed') OR (d.status='completed'
      AND EXISTS(SELECT 1 FROM source_material_deletion_assets a JOIN material_deletions cleanup ON cleanup.material_id=a.deletion_id
        WHERE a.source_id=OLD.id AND cleanup.status IN ('pending','failed'))
      AND NOT EXISTS(SELECT 1 FROM material_source_snapshots retained WHERE retained.source_id=OLD.id)))) AND NEW.name='-' AND NEW.uri IS NULL AND NEW.size_bytes=1 AND NEW.sha256=zeroblob(32) AND NEW.id IS OLD.id AND NEW.project_id IS OLD.project_id AND NEW.origin IS OLD.origin AND NEW.kind IS OLD.kind AND NEW.mime IS OLD.mime AND NEW.created_at IS OLD.created_at)
BEGIN SELECT RAISE(ABORT,'imported recording metadata is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER source_material_deletion_assets_valid BEFORE INSERT ON source_material_deletion_assets
WHEN NOT (
  EXISTS(SELECT 1 FROM material_deletions d WHERE d.material_id=NEW.deletion_id AND d.status='pending')
  AND EXISTS(SELECT 1 FROM material_imports i JOIN material_deletion_members m ON m.material_id=i.material_id WHERE i.source_id=NEW.source_id)
  AND (
    EXISTS(SELECT 1 FROM material_source_snapshots snap JOIN material_versions v ON v.id=snap.version_id
      JOIN material_deletion_members m ON m.material_id=v.material_id
      WHERE snap.source_id=NEW.source_id AND snap.revision=NEW.revision AND m.deletion_id=NEW.deletion_id)
    OR EXISTS(SELECT 1 FROM document_assets a WHERE a.source_id=NEW.source_id AND a.revision=NEW.revision AND (
      EXISTS(SELECT 1 FROM material_document_versions doc JOIN material_versions v ON v.id=doc.version_id
        JOIN material_deletion_members m ON m.material_id=v.material_id
        WHERE doc.document_id=a.document_id AND m.deletion_id=NEW.deletion_id)
      OR EXISTS(SELECT 1 FROM material_source_snapshots snap JOIN material_versions v ON v.id=snap.version_id
        JOIN material_deletion_members m ON m.material_id=v.material_id
        WHERE snap.document_id=a.document_id AND m.deletion_id=NEW.deletion_id)
    ))
  )
)
BEGIN SELECT RAISE(ABORT,'source cleanup candidate requires exact deleted ownership'); END;
--> statement-breakpoint
CREATE TRIGGER source_material_deletion_assets_immutable BEFORE UPDATE ON source_material_deletion_assets BEGIN SELECT RAISE(ABORT,'source cleanup ownership is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER source_material_deletion_assets_retained BEFORE DELETE ON source_material_deletion_assets BEGIN SELECT RAISE(ABORT,'source cleanup ownership is retained'); END;
