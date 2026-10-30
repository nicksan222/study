INSERT INTO source_processing (source_id, revision, request_id, document_id, published_request_id)
SELECT s.id, 1, 'source-initial/' || s.id,
  (SELECT max(d.id) FROM documents d WHERE d.source_id = s.id),
  CASE WHEN EXISTS (SELECT 1 FROM documents d WHERE d.source_id = s.id)
    THEN 'source-initial/' || s.id ELSE NULL END
FROM sources s
WHERE NOT EXISTS (SELECT 1 FROM source_processing p WHERE p.source_id = s.id);
--> statement-breakpoint
INSERT INTO source_snapshots (source_id, revision, bytes, kind, mime)
SELECT s.id, p.revision, b.bytes, s.kind, s.mime
FROM sources s
JOIN source_blobs b ON b.source_id = s.id
JOIN source_processing p ON p.source_id = s.id
WHERE NOT EXISTS (
  SELECT 1 FROM source_snapshots r WHERE r.source_id = s.id AND r.revision = p.revision
);
