DROP TRIGGER material_evidence_inputs_owner;
--> statement-breakpoint
DROP TRIGGER material_evidence_citations_draft;
--> statement-breakpoint
DROP TRIGGER study_document_versions_sealed_update;
--> statement-breakpoint
DROP TRIGGER study_document_versions_draft_identity;
--> statement-breakpoint
DROP TRIGGER study_document_parents_insert;
--> statement-breakpoint
DROP TRIGGER study_document_versions_publish;
--> statement-breakpoint
DROP TRIGGER study_document_input_publication;
--> statement-breakpoint
DROP TRIGGER study_document_annotation_head;
--> statement-breakpoint
DROP TRIGGER study_document_annotation_revision_owner;
--> statement-breakpoint
DROP TRIGGER study_document_annotation_revisions_update;
--> statement-breakpoint
DROP TRIGGER study_document_edit_receipts_update;
--> statement-breakpoint
DROP TRIGGER study_document_proposal_receipts_immutable_update;
--> statement-breakpoint
PRAGMA defer_foreign_keys=ON;
--> statement-breakpoint
CREATE TEMP TABLE cutover_new_document_owners AS SELECT m.id material_id,
(SELECT coalesce(max(id),0) FROM study_documents)+row_number() OVER(ORDER BY m.id) document_id
FROM materials m WHERE m.kind='document' AND NOT EXISTS(SELECT 1 FROM material_imports i WHERE i.material_id=m.id)
AND NOT EXISTS(SELECT 1 FROM legacy_document_materials x WHERE x.material_id=m.id);
--> statement-breakpoint
INSERT INTO legacy_document_materials(material_id,document_id) SELECT material_id,document_id FROM cutover_new_document_owners;
--> statement-breakpoint
INSERT INTO study_documents(id,title,description,created_at,updated_at,archived_at)
SELECT x.document_id,m.title,m.description,m.created_at,m.updated_at,m.archived_at
FROM materials m JOIN cutover_new_document_owners x ON x.material_id=m.id;
--> statement-breakpoint
UPDATE study_documents AS d SET title=(SELECT m.title FROM materials m JOIN legacy_document_materials x ON x.material_id=m.id WHERE x.document_id=d.id),
description=(SELECT m.description FROM materials m JOIN legacy_document_materials x ON x.material_id=m.id WHERE x.document_id=d.id),
updated_at=(SELECT m.updated_at FROM materials m JOIN legacy_document_materials x ON x.material_id=m.id WHERE x.document_id=d.id),
archived_at=(SELECT m.archived_at FROM materials m JOIN legacy_document_materials x ON x.material_id=m.id WHERE x.document_id=d.id)
WHERE EXISTS(SELECT 1 FROM legacy_document_materials x JOIN materials m ON m.id=x.material_id WHERE x.document_id=d.id AND m.updated_at>d.updated_at)
AND NOT EXISTS(SELECT 1 FROM study_document_versions v WHERE v.document_id=d.id AND NOT EXISTS(SELECT 1 FROM legacy_document_versions x WHERE x.document_version_id=v.id));
--> statement-breakpoint
CREATE TEMP TABLE cutover_new_document_versions AS SELECT v.id material_version_id,x.document_id,
CASE WHEN c.id IS NOT NULL AND EXISTS(SELECT 1 FROM blocks WHERE document_id=c.id)
 THEN (SELECT coalesce(max(id),0) FROM study_document_versions)+row_number() OVER(ORDER BY v.id) END document_version_id,
c.id old_snapshot_id,CASE WHEN c.id IS NOT NULL AND EXISTS(SELECT 1 FROM blocks WHERE document_id=c.id)
 THEN (SELECT coalesce(max(id),0) FROM content_snapshots)+row_number() OVER(ORDER BY v.id) END new_snapshot_id,
c.id IS NULL OR NOT EXISTS(SELECT 1 FROM blocks WHERE document_id=c.id) retired
FROM material_versions v JOIN legacy_document_materials x ON x.material_id=v.material_id
LEFT JOIN material_document_versions d ON d.version_id=v.id LEFT JOIN content_snapshots c ON c.id=d.document_id
WHERE NOT EXISTS(SELECT 1 FROM legacy_document_versions old WHERE old.material_version_id=v.id);
--> statement-breakpoint
INSERT INTO legacy_document_versions(material_version_id,document_id,document_version_id,old_snapshot_id,new_snapshot_id,retired)
SELECT material_version_id,document_id,document_version_id,old_snapshot_id,new_snapshot_id,retired FROM cutover_new_document_versions;
--> statement-breakpoint
CREATE TEMP TABLE cutover_document_numbers AS
SELECT v.id,m.number FROM study_document_versions v JOIN legacy_document_versions x ON x.document_version_id=v.id JOIN material_versions m ON m.id=x.material_version_id
UNION ALL SELECT v.id,(SELECT coalesce(max(m.number),0) FROM material_versions m JOIN legacy_document_materials x ON x.material_id=m.material_id WHERE x.document_id=v.document_id)
+row_number() OVER(PARTITION BY v.document_id ORDER BY v.number)
FROM study_document_versions v WHERE EXISTS(SELECT 1 FROM legacy_document_materials x WHERE x.document_id=v.document_id)
AND NOT EXISTS(SELECT 1 FROM legacy_document_versions x WHERE x.document_version_id=v.id);
--> statement-breakpoint
CREATE TEMP TABLE cutover_document_number_offset AS SELECT coalesce(max(number),0)+(SELECT coalesce(max(number),0) FROM cutover_document_numbers)+1 value FROM study_document_versions;
--> statement-breakpoint
UPDATE study_document_versions SET number=number+(SELECT value FROM cutover_document_number_offset)
WHERE id IN(SELECT id FROM cutover_document_numbers);
--> statement-breakpoint
UPDATE study_document_versions SET number=(SELECT number FROM cutover_document_numbers n WHERE n.id=study_document_versions.id)
WHERE id IN(SELECT id FROM cutover_document_numbers);
--> statement-breakpoint
INSERT INTO content_snapshots(id,source_id,extractor,extractor_version,meta,created_at)
SELECT x.new_snapshot_id,NULL,c.extractor,c.extractor_version,c.meta,c.created_at FROM cutover_new_document_versions x JOIN content_snapshots c ON c.id=x.old_snapshot_id WHERE x.new_snapshot_id IS NOT NULL;
--> statement-breakpoint
INSERT INTO blocks(document_id,ordinal,kind,editing_id,content,text,anchor)
SELECT x.new_snapshot_id,b.ordinal,b.kind,b.editing_id,b.content,b.text,b.anchor FROM cutover_new_document_versions x JOIN blocks b ON b.document_id=x.old_snapshot_id WHERE x.new_snapshot_id IS NOT NULL;
--> statement-breakpoint
INSERT INTO study_document_versions(id,document_id,number,status,operation,creator,content_snapshot_id,instruction,language,created_at)
SELECT x.document_version_id,x.document_id,v.number,'draft',CASE WHEN v.operation IN ('extract','transcribe') THEN 'original' ELSE v.operation END,
CASE WHEN v.creator='import' THEN 'user' ELSE v.creator END,x.new_snapshot_id,v.instruction,v.language,v.created_at
FROM cutover_new_document_versions x JOIN material_versions v ON v.id=x.material_version_id WHERE x.document_version_id IS NOT NULL;
--> statement-breakpoint
INSERT INTO study_document_version_parents(version_id,parent_version_id,document_id)
SELECT c.document_version_id,p.document_version_id,c.document_id FROM material_version_parents a
JOIN cutover_new_document_versions c ON c.material_version_id=a.version_id JOIN legacy_document_versions p ON p.material_version_id=a.parent_version_id
WHERE c.document_version_id IS NOT NULL AND p.document_version_id IS NOT NULL;
--> statement-breakpoint
CREATE TEMP TABLE cutover_new_document_inputs AS SELECT c.document_version_id version_id,i.input_version_id old_input,
row_number() OVER(PARTITION BY c.document_version_id ORDER BY i.input_version_id)-1 position,
p.document_version_id,CASE WHEN p.document_version_id IS NULL THEN ss.source_id END source_id,
CASE WHEN p.document_version_id IS NULL THEN ss.revision END source_revision,
CASE WHEN p.document_version_id IS NULL THEN e.snapshot_id END source_snapshot_id
FROM material_version_inputs i JOIN cutover_new_document_versions c ON c.material_version_id=i.version_id
LEFT JOIN legacy_document_versions p ON p.material_version_id=i.input_version_id
LEFT JOIN material_source_snapshots ss ON ss.version_id=i.input_version_id
LEFT JOIN source_extraction_revisions e ON e.source_id=ss.source_id AND e.revision=ss.revision AND e.snapshot_id=ss.document_id
WHERE c.document_version_id IS NOT NULL AND (p.document_version_id IS NOT NULL OR ss.source_id IS NOT NULL);
--> statement-breakpoint
INSERT INTO study_document_inputs(version_id,position,document_version_id,source_id,source_revision,source_snapshot_id)
SELECT version_id,position,document_version_id,source_id,source_revision,source_snapshot_id FROM cutover_new_document_inputs;
--> statement-breakpoint
INSERT INTO study_document_citations(version_id,marker,input_id,anchor,target,quote)
SELECT x.version_id,c.marker,i.id,c.anchor,CASE WHEN c.target IS NULL THEN NULL ELSE json_remove(c.target,'$.versionId','$.documentId') END,c.quote
FROM material_version_citations c JOIN cutover_new_document_inputs x ON x.version_id=(SELECT document_version_id FROM legacy_document_versions WHERE material_version_id=c.version_id) AND x.old_input=c.input_version_id
JOIN study_document_inputs i ON i.version_id=x.version_id AND i.position=x.position;
--> statement-breakpoint
UPDATE study_document_versions SET status='published',published_at=(SELECT v.published_at FROM cutover_new_document_versions x JOIN material_versions v ON v.id=x.material_version_id WHERE x.document_version_id=study_document_versions.id)
WHERE id IN(SELECT x.document_version_id FROM cutover_new_document_versions x JOIN material_versions v ON v.id=x.material_version_id WHERE v.status='published');
--> statement-breakpoint
INSERT OR IGNORE INTO project_documents(project_id,document_id) SELECT p.project_id,x.document_id FROM project_materials p JOIN legacy_document_materials x ON x.material_id=p.material_id;
--> statement-breakpoint
INSERT OR IGNORE INTO session_documents(session_id,document_id,position)
SELECT p.session_id,x.document_id,(SELECT coalesce(max(position),-1) FROM session_documents d WHERE d.session_id=p.session_id)+row_number() OVER(PARTITION BY p.session_id ORDER BY p.position,p.material_id)
FROM session_materials p JOIN legacy_document_materials x ON x.material_id=p.material_id
WHERE NOT EXISTS(SELECT 1 FROM session_documents d WHERE d.session_id=p.session_id AND d.document_id=x.document_id);
--> statement-breakpoint
INSERT OR IGNORE INTO session_sources(session_id,source_id,position)
SELECT p.session_id,x.source_id,(SELECT coalesce(max(position),-1) FROM session_sources d WHERE d.session_id=p.session_id)+row_number() OVER(PARTITION BY p.session_id ORDER BY p.position,p.material_id)
FROM session_materials p JOIN material_imports x ON x.material_id=p.material_id WHERE NOT EXISTS(SELECT 1 FROM session_sources d WHERE d.session_id=p.session_id AND d.source_id=x.source_id);
--> statement-breakpoint
INSERT OR IGNORE INTO study_document_edit_receipts(document_id,key,operation,intent,expected_version_id,current_version_id,submitted_version_id,outcome)
SELECT m.document_id,r.key,CASE WHEN r.operation='undo' THEN 'restore' ELSE r.operation END,json_quote('domain_cutover'),e.document_version_id,c.document_version_id,n.document_version_id,r.outcome
FROM document_edit_receipts r JOIN legacy_document_materials m ON m.material_id=r.material_id
JOIN legacy_document_versions e ON e.material_version_id=r.expected_version_id JOIN legacy_document_versions c ON c.material_version_id=r.current_version_id JOIN legacy_document_versions n ON n.material_version_id=r.submitted_version_id
WHERE e.document_version_id IS NOT NULL AND c.document_version_id IS NOT NULL AND n.document_version_id IS NOT NULL;
--> statement-breakpoint
CREATE TEMP TABLE cutover_annotation_streams AS SELECT a.id material_annotation_id,m.document_id,
(SELECT coalesce(max(id),0) FROM study_document_annotations)+row_number() OVER(ORDER BY a.id) annotation_id
FROM material_annotations a JOIN legacy_document_materials m ON m.material_id=a.material_id
LEFT JOIN legacy_document_annotations x ON x.material_annotation_id=a.id
WHERE x.annotation_id IS NULL OR EXISTS(SELECT 1 FROM material_annotation_revisions old
JOIN study_document_annotation_revisions n ON n.annotation_id=x.annotation_id AND n.revision=old.revision
WHERE old.annotation_id=a.id AND (json_extract(old.payload,'$.note') IS NOT json_extract(n.payload,'$.note')
 OR json_extract(old.payload,'$.kind') IS NOT json_extract(n.payload,'$.kind') OR json_extract(old.payload,'$.deleted') IS NOT json_extract(n.payload,'$.deleted')
 OR json_extract(old.payload,'$.target.range.blockId') IS NOT json_extract(n.payload,'$.target.range.blockId')
 OR json_extract(old.payload,'$.target.range.start') IS NOT json_extract(n.payload,'$.target.range.start')
 OR json_extract(old.payload,'$.target.range.end') IS NOT json_extract(n.payload,'$.target.range.end')));
--> statement-breakpoint
INSERT INTO study_document_annotations(id,document_id,revision) SELECT annotation_id,document_id,1 FROM cutover_annotation_streams;
--> statement-breakpoint
INSERT INTO legacy_document_annotations(material_annotation_id,annotation_id) SELECT material_annotation_id,annotation_id FROM cutover_annotation_streams WHERE true
ON CONFLICT(material_annotation_id) DO UPDATE SET annotation_id=excluded.annotation_id;
--> statement-breakpoint
INSERT INTO study_document_annotation_revisions(annotation_id,revision,document_id,version_id,snapshot_id,payload)
SELECT a.annotation_id,r.revision,v.document_id,v.document_version_id,v.new_snapshot_id,
json_set(json_remove(r.payload,'$.evidence'),'$.id',CAST(a.annotation_id AS TEXT),'$.target',json_object('documentId',CAST(v.document_id AS TEXT),'range',json_object('versionId',CAST(v.document_version_id AS TEXT),'snapshotId',CAST(v.new_snapshot_id AS TEXT),'blockId',json_extract(r.payload,'$.target.range.blockId'),'start',json_extract(r.payload,'$.target.range.start'),'end',json_extract(r.payload,'$.target.range.end'))))
FROM material_annotation_revisions r JOIN legacy_document_annotations a ON a.material_annotation_id=r.annotation_id JOIN legacy_document_versions v ON v.material_version_id=r.version_id
WHERE v.document_version_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM study_document_annotation_revisions n WHERE n.annotation_id=a.annotation_id AND n.revision=r.revision);
--> statement-breakpoint
UPDATE study_document_annotations SET revision=(SELECT max(revision) FROM study_document_annotation_revisions r WHERE r.annotation_id=study_document_annotations.id)
WHERE id IN(SELECT annotation_id FROM legacy_document_annotations) AND EXISTS(SELECT 1 FROM study_document_annotation_revisions r WHERE r.annotation_id=study_document_annotations.id);
--> statement-breakpoint
INSERT INTO material_evidence_inputs(version_id,position,document_version_id)
SELECT i.version_id,(SELECT coalesce(max(position),-1) FROM material_evidence_inputs e WHERE e.version_id=i.version_id)+row_number() OVER(PARTITION BY i.version_id ORDER BY i.input_version_id),m.document_version_id
FROM material_version_inputs i JOIN legacy_document_versions m ON m.material_version_id=i.input_version_id
JOIN material_versions v ON v.id=i.version_id WHERE v.kind IN ('diagram','quiz','flashcards') AND m.document_version_id IS NOT NULL
AND NOT EXISTS(SELECT 1 FROM material_evidence_inputs e WHERE e.version_id=i.version_id AND e.document_version_id=m.document_version_id);
--> statement-breakpoint
INSERT INTO material_evidence_citations(version_id,marker,input_id,anchor,target,quote)
SELECT c.version_id,c.marker,i.id,c.anchor,CASE WHEN c.target IS NULL THEN NULL ELSE json_remove(c.target,'$.versionId','$.documentId') END,c.quote
FROM material_version_citations c JOIN legacy_document_versions m ON m.material_version_id=c.input_version_id
JOIN material_evidence_inputs i ON i.version_id=c.version_id AND i.document_version_id=m.document_version_id
WHERE NOT EXISTS(SELECT 1 FROM material_evidence_citations e WHERE e.version_id=c.version_id AND e.marker=c.marker);
--> statement-breakpoint
INSERT INTO study_document_citation_assessments(version_id,marker,payload)
SELECT x.document_version_id,a.marker,json_object(
 'claim',json_object('documentId',CAST(x.document_id AS TEXT),'range',json_object('versionId',CAST(x.document_version_id AS TEXT),'snapshotId',CAST(x.new_snapshot_id AS TEXT),'blockId',json_extract(a.payload,'$.claim.range.blockId'),'start',json_extract(a.payload,'$.claim.range.start'),'end',json_extract(a.payload,'$.claim.range.end'))),
 'evidence',json(CASE WHEN i.document_version_id IS NOT NULL THEN json_object('kind','document','versionId',CAST(i.document_version_id AS TEXT)) WHEN i.source_id IS NOT NULL THEN json_object('kind','source','sourceId',CAST(i.source_id AS TEXT),'revision',CAST(i.source_revision AS TEXT),'snapshotId',CAST(i.source_snapshot_id AS TEXT)) ELSE json_object('kind','legacy_material','versionId',CAST(i.legacy_material_version_id AS TEXT)) END),
 'evidenceRange',json_object('blockId',json_extract(a.payload,'$.evidence.range.blockId'),'start',json_extract(a.payload,'$.evidence.range.start'),'end',json_extract(a.payload,'$.evidence.range.end')),
 'marker',a.marker,'judgment',json_extract(a.payload,'$.judgment'),'note',json_extract(a.payload,'$.note'),'suppliedBy','user','independentVerification',json('false'),
 'citation',json_object('marker',a.marker,'input',json(CASE WHEN i.document_version_id IS NOT NULL THEN json_object('kind','document','versionId',CAST(i.document_version_id AS TEXT)) WHEN i.source_id IS NOT NULL THEN json_object('kind','source','sourceId',CAST(i.source_id AS TEXT),'revision',CAST(i.source_revision AS TEXT),'snapshotId',CAST(i.source_snapshot_id AS TEXT)) ELSE json_object('kind','legacy_material','versionId',CAST(i.legacy_material_version_id AS TEXT)) END),'anchor',json(c.anchor),'quote',c.quote,'target',json(json_remove(c.target,'$.versionId','$.documentId'))))
FROM material_citation_assessments a JOIN legacy_document_versions x ON x.material_version_id=a.claim_version_id JOIN study_document_citations c ON c.version_id=x.document_version_id AND c.marker=a.marker JOIN study_document_inputs i ON i.id=c.input_id WHERE (i.document_version_id IS NOT NULL OR i.source_id IS NOT NULL) AND NOT EXISTS(SELECT 1 FROM study_document_citation_assessments n WHERE n.version_id=x.document_version_id AND n.marker=a.marker AND json_extract(n.payload,'$.note') IS json_extract(a.payload,'$.note') AND json_extract(n.payload,'$.judgment') IS json_extract(a.payload,'$.judgment') AND json_extract(n.payload,'$.claim.range.blockId') IS json_extract(a.payload,'$.claim.range.blockId') AND json_extract(n.payload,'$.claim.range.start') IS json_extract(a.payload,'$.claim.range.start') AND json_extract(n.payload,'$.claim.range.end') IS json_extract(a.payload,'$.claim.range.end'));
--> statement-breakpoint
INSERT OR IGNORE INTO study_document_generation_requests(id,document_id,expected_version_id,session_id,intent_hash,result_version_id,created_at)
SELECT g.id,b.document_id,b.document_version_id,CASE WHEN EXISTS(SELECT 1 FROM sessions WHERE id=p.session_id) THEN p.session_id END,
coalesce(g.result_hash,printf('%064d',0)),r.document_version_id,g.created_at
FROM document_proposals p JOIN material_generation_requests g ON g.id=p.request_id
JOIN legacy_document_versions b ON b.material_version_id=p.base_version_id LEFT JOIN legacy_document_versions r ON r.material_version_id=g.result_version_id
WHERE b.document_version_id IS NOT NULL;
--> statement-breakpoint
INSERT OR IGNORE INTO study_document_proposals(request_id,base_version_id,proposed_version_id)
SELECT p.request_id,b.document_version_id,v.document_version_id FROM document_proposals p
JOIN study_document_generation_requests g ON g.id=p.request_id
JOIN legacy_document_versions b ON b.material_version_id=p.base_version_id JOIN legacy_document_versions v ON v.material_version_id=p.proposed_version_id
WHERE b.document_version_id IS NOT NULL AND v.document_version_id IS NOT NULL;
--> statement-breakpoint
INSERT OR IGNORE INTO study_document_proposal_receipts(key,request_id,operation,intent,outcome,current_version_id,result_version_id)
SELECT r.key,r.request_id,r.operation,json_quote('domain_cutover'),r.outcome,c.document_version_id,v.document_version_id
FROM document_proposal_receipts r JOIN study_document_proposals p ON p.request_id=r.request_id
JOIN legacy_document_versions c ON c.material_version_id=r.current_version_id LEFT JOIN legacy_document_versions v ON v.material_version_id=r.result_version_id
WHERE c.document_version_id IS NOT NULL AND (r.result_version_id IS NULL OR v.document_version_id IS NOT NULL);
--> statement-breakpoint
DROP TRIGGER session_run_contexts_immutable;
--> statement-breakpoint
CREATE TEMP TABLE cutover_selection_references AS
SELECT CAST(x.material_version_id AS TEXT) old_id,
 json_object('kind','document','versionId',CAST(x.document_version_id AS TEXT)) input,
 CAST(x.new_snapshot_id AS TEXT) snapshot_id, CAST(x.document_id AS TEXT) document_id
FROM legacy_document_versions x WHERE x.document_version_id IS NOT NULL
UNION ALL
SELECT CAST(x.version_id AS TEXT),
 json_object('kind','source','sourceId',CAST(x.source_id AS TEXT),'revision',CAST(x.revision AS TEXT),'snapshotId',CAST(x.document_id AS TEXT)),
 CAST(x.document_id AS TEXT),NULL
FROM material_source_snapshots x JOIN source_extraction_revisions e ON e.source_id=x.source_id AND e.revision=x.revision AND e.snapshot_id=x.document_id;
--> statement-breakpoint
UPDATE sessions SET selection=(SELECT coalesce(json_group_array(json(CASE WHEN json_extract(j.value,'$.input.kind') IS NOT NULL THEN j.value ELSE json_set(json_remove(j.value,'$.versionId','$.materialId','$.documentId'),'$.input',json(m.input),'$.scope',json(CASE WHEN json_extract(j.value,'$.scope.kind')='ranges' THEN json_set(json_extract(j.value,'$.scope'),'$.ranges',json((SELECT coalesce(json_group_array(json(json_remove(r.value,'$.versionId','$.documentId'))),'[]') FROM json_each(j.value,'$.scope.ranges') r))) ELSE json_extract(j.value,'$.scope') END)) END)),'[]') FROM json_each(sessions.selection) j LEFT JOIN cutover_selection_references m ON m.old_id=CAST(json_extract(j.value,'$.versionId') AS TEXT)) WHERE NOT EXISTS(SELECT 1 FROM json_each(sessions.selection) j LEFT JOIN cutover_selection_references m ON m.old_id=CAST(json_extract(j.value,'$.versionId') AS TEXT) WHERE json_extract(j.value,'$.input.kind') IS NULL AND m.old_id IS NULL);
--> statement-breakpoint
UPDATE session_run_contexts SET snapshot=json_set(snapshot,'$.inputs',json((SELECT coalesce(json_group_array(json(CASE WHEN json_extract(j.value,'$.input.kind') IS NOT NULL THEN j.value ELSE json_set(json_set(json_remove(j.value,'$.versionId','$.materialId','$.documentId'),'$.input',json(m.input),'$.scope',json(CASE WHEN json_extract(j.value,'$.scope.kind')='ranges' THEN json_set(json_extract(j.value,'$.scope'),'$.ranges',json((SELECT coalesce(json_group_array(json(json_remove(r.value,'$.versionId','$.documentId'))),'[]') FROM json_each(j.value,'$.scope.ranges') r))) ELSE json_extract(j.value,'$.scope') END)),'$.snapshotId',m.snapshot_id,'$.documentId',m.document_id) END)),'[]') FROM json_each(session_run_contexts.snapshot,'$.inputs') j LEFT JOIN cutover_selection_references m ON m.old_id=CAST(json_extract(j.value,'$.versionId') AS TEXT)))) WHERE NOT EXISTS(SELECT 1 FROM json_each(session_run_contexts.snapshot,'$.inputs') j LEFT JOIN cutover_selection_references m ON m.old_id=CAST(json_extract(j.value,'$.versionId') AS TEXT) WHERE json_extract(j.value,'$.input.kind') IS NULL AND m.old_id IS NULL);
--> statement-breakpoint
UPDATE conversation_reply_requests SET snapshot=json_set(snapshot,'$.context',json((SELECT c.snapshot FROM session_run_contexts c WHERE c.request_id=json_extract(conversation_reply_requests.snapshot,'$.context.requestId')))) WHERE json_extract(snapshot,'$.context.requestId') IS NOT NULL AND EXISTS(SELECT 1 FROM session_run_contexts c WHERE c.request_id=json_extract(conversation_reply_requests.snapshot,'$.context.requestId') AND NOT EXISTS(SELECT 1 FROM json_each(c.snapshot,'$.inputs') j WHERE json_extract(j.value,'$.input.kind') IS NULL)) AND NOT EXISTS(SELECT 1 FROM session_retired_intents r WHERE r.request_id=conversation_reply_requests.request_id);
--> statement-breakpoint
INSERT OR IGNORE INTO session_context_documents(request_id,version_id) SELECT c.request_id,CAST(json_extract(j.value,'$.input.versionId') AS INTEGER) FROM session_run_contexts c,json_each(c.snapshot,'$.inputs') j WHERE json_extract(j.value,'$.input.kind')='document';
--> statement-breakpoint
INSERT OR IGNORE INTO session_context_sources(request_id,source_id,revision,snapshot_id) SELECT c.request_id,CAST(json_extract(j.value,'$.input.sourceId') AS INTEGER),CAST(json_extract(j.value,'$.input.revision') AS INTEGER),CAST(json_extract(j.value,'$.input.snapshotId') AS INTEGER) FROM session_run_contexts c,json_each(c.snapshot,'$.inputs') j WHERE json_extract(j.value,'$.input.kind')='source';
--> statement-breakpoint
UPDATE citations SET authored_version_id=(SELECT x.document_version_id FROM legacy_document_versions x WHERE x.material_version_id=citations.material_version_id),document_id=coalesce((SELECT x.new_snapshot_id FROM legacy_document_versions x WHERE x.material_version_id=citations.material_version_id),document_id),source_revision=(SELECT x.revision FROM material_source_snapshots x WHERE x.version_id=citations.material_version_id) WHERE material_version_id IS NOT NULL;
--> statement-breakpoint
UPDATE citations SET source_revision=(SELECT e.revision FROM source_extraction_revisions e WHERE e.source_id=citations.source_id AND e.snapshot_id=citations.document_id ORDER BY e.revision LIMIT 1) WHERE source_id IS NOT NULL AND source_revision IS NULL;
--> statement-breakpoint
UPDATE material_generation_requests SET cancelled=1 WHERE json_extract(payload,'$.kind')='document' AND result_version_id IS NULL;
--> statement-breakpoint
UPDATE citations SET source_id=(SELECT x.source_id FROM material_source_snapshots x WHERE x.version_id=citations.material_version_id)
WHERE material_version_id IN(SELECT version_id FROM material_source_snapshots);
--> statement-breakpoint
INSERT OR IGNORE INTO study_document_transform_requests(id,context_request_id,session_id,request,intent_hash,instruction,event_id,cancelled,error_kind,result_version_id,report,result_hash,created_at)
SELECT g.id,json_extract(g.payload,'$.documentTransform.contextRequestId'),c.session_id,
 json_patch(json_object('contextRequestId',json_extract(g.payload,'$.documentTransform.contextRequestId'),'title',json_extract(g.payload,'$.title'),'operations',json(json_extract(g.payload,'$.documentTransform.operations'))),
 CASE WHEN b.document_version_id IS NULL THEN '{}' ELSE json_object('editTargetVersionId',CAST(b.document_version_id AS TEXT)) END),
 coalesce(g.result_hash,'retained-request'),coalesce(json_extract(g.payload,'$.instruction'),json_extract(c.snapshot,'$.instruction'),''),g.id,
 CASE WHEN g.result_version_id IS NULL THEN 1 ELSE g.cancelled END,
 CASE WHEN g.result_version_id IS NULL THEN 'cancelled' END,r.document_version_id,g.result_metadata,g.result_hash,g.created_at
FROM material_generation_requests g
LEFT JOIN session_run_contexts c ON c.request_id=json_extract(g.payload,'$.documentTransform.contextRequestId')
LEFT JOIN legacy_document_versions b ON b.material_version_id=CAST(json_extract(g.payload,'$.documentTransform.editTargetVersionId') AS INTEGER)
LEFT JOIN legacy_document_versions r ON r.material_version_id=g.result_version_id
WHERE json_extract(g.payload,'$.kind')='document' AND (g.result_version_id IS NULL OR r.document_version_id IS NOT NULL);
--> statement-breakpoint
INSERT OR IGNORE INTO workflow_retired_correlations(correlation_id,event_type)
SELECT id,'MaterialGenerationRequested' FROM study_document_transform_requests;
--> statement-breakpoint
INSERT OR IGNORE INTO workflow_retired_executions(execution_id,correlation_id)
SELECT r.execution_id,e.correlation_id FROM workflow_receipts r JOIN workflow_events e ON e.event_id=r.event_id
WHERE e.correlation_id IN(SELECT id FROM study_document_transform_requests) AND r.subscription='material-generation';
--> statement-breakpoint
UPDATE workflow_events SET type='DocumentGenerationRequested',payload=json_set(json_remove(payload,'$.kind','$.projectId'),'$.type','DocumentGenerationRequested')
WHERE type='MaterialGenerationRequested' AND json_extract(payload,'$.kind')='document';
--> statement-breakpoint
UPDATE workflow_events SET type='DocumentGenerationFailed',payload=json_set(json_remove(payload,'$.kind','$.projectId'),'$.type','DocumentGenerationFailed')
WHERE type='MaterialGenerationFailed' AND json_extract(payload,'$.kind')='document';
--> statement-breakpoint
DROP TABLE cutover_selection_references;
--> statement-breakpoint
CREATE TRIGGER session_run_contexts_immutable BEFORE UPDATE ON session_run_contexts BEGIN SELECT RAISE(ABORT,'captured session context is immutable'); END;
--> statement-breakpoint
UPDATE study_documents SET creation_intent=json_quote('domain_cutover') WHERE id IN(SELECT document_id FROM legacy_document_materials)
AND creation_intent IS NOT NULL AND json_type(creation_intent) IS NOT 'text';
--> statement-breakpoint
UPDATE study_document_edit_receipts SET intent=json_quote('domain_cutover') WHERE json_type(intent) IS NOT 'text'
AND document_id IN(SELECT document_id FROM legacy_document_materials);
--> statement-breakpoint
UPDATE study_document_proposal_receipts SET intent=json_quote('domain_cutover') WHERE json_type(intent) IS NOT 'text'
AND request_id IN(SELECT request_id FROM document_proposals);
--> statement-breakpoint
CREATE TRIGGER material_evidence_inputs_owner BEFORE INSERT ON material_evidence_inputs
WHEN (NEW.version_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM material_versions v WHERE v.id=NEW.version_id AND v.status='draft' AND v.kind IN ('diagram','quiz','flashcards')))
 OR (NEW.request_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM material_generation_requests r WHERE r.id=NEW.request_id AND r.cancelled=0 AND r.result_version_id IS NULL
 AND json_extract(r.payload,'$.inputs['||NEW.position||'].kind')=CASE WHEN NEW.document_version_id IS NULL THEN 'source' ELSE 'document' END
 AND json_extract(r.payload,'$.inputs['||NEW.position||'].versionId') IS CASE WHEN NEW.document_version_id IS NULL THEN NULL ELSE CAST(NEW.document_version_id AS TEXT) END
 AND json_extract(r.payload,'$.inputs['||NEW.position||'].sourceId') IS CASE WHEN NEW.source_id IS NULL THEN NULL ELSE CAST(NEW.source_id AS TEXT) END
 AND json_extract(r.payload,'$.inputs['||NEW.position||'].revision') IS CASE WHEN NEW.source_revision IS NULL THEN NULL ELSE CAST(NEW.source_revision AS TEXT) END
 AND json_extract(r.payload,'$.inputs['||NEW.position||'].snapshotId') IS CASE WHEN NEW.source_snapshot_id IS NULL THEN NULL ELSE CAST(NEW.source_snapshot_id AS TEXT) END))
BEGIN SELECT RAISE(ABORT,'exact learning input does not match its owner'); END;
--> statement-breakpoint
CREATE TRIGGER material_evidence_citations_draft BEFORE INSERT ON material_evidence_citations
WHEN NOT EXISTS(SELECT 1 FROM material_versions WHERE id=NEW.version_id AND status='draft')
BEGIN SELECT RAISE(ABORT,'published learning citations are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_versions_sealed_update BEFORE UPDATE ON study_document_versions
WHEN OLD.status='published' BEGIN SELECT RAISE(ABORT, 'published document versions are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_versions_draft_identity BEFORE UPDATE ON study_document_versions
WHEN NEW.id!=OLD.id OR NEW.document_id!=OLD.document_id OR NEW.number!=OLD.number
 OR NEW.content_snapshot_id!=OLD.content_snapshot_id OR NEW.created_at!=OLD.created_at
BEGIN SELECT RAISE(ABORT, 'document version identity is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_parents_insert BEFORE INSERT ON study_document_version_parents
WHEN NOT EXISTS (SELECT 1 FROM study_document_versions child JOIN study_document_versions parent
 ON parent.id=NEW.parent_version_id WHERE child.id=NEW.version_id AND child.status='draft'
 AND parent.status='published' AND child.document_id=NEW.document_id AND parent.document_id=NEW.document_id
 AND parent.number<child.number)
BEGIN SELECT RAISE(ABORT, 'document ancestry requires an earlier published version of the same document'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_versions_publish BEFORE UPDATE OF status ON study_document_versions
WHEN NEW.status='published' AND (
 NOT EXISTS (SELECT 1 FROM blocks WHERE document_id=NEW.content_snapshot_id)
 OR NOT EXISTS (SELECT 1 FROM content_snapshots WHERE id=NEW.content_snapshot_id AND source_id IS NULL)
 OR EXISTS (SELECT 1 FROM material_document_versions WHERE document_id=NEW.content_snapshot_id)
 OR EXISTS (SELECT 1 FROM study_document_version_parents p JOIN study_document_versions v ON v.id=p.parent_version_id
  WHERE p.version_id=NEW.id AND (v.status!='published' OR v.number>=NEW.number OR v.document_id!=NEW.document_id))
) BEGIN SELECT RAISE(ABORT, 'document publication requires complete owned content and published ancestry'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_input_publication BEFORE UPDATE OF status ON study_document_versions
WHEN NEW.status='published' AND EXISTS(SELECT 1 FROM study_document_inputs i JOIN study_document_versions target ON target.id=i.document_version_id WHERE i.version_id=NEW.id AND (target.status!='published' OR target.id=NEW.id OR EXISTS(SELECT 1 FROM study_document_retirements r WHERE r.version_id=target.id)))
BEGIN SELECT RAISE(ABORT,'authored publication requires retained published exact document inputs'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_annotation_head BEFORE UPDATE ON study_document_annotations
WHEN NEW.id!=OLD.id OR NEW.document_id!=OLD.document_id OR NEW.revision!=OLD.revision+1 OR NOT EXISTS(SELECT 1 FROM study_document_annotation_revisions WHERE annotation_id=NEW.id AND revision=NEW.revision)
BEGIN SELECT RAISE(ABORT,'annotation head requires exact next revision'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_annotation_revision_owner BEFORE INSERT ON study_document_annotation_revisions
WHEN NOT EXISTS(SELECT 1 FROM study_document_annotations a JOIN study_document_versions v ON v.id=NEW.version_id AND v.document_id=a.document_id WHERE a.id=NEW.annotation_id AND a.document_id=NEW.document_id AND v.status='published' AND (NEW.revision=a.revision+1 OR (NEW.revision=1 AND a.revision=1))
AND CAST(json_extract(NEW.payload,'$.id') AS INTEGER)=NEW.annotation_id AND CAST(json_extract(NEW.payload,'$.revision') AS INTEGER)=NEW.revision AND CAST(json_extract(NEW.payload,'$.target.documentId') AS INTEGER)=NEW.document_id AND CAST(json_extract(NEW.payload,'$.target.range.versionId') AS INTEGER)=NEW.version_id AND CAST(json_extract(NEW.payload,'$.target.range.snapshotId') AS INTEGER)=NEW.snapshot_id)
BEGIN SELECT RAISE(ABORT,'annotation revision requires exact published ownership'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_annotation_revisions_update BEFORE UPDATE ON study_document_annotation_revisions BEGIN SELECT RAISE(ABORT,'annotation revisions are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_edit_receipts_update BEFORE UPDATE ON study_document_edit_receipts
BEGIN SELECT RAISE(ABORT, 'document edit receipts are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_proposal_receipts_immutable_update BEFORE UPDATE ON study_document_proposal_receipts BEGIN SELECT RAISE(ABORT,'document evidence is immutable'); END;
--> statement-breakpoint
DROP TRIGGER study_document_retirement_dependencies;
--> statement-breakpoint
CREATE TRIGGER study_document_retirement_dependencies BEFORE INSERT ON study_document_retirements
WHEN EXISTS(SELECT 1 FROM study_document_inputs i JOIN study_document_versions v ON v.id=i.version_id JOIN study_document_versions target ON target.id=NEW.version_id WHERE i.document_version_id=NEW.version_id AND v.document_id!=target.document_id AND NOT EXISTS(SELECT 1 FROM study_document_retirements r WHERE r.version_id=v.id))
 OR EXISTS(SELECT 1 FROM study_document_inputs WHERE document_version_id=NEW.version_id AND request_id IS NOT NULL)
 OR EXISTS(SELECT 1 FROM session_context_documents WHERE version_id=NEW.version_id)
 OR EXISTS(SELECT 1 FROM material_evidence_inputs WHERE document_version_id=NEW.version_id)
 OR EXISTS(SELECT 1 FROM learning_practice_inputs WHERE document_version_id=NEW.version_id)
BEGIN SELECT RAISE(ABORT,'exact authored inputs protect referenced bodies'); END;
--> statement-breakpoint
DROP TABLE cutover_document_number_offset;
--> statement-breakpoint
DROP TABLE cutover_annotation_streams;
--> statement-breakpoint
DROP TABLE cutover_new_document_inputs;
--> statement-breakpoint
DROP TABLE cutover_document_numbers;
--> statement-breakpoint
DROP TABLE cutover_new_document_versions;
--> statement-breakpoint
DROP TABLE cutover_new_document_owners;
--> statement-breakpoint
DROP TRIGGER "authored_source_blocks_delete";
--> statement-breakpoint
DROP TRIGGER "authored_source_blocks_insert";
--> statement-breakpoint
DROP TRIGGER "authored_source_blocks_update";
--> statement-breakpoint
DROP TRIGGER "authored_source_content_snapshots_delete";
--> statement-breakpoint
DROP TRIGGER "authored_source_content_snapshots_update";
--> statement-breakpoint
DROP TRIGGER "authored_source_revision_update";
--> statement-breakpoint
DROP TRIGGER "blocks_history_insert";
--> statement-breakpoint
DROP TRIGGER "blocks_history_update";
--> statement-breakpoint
DROP TRIGGER "blocks_material_delete";
--> statement-breakpoint
DROP TRIGGER "blocks_material_insert";
--> statement-breakpoint
DROP TRIGGER "blocks_material_update";
--> statement-breakpoint
DROP TRIGGER "blocks_retained_edit_delete";
--> statement-breakpoint
DROP TRIGGER "blocks_retained_edit_insert";
--> statement-breakpoint
DROP TRIGGER "blocks_retained_edit_update";
--> statement-breakpoint
DROP TRIGGER "catalog_native_material_delete";
--> statement-breakpoint
DROP TRIGGER "catalog_native_material_update";
--> statement-breakpoint
DROP TRIGGER "catalog_native_question_delete";
--> statement-breakpoint
DROP TRIGGER "catalog_native_version_delete";
--> statement-breakpoint
DROP TRIGGER "catalog_native_version_insert";
--> statement-breakpoint
DROP TRIGGER "catalog_native_version_update";
--> statement-breakpoint
DROP TRIGGER "catalog_project_delete";
--> statement-breakpoint
DROP TRIGGER "catalog_project_insert";
--> statement-breakpoint
DROP TRIGGER "catalog_project_update";
--> statement-breakpoint
DROP TRIGGER "catalog_session_delete";
--> statement-breakpoint
DROP TRIGGER "catalog_session_insert";
--> statement-breakpoint
DROP TRIGGER "catalog_session_update";
--> statement-breakpoint
DROP TRIGGER "catalog_source_delete";
--> statement-breakpoint
DROP TRIGGER "catalog_source_insert";
--> statement-breakpoint
DROP TRIGGER "catalog_source_update";
--> statement-breakpoint
DROP TRIGGER "chunks_fts_ad";
--> statement-breakpoint
DROP TRIGGER "chunks_fts_ai";
--> statement-breakpoint
DROP TRIGGER "chunks_fts_au";
--> statement-breakpoint
DROP TRIGGER "conversation_history_intents_delete";
--> statement-breakpoint
DROP TRIGGER "conversation_history_intents_update";
--> statement-breakpoint
DROP TRIGGER "conversation_history_intents_valid";
--> statement-breakpoint
DROP TRIGGER "conversation_recording_posts_immutable";
--> statement-breakpoint
DROP TRIGGER "conversation_recording_posts_retain";
--> statement-breakpoint
DROP TRIGGER "conversation_recording_posts_validate_insert";
--> statement-breakpoint
DROP TRIGGER "conversation_reply_requests_history_insert";
--> statement-breakpoint
DROP TRIGGER "conversation_reply_requests_history_update";
--> statement-breakpoint
DROP TRIGGER "conversation_reply_sources_capture";
--> statement-breakpoint
DROP TRIGGER "conversation_reply_sources_immutable";
--> statement-breakpoint
DROP TRIGGER "conversation_reply_sources_retained";
--> statement-breakpoint
DROP TRIGGER "document_asset_delete_frozen";
--> statement-breakpoint
DROP TRIGGER "document_asset_deleted_acquisition";
--> statement-breakpoint
DROP TRIGGER "document_asset_insert";
--> statement-breakpoint
DROP TRIGGER "document_asset_kind";
--> statement-breakpoint
DROP TRIGGER "document_asset_snapshot_delete";
--> statement-breakpoint
DROP TRIGGER "document_asset_snapshot_update";
--> statement-breakpoint
DROP TRIGGER "document_asset_update";
--> statement-breakpoint
DROP TRIGGER "document_asset_update_forbidden";
--> statement-breakpoint
DROP TRIGGER "document_assets_retained_edit_delete";
--> statement-breakpoint
DROP TRIGGER "document_edit_receipts_delete_immutable";
--> statement-breakpoint
DROP TRIGGER "document_edit_receipts_update_immutable";
--> statement-breakpoint
DROP TRIGGER "document_proposal_action_active";
--> statement-breakpoint
DROP TRIGGER "document_proposal_receipts_delete_immutable";
--> statement-breakpoint
DROP TRIGGER "document_proposal_receipts_update_immutable";
--> statement-breakpoint
DROP TRIGGER "document_proposal_session_active";
--> statement-breakpoint
DROP TRIGGER "document_proposals_delete_immutable";
--> statement-breakpoint
DROP TRIGGER "document_proposals_update_immutable";
--> statement-breakpoint
DROP TRIGGER "documents_history_insert";
--> statement-breakpoint
DROP TRIGGER "documents_history_update";
--> statement-breakpoint
DROP TRIGGER "documents_material_delete";
--> statement-breakpoint
DROP TRIGGER "documents_material_insert";
--> statement-breakpoint
DROP TRIGGER "documents_material_update";
--> statement-breakpoint
DROP TRIGGER "documents_retained_edit_delete";
--> statement-breakpoint
DROP TRIGGER "documents_retained_edit_insert";
--> statement-breakpoint
DROP TRIGGER "documents_retained_edit_update";
--> statement-breakpoint
DROP TRIGGER "generation_history_publication";
--> statement-breakpoint
DROP TRIGGER "history_annotation_capture";
--> statement-breakpoint
DROP TRIGGER "history_assessment_capture";
--> statement-breakpoint
DROP TRIGGER "history_proposal_action";
--> statement-breakpoint
DROP TRIGGER "history_proposal_capture";
--> statement-breakpoint
DROP TRIGGER "history_reply_publication";
--> statement-breakpoint
DROP TRIGGER "import_blocks_delete_frozen";
--> statement-breakpoint
DROP TRIGGER "import_blocks_insert_frozen";
--> statement-breakpoint
DROP TRIGGER "import_blocks_update_frozen";
--> statement-breakpoint
DROP TRIGGER "import_document_source_insert";
--> statement-breakpoint
DROP TRIGGER "import_document_source_update";
--> statement-breakpoint
DROP TRIGGER "import_documents_delete_frozen";
--> statement-breakpoint
DROP TRIGGER "import_documents_insert_frozen";
--> statement-breakpoint
DROP TRIGGER "import_documents_update_frozen";
--> statement-breakpoint
DROP TRIGGER "learning_practice_answer_immutable";
--> statement-breakpoint
DROP TRIGGER "learning_practice_control_identity";
--> statement-breakpoint
DROP TRIGGER "learning_practice_control_retained";
--> statement-breakpoint
DROP TRIGGER "learning_practice_failure_clear";
--> statement-breakpoint
DROP TRIGGER "learning_practice_inputs_available";
--> statement-breakpoint
DROP TRIGGER "learning_practice_inputs_capture";
--> statement-breakpoint
DROP TRIGGER "learning_practice_inputs_immutable";
--> statement-breakpoint
DROP TRIGGER "learning_practice_inputs_retained";
--> statement-breakpoint
DROP TRIGGER "learning_practice_retry_capture";
--> statement-breakpoint
DROP TRIGGER "learning_practice_retry_transition";
--> statement-breakpoint
DROP TRIGGER "learning_practice_selection_delete";
--> statement-breakpoint
DROP TRIGGER "learning_practice_selection_insert";
--> statement-breakpoint
DROP TRIGGER "learning_practice_selection_update";
--> statement-breakpoint
DROP TRIGGER "learning_practice_slot_answer";
--> statement-breakpoint
DROP TRIGGER "learning_practice_slot_capture";
--> statement-breakpoint
DROP TRIGGER "learning_practice_slot_immutable";
--> statement-breakpoint
DROP TRIGGER "learning_practice_slot_publication";
--> statement-breakpoint
DROP TRIGGER "learning_practice_slot_retained";
--> statement-breakpoint
DROP TRIGGER "material_annotation_deletion_insert";
--> statement-breakpoint
DROP TRIGGER "material_annotation_head_valid";
--> statement-breakpoint
DROP TRIGGER "material_annotation_retained";
--> statement-breakpoint
DROP TRIGGER "material_annotation_revision_immutable";
--> statement-breakpoint
DROP TRIGGER "material_annotation_revision_retained";
--> statement-breakpoint
DROP TRIGGER "material_annotation_revision_valid";
--> statement-breakpoint
DROP TRIGGER "material_assessment_deletion_insert";
--> statement-breakpoint
DROP TRIGGER "material_attempt_complete_answers";
--> statement-breakpoint
DROP TRIGGER "material_attempt_delete";
--> statement-breakpoint
DROP TRIGGER "material_attempt_identity";
--> statement-breakpoint
DROP TRIGGER "material_attempt_published";
--> statement-breakpoint
DROP TRIGGER "material_audio_versions_delete_draft";
--> statement-breakpoint
DROP TRIGGER "material_audio_versions_deletion_insert";
--> statement-breakpoint
DROP TRIGGER "material_audio_versions_history_insert";
--> statement-breakpoint
DROP TRIGGER "material_audio_versions_history_update";
--> statement-breakpoint
DROP TRIGGER "material_audio_versions_insert_draft";
--> statement-breakpoint
DROP TRIGGER "material_audio_versions_update_draft";
--> statement-breakpoint
DROP TRIGGER "material_card_identity_update";
--> statement-breakpoint
DROP TRIGGER "material_card_reviews_history_insert";
--> statement-breakpoint
DROP TRIGGER "material_citation_assessment_immutable";
--> statement-breakpoint
DROP TRIGGER "material_citation_assessment_retained";
--> statement-breakpoint
DROP TRIGGER "material_citation_assessment_valid";
--> statement-breakpoint
DROP TRIGGER "material_deletion_blocks_insert";
--> statement-breakpoint
DROP TRIGGER "material_deletion_blocks_update";
--> statement-breakpoint
DROP TRIGGER "material_deletion_context_insert";
--> statement-breakpoint
DROP TRIGGER "material_deletion_documents_insert";
--> statement-breakpoint
DROP TRIGGER "material_deletion_documents_update";
--> statement-breakpoint
DROP TRIGGER "material_deletion_generation_input";
--> statement-breakpoint
DROP TRIGGER "material_deletion_identity";
--> statement-breakpoint
DROP TRIGGER "material_deletion_input_insert";
--> statement-breakpoint
DROP TRIGGER "material_deletion_member_valid";
--> statement-breakpoint
DROP TRIGGER "material_deletion_members_delete_retained";
--> statement-breakpoint
DROP TRIGGER "material_deletion_members_update_retained";
--> statement-breakpoint
DROP TRIGGER "material_deletion_proposal_action";
--> statement-breakpoint
DROP TRIGGER "material_deletion_proposal_insert";
--> statement-breakpoint
DROP TRIGGER "material_deletion_publication";
--> statement-breakpoint
DROP TRIGGER "material_deletion_reply_insert";
--> statement-breakpoint
DROP TRIGGER "material_deletion_reply_publication";
--> statement-breakpoint
DROP TRIGGER "material_deletion_reply_update";
--> statement-breakpoint
DROP TRIGGER "material_deletion_request_valid";
--> statement-breakpoint
DROP TRIGGER "material_deletion_requests_delete_retained";
--> statement-breakpoint
DROP TRIGGER "material_deletion_requests_update_retained";
--> statement-breakpoint
DROP TRIGGER "material_deletion_retained";
--> statement-breakpoint
DROP TRIGGER "material_deletion_search";
--> statement-breakpoint
DROP TRIGGER "material_deletion_source_processing_insert";
--> statement-breakpoint
DROP TRIGGER "material_deletion_source_processing_update";
--> statement-breakpoint
DROP TRIGGER "material_deletion_title";
--> statement-breakpoint
DROP TRIGGER "material_deletion_version_insert";
--> statement-breakpoint
DROP TRIGGER "material_diagram_versions_delete_draft";
--> statement-breakpoint
DROP TRIGGER "material_diagram_versions_deletion_insert";
--> statement-breakpoint
DROP TRIGGER "material_diagram_versions_history_insert";
--> statement-breakpoint
DROP TRIGGER "material_diagram_versions_history_update";
--> statement-breakpoint
DROP TRIGGER "material_diagram_versions_insert_draft";
--> statement-breakpoint
DROP TRIGGER "material_diagram_versions_update_draft";
--> statement-breakpoint
DROP TRIGGER "material_document_canonical_shape";
--> statement-breakpoint
DROP TRIGGER "material_document_cleanup";
--> statement-breakpoint
DROP TRIGGER "material_document_deleted_assets_insert";
--> statement-breakpoint
DROP TRIGGER "material_document_deleted_assets_publish";
--> statement-breakpoint
DROP TRIGGER "material_document_deleted_assets_update";
--> statement-breakpoint
DROP TRIGGER "material_document_versions_delete_draft";
--> statement-breakpoint
DROP TRIGGER "material_document_versions_deletion_insert";
--> statement-breakpoint
DROP TRIGGER "material_document_versions_history_insert";
--> statement-breakpoint
DROP TRIGGER "material_document_versions_history_update";
--> statement-breakpoint
DROP TRIGGER "material_document_versions_insert_draft";
--> statement-breakpoint
DROP TRIGGER "material_document_versions_retained_edit_delete";
--> statement-breakpoint
DROP TRIGGER "material_document_versions_retained_edit_insert";
--> statement-breakpoint
DROP TRIGGER "material_document_versions_retained_edit_update";
--> statement-breakpoint
DROP TRIGGER "material_document_versions_update_draft";
--> statement-breakpoint
DROP TRIGGER "material_evidence_citations_draft";
--> statement-breakpoint
DROP TRIGGER "material_evidence_citations_immutable";
--> statement-breakpoint
DROP TRIGGER "material_evidence_citations_retained";
--> statement-breakpoint
DROP TRIGGER "material_evidence_inputs_available";
--> statement-breakpoint
DROP TRIGGER "material_evidence_inputs_immutable";
--> statement-breakpoint
DROP TRIGGER "material_evidence_inputs_owner";
--> statement-breakpoint
DROP TRIGGER "material_evidence_inputs_retained";
--> statement-breakpoint
DROP TRIGGER "material_file_versions_delete_draft";
--> statement-breakpoint
DROP TRIGGER "material_file_versions_deletion_insert";
--> statement-breakpoint
DROP TRIGGER "material_file_versions_history_insert";
--> statement-breakpoint
DROP TRIGGER "material_file_versions_history_update";
--> statement-breakpoint
DROP TRIGGER "material_file_versions_insert_draft";
--> statement-breakpoint
DROP TRIGGER "material_file_versions_update_draft";
--> statement-breakpoint
DROP TRIGGER "material_flashcard_entries_delete_draft";
--> statement-breakpoint
DROP TRIGGER "material_flashcard_entries_deletion_insert";
--> statement-breakpoint
DROP TRIGGER "material_flashcard_entries_history_insert";
--> statement-breakpoint
DROP TRIGGER "material_flashcard_entries_history_update";
--> statement-breakpoint
DROP TRIGGER "material_flashcard_entries_insert_draft";
--> statement-breakpoint
DROP TRIGGER "material_flashcard_entries_update_draft";
--> statement-breakpoint
DROP TRIGGER "material_flashcard_versions_delete_draft";
--> statement-breakpoint
DROP TRIGGER "material_flashcard_versions_deletion_insert";
--> statement-breakpoint
DROP TRIGGER "material_flashcard_versions_history_insert";
--> statement-breakpoint
DROP TRIGGER "material_flashcard_versions_history_update";
--> statement-breakpoint
DROP TRIGGER "material_flashcard_versions_insert_draft";
--> statement-breakpoint
DROP TRIGGER "material_flashcard_versions_update_draft";
--> statement-breakpoint
DROP TRIGGER "material_generation_binding_immutable";
--> statement-breakpoint
DROP TRIGGER "material_generation_cancel_fence";
--> statement-breakpoint
DROP TRIGGER "material_generation_input_captured";
--> statement-breakpoint
DROP TRIGGER "material_generation_input_immutable";
--> statement-breakpoint
DROP TRIGGER "material_generation_input_retained";
--> statement-breakpoint
DROP TRIGGER "material_generation_inputs_history_insert";
--> statement-breakpoint
DROP TRIGGER "material_generation_intent_immutable";
--> statement-breakpoint
DROP TRIGGER "material_generation_intent_insert";
--> statement-breakpoint
DROP TRIGGER "material_generation_intent_retained";
--> statement-breakpoint
DROP TRIGGER "material_generation_publication_scope";
--> statement-breakpoint
DROP TRIGGER "material_generation_publish";
--> statement-breakpoint
DROP TRIGGER "material_generation_question_publication";
--> statement-breakpoint
DROP TRIGGER "material_generation_question_specification";
--> statement-breakpoint
DROP TRIGGER "material_generation_receipt_scope";
--> statement-breakpoint
DROP TRIGGER "material_generation_receipt_valid";
--> statement-breakpoint
DROP TRIGGER "material_generation_request_scope";
--> statement-breakpoint
DROP TRIGGER "material_generation_result_immutable";
--> statement-breakpoint
DROP TRIGGER "material_generation_scope_immutable";
--> statement-breakpoint
DROP TRIGGER "material_generation_scope_retained";
--> statement-breakpoint
DROP TRIGGER "material_generation_session_publication";
--> statement-breakpoint
DROP TRIGGER "material_generation_session_scope";
--> statement-breakpoint
DROP TRIGGER "material_history_members_delete";
--> statement-breakpoint
DROP TRIGGER "material_history_members_update";
--> statement-breakpoint
DROP TRIGGER "material_history_members_valid";
--> statement-breakpoint
DROP TRIGGER "material_history_prunes_identity";
--> statement-breakpoint
DROP TRIGGER "material_history_prunes_retained";
--> statement-breakpoint
DROP TRIGGER "material_history_prunes_valid";
--> statement-breakpoint
DROP TRIGGER "material_history_requests_delete";
--> statement-breakpoint
DROP TRIGGER "material_history_requests_update";
--> statement-breakpoint
DROP TRIGGER "material_history_requests_valid";
--> statement-breakpoint
DROP TRIGGER "material_identity_update";
--> statement-breakpoint
DROP TRIGGER "material_image_versions_delete_draft";
--> statement-breakpoint
DROP TRIGGER "material_image_versions_deletion_insert";
--> statement-breakpoint
DROP TRIGGER "material_image_versions_history_insert";
--> statement-breakpoint
DROP TRIGGER "material_image_versions_history_update";
--> statement-breakpoint
DROP TRIGGER "material_image_versions_insert_draft";
--> statement-breakpoint
DROP TRIGGER "material_image_versions_update_draft";
--> statement-breakpoint
DROP TRIGGER "material_import_document_canonical_shape";
--> statement-breakpoint
DROP TRIGGER "material_import_document_nonempty";
--> statement-breakpoint
DROP TRIGGER "material_import_identity_delete";
--> statement-breakpoint
DROP TRIGGER "material_import_identity_insert";
--> statement-breakpoint
DROP TRIGGER "material_import_identity_update";
--> statement-breakpoint
DROP TRIGGER "material_import_snapshot_binding_insert";
--> statement-breakpoint
DROP TRIGGER "material_import_snapshot_binding_update";
--> statement-breakpoint
DROP TRIGGER "material_link_versions_delete_draft";
--> statement-breakpoint
DROP TRIGGER "material_link_versions_deletion_insert";
--> statement-breakpoint
DROP TRIGGER "material_link_versions_history_insert";
--> statement-breakpoint
DROP TRIGGER "material_link_versions_history_update";
--> statement-breakpoint
DROP TRIGGER "material_link_versions_insert_draft";
--> statement-breakpoint
DROP TRIGGER "material_link_versions_update_draft";
--> statement-breakpoint
DROP TRIGGER "material_publish_audio";
--> statement-breakpoint
DROP TRIGGER "material_publish_document";
--> statement-breakpoint
DROP TRIGGER "material_publish_file";
--> statement-breakpoint
DROP TRIGGER "material_publish_flashcards";
--> statement-breakpoint
DROP TRIGGER "material_publish_image";
--> statement-breakpoint
DROP TRIGGER "material_publish_link";
--> statement-breakpoint
DROP TRIGGER "material_publish_quiz";
--> statement-breakpoint
DROP TRIGGER "material_publish_video";
--> statement-breakpoint
DROP TRIGGER "material_quiz_attempts_history_insert";
--> statement-breakpoint
DROP TRIGGER "material_quiz_choices_delete_draft";
--> statement-breakpoint
DROP TRIGGER "material_quiz_choices_insert_draft";
--> statement-breakpoint
DROP TRIGGER "material_quiz_choices_update_draft";
--> statement-breakpoint
DROP TRIGGER "material_quiz_open_answers_delete_draft";
--> statement-breakpoint
DROP TRIGGER "material_quiz_open_answers_insert_draft";
--> statement-breakpoint
DROP TRIGGER "material_quiz_open_answers_update_draft";
--> statement-breakpoint
DROP TRIGGER "material_quiz_questions_delete_draft";
--> statement-breakpoint
DROP TRIGGER "material_quiz_questions_deletion_insert";
--> statement-breakpoint
DROP TRIGGER "material_quiz_questions_history_insert";
--> statement-breakpoint
DROP TRIGGER "material_quiz_questions_history_update";
--> statement-breakpoint
DROP TRIGGER "material_quiz_questions_insert_draft";
--> statement-breakpoint
DROP TRIGGER "material_quiz_questions_update_draft";
--> statement-breakpoint
DROP TRIGGER "material_quiz_responses_completed_delete";
--> statement-breakpoint
DROP TRIGGER "material_quiz_responses_completed_insert";
--> statement-breakpoint
DROP TRIGGER "material_quiz_responses_completed_update";
--> statement-breakpoint
DROP TRIGGER "material_quiz_selections_completed_delete";
--> statement-breakpoint
DROP TRIGGER "material_quiz_selections_completed_insert";
--> statement-breakpoint
DROP TRIGGER "material_quiz_selections_completed_update";
--> statement-breakpoint
DROP TRIGGER "material_quiz_versions_delete_draft";
--> statement-breakpoint
DROP TRIGGER "material_quiz_versions_deletion_insert";
--> statement-breakpoint
DROP TRIGGER "material_quiz_versions_history_insert";
--> statement-breakpoint
DROP TRIGGER "material_quiz_versions_history_update";
--> statement-breakpoint
DROP TRIGGER "material_quiz_versions_insert_draft";
--> statement-breakpoint
DROP TRIGGER "material_quiz_versions_update_draft";
--> statement-breakpoint
DROP TRIGGER "material_review_delete";
--> statement-breakpoint
DROP TRIGGER "material_review_published";
--> statement-breakpoint
DROP TRIGGER "material_review_update";
--> statement-breakpoint
DROP TRIGGER "material_selection_single_insert";
--> statement-breakpoint
DROP TRIGGER "material_selection_single_update";
--> statement-breakpoint
DROP TRIGGER "material_source_snapshots_deletion_insert";
--> statement-breakpoint
DROP TRIGGER "material_source_snapshots_history_insert";
--> statement-breakpoint
DROP TRIGGER "material_source_snapshots_history_update";
--> statement-breakpoint
DROP TRIGGER "material_source_snapshots_match_insert";
--> statement-breakpoint
DROP TRIGGER "material_source_snapshots_match_update";
--> statement-breakpoint
DROP TRIGGER "material_source_snapshots_published_delete";
--> statement-breakpoint
DROP TRIGGER "material_source_snapshots_published_insert";
--> statement-breakpoint
DROP TRIGGER "material_source_snapshots_published_update";
--> statement-breakpoint
DROP TRIGGER "material_source_snapshots_retained_edit_delete";
--> statement-breakpoint
DROP TRIGGER "material_source_snapshots_retained_edit_insert";
--> statement-breakpoint
DROP TRIGGER "material_source_snapshots_retained_edit_update";
--> statement-breakpoint
DROP TRIGGER "material_version_citations_delete_draft";
--> statement-breakpoint
DROP TRIGGER "material_version_citations_deletion_insert";
--> statement-breakpoint
DROP TRIGGER "material_version_citations_history_insert";
--> statement-breakpoint
DROP TRIGGER "material_version_citations_history_update";
--> statement-breakpoint
DROP TRIGGER "material_version_citations_insert_draft";
--> statement-breakpoint
DROP TRIGGER "material_version_citations_retained_edit_delete";
--> statement-breakpoint
DROP TRIGGER "material_version_citations_retained_edit_insert";
--> statement-breakpoint
DROP TRIGGER "material_version_citations_retained_edit_update";
--> statement-breakpoint
DROP TRIGGER "material_version_citations_update_draft";
--> statement-breakpoint
DROP TRIGGER "material_version_inputs_delete_draft";
--> statement-breakpoint
DROP TRIGGER "material_version_inputs_history_capture";
--> statement-breakpoint
DROP TRIGGER "material_version_inputs_history_insert";
--> statement-breakpoint
DROP TRIGGER "material_version_inputs_history_update";
--> statement-breakpoint
DROP TRIGGER "material_version_inputs_insert_draft";
--> statement-breakpoint
DROP TRIGGER "material_version_inputs_retained_edit_delete";
--> statement-breakpoint
DROP TRIGGER "material_version_inputs_retained_edit_insert";
--> statement-breakpoint
DROP TRIGGER "material_version_inputs_retained_edit_update";
--> statement-breakpoint
DROP TRIGGER "material_version_inputs_target_insert";
--> statement-breakpoint
DROP TRIGGER "material_version_inputs_target_update";
--> statement-breakpoint
DROP TRIGGER "material_version_inputs_update_draft";
--> statement-breakpoint
DROP TRIGGER "material_version_parents_delete_draft";
--> statement-breakpoint
DROP TRIGGER "material_version_parents_history_capture";
--> statement-breakpoint
DROP TRIGGER "material_version_parents_history_insert";
--> statement-breakpoint
DROP TRIGGER "material_version_parents_history_update";
--> statement-breakpoint
DROP TRIGGER "material_version_parents_insert_draft";
--> statement-breakpoint
DROP TRIGGER "material_version_parents_retained_edit_delete";
--> statement-breakpoint
DROP TRIGGER "material_version_parents_retained_edit_insert";
--> statement-breakpoint
DROP TRIGGER "material_version_parents_retained_edit_update";
--> statement-breakpoint
DROP TRIGGER "material_version_parents_target_insert";
--> statement-breakpoint
DROP TRIGGER "material_version_parents_target_update";
--> statement-breakpoint
DROP TRIGGER "material_version_parents_update_draft";
--> statement-breakpoint
DROP TRIGGER "material_versions_delete_frozen";
--> statement-breakpoint
DROP TRIGGER "material_versions_frozen";
--> statement-breakpoint
DROP TRIGGER "material_versions_publish_payload";
--> statement-breakpoint
DROP TRIGGER "material_versions_retained_edit_delete";
--> statement-breakpoint
DROP TRIGGER "material_versions_retained_edit_insert";
--> statement-breakpoint
DROP TRIGGER "material_versions_retained_edit_update";
--> statement-breakpoint
DROP TRIGGER "material_versions_start_draft";
--> statement-breakpoint
DROP TRIGGER "material_video_versions_delete_draft";
--> statement-breakpoint
DROP TRIGGER "material_video_versions_deletion_insert";
--> statement-breakpoint
DROP TRIGGER "material_video_versions_history_insert";
--> statement-breakpoint
DROP TRIGGER "material_video_versions_history_update";
--> statement-breakpoint
DROP TRIGGER "material_video_versions_insert_draft";
--> statement-breakpoint
DROP TRIGGER "material_video_versions_update_draft";
--> statement-breakpoint
DROP TRIGGER "message_fts_ad";
--> statement-breakpoint
DROP TRIGGER "message_fts_ai";
--> statement-breakpoint
DROP TRIGGER "message_fts_finish";
--> statement-breakpoint
DROP TRIGGER "recording_chunks_captured_delete";
--> statement-breakpoint
DROP TRIGGER "recording_chunks_captured_insert";
--> statement-breakpoint
DROP TRIGGER "recording_chunks_captured_update";
--> statement-breakpoint
DROP TRIGGER "recording_posts_immutable";
--> statement-breakpoint
DROP TRIGGER "recording_posts_result_valid";
--> statement-breakpoint
DROP TRIGGER "recording_posts_retain";
--> statement-breakpoint
DROP TRIGGER "recording_posts_validate_insert";
--> statement-breakpoint
DROP TRIGGER "recordings_captured_update";
--> statement-breakpoint
DROP TRIGGER "retired_document_proposal_receipts_delete_retained";
--> statement-breakpoint
DROP TRIGGER "retired_document_proposal_receipts_update_retained";
--> statement-breakpoint
DROP TRIGGER "retired_event_insert";
--> statement-breakpoint
DROP TRIGGER "retired_event_payload";
--> statement-breakpoint
DROP TRIGGER "retired_execution_insert";
--> statement-breakpoint
DROP TRIGGER "retired_execution_payload";
--> statement-breakpoint
DROP TRIGGER "retired_generation_publication";
--> statement-breakpoint
DROP TRIGGER "retired_proposal_receipt_valid";
--> statement-breakpoint
DROP TRIGGER "session_deletion_correlations_delete_retained";
--> statement-breakpoint
DROP TRIGGER "session_deletion_correlations_update_retained";
--> statement-breakpoint
DROP TRIGGER "session_deletion_identity";
--> statement-breakpoint
DROP TRIGGER "session_deletion_retained";
--> statement-breakpoint
DROP TRIGGER "session_generation_retirement_valid";
--> statement-breakpoint
DROP TRIGGER "session_generation_retirements_delete_retained";
--> statement-breakpoint
DROP TRIGGER "session_generation_retirements_update_retained";
--> statement-breakpoint
DROP TRIGGER "session_history_intent_insert";
--> statement-breakpoint
DROP TRIGGER "session_id_not_reusable";
--> statement-breakpoint
DROP TRIGGER "session_retired_intent_recapture";
--> statement-breakpoint
DROP TRIGGER "session_retired_intents_delete";
--> statement-breakpoint
DROP TRIGGER "session_retired_intents_owner";
--> statement-breakpoint
DROP TRIGGER "session_retired_intents_update";
--> statement-breakpoint
DROP TRIGGER "session_run_contexts_history_insert";
--> statement-breakpoint
DROP TRIGGER "session_run_contexts_history_update";
--> statement-breakpoint
DROP TRIGGER "session_run_contexts_immutable";
--> statement-breakpoint
DROP TRIGGER "sessions_history_selection";
--> statement-breakpoint
DROP TRIGGER "source_blobs_material_delete";
--> statement-breakpoint
DROP TRIGGER "source_blobs_material_insert";
--> statement-breakpoint
DROP TRIGGER "source_blobs_material_update";
--> statement-breakpoint
DROP TRIGGER "source_extraction_revision_owner";
--> statement-breakpoint
DROP TRIGGER "source_extraction_revisions_insert";
--> statement-breakpoint
DROP TRIGGER "source_extraction_revisions_update";
--> statement-breakpoint
DROP TRIGGER "source_history_documents_delete";
--> statement-breakpoint
DROP TRIGGER "source_history_documents_update";
--> statement-breakpoint
DROP TRIGGER "source_history_documents_valid";
--> statement-breakpoint
DROP TRIGGER "source_history_revisions_delete";
--> statement-breakpoint
DROP TRIGGER "source_history_revisions_update";
--> statement-breakpoint
DROP TRIGGER "source_history_revisions_valid";
--> statement-breakpoint
DROP TRIGGER "source_material_deletion_assets_immutable";
--> statement-breakpoint
DROP TRIGGER "source_material_deletion_assets_retained";
--> statement-breakpoint
DROP TRIGGER "source_material_deletion_assets_valid";
--> statement-breakpoint
DROP TRIGGER "source_processing_history_update";
--> statement-breakpoint
DROP TRIGGER "source_recording_bytes_frozen";
--> statement-breakpoint
DROP TRIGGER "source_recording_bytes_retained";
--> statement-breakpoint
DROP TRIGGER "source_recording_capture_frozen";
--> statement-breakpoint
DROP TRIGGER "source_recording_imports_immutable";
--> statement-breakpoint
DROP TRIGGER "source_recording_imports_retain";
--> statement-breakpoint
DROP TRIGGER "source_recording_imports_validate_insert";
--> statement-breakpoint
DROP TRIGGER "source_snapshot_history_restore";
--> statement-breakpoint
DROP TRIGGER "source_snapshots_published_delete";
--> statement-breakpoint
DROP TRIGGER "source_snapshots_published_update";
--> statement-breakpoint
DROP TRIGGER "sources_material_delete";
--> statement-breakpoint
DROP TRIGGER "sources_material_insert";
--> statement-breakpoint
DROP TRIGGER "sources_material_update";
--> statement-breakpoint
DROP TRIGGER "study_document_annotation_head";
--> statement-breakpoint
DROP TRIGGER "study_document_annotation_revision_owner";
--> statement-breakpoint
DROP TRIGGER "study_document_annotation_revisions_delete";
--> statement-breakpoint
DROP TRIGGER "study_document_annotation_revisions_update";
--> statement-breakpoint
DROP TRIGGER "study_document_annotation_snapshot";
--> statement-breakpoint
DROP TRIGGER "study_document_annotations_delete";
--> statement-breakpoint
DROP TRIGGER "study_document_blocks_delete";
--> statement-breakpoint
DROP TRIGGER "study_document_blocks_insert";
--> statement-breakpoint
DROP TRIGGER "study_document_blocks_update";
--> statement-breakpoint
DROP TRIGGER "study_document_citation_assessments_immutable_update";
--> statement-breakpoint
DROP TRIGGER "study_document_citations_delete";
--> statement-breakpoint
DROP TRIGGER "study_document_citations_insert";
--> statement-breakpoint
DROP TRIGGER "study_document_citations_update";
--> statement-breakpoint
DROP TRIGGER "study_document_content_snapshots_delete";
--> statement-breakpoint
DROP TRIGGER "study_document_content_snapshots_update";
--> statement-breakpoint
DROP TRIGGER "study_document_document_assets_delete";
--> statement-breakpoint
DROP TRIGGER "study_document_document_assets_insert";
--> statement-breakpoint
DROP TRIGGER "study_document_document_assets_update";
--> statement-breakpoint
DROP TRIGGER "study_document_edit_receipts_delete";
--> statement-breakpoint
DROP TRIGGER "study_document_edit_receipts_update";
--> statement-breakpoint
DROP TRIGGER "study_document_generation_intent";
--> statement-breakpoint
DROP TRIGGER "study_document_input_message";
--> statement-breakpoint
DROP TRIGGER "study_document_input_publication";
--> statement-breakpoint
DROP TRIGGER "study_document_inputs_delete";
--> statement-breakpoint
DROP TRIGGER "study_document_inputs_insert";
--> statement-breakpoint
DROP TRIGGER "study_document_inputs_update";
--> statement-breakpoint
DROP TRIGGER "study_document_material_snapshot_insert";
--> statement-breakpoint
DROP TRIGGER "study_document_material_snapshot_update";
--> statement-breakpoint
DROP TRIGGER "study_document_parents_delete";
--> statement-breakpoint
DROP TRIGGER "study_document_parents_insert";
--> statement-breakpoint
DROP TRIGGER "study_document_parents_update";
--> statement-breakpoint
DROP TRIGGER "study_document_proposal_receipts_immutable_update";
--> statement-breakpoint
DROP TRIGGER "study_document_proposals_immutable_update";
--> statement-breakpoint
DROP TRIGGER "study_document_retirement_dependencies";
--> statement-breakpoint
DROP TRIGGER "study_document_retirements_delete";
--> statement-breakpoint
DROP TRIGGER "study_document_retirements_update";
--> statement-breakpoint
DROP TRIGGER "study_document_source_input";
--> statement-breakpoint
DROP TRIGGER "study_document_transform_intent_immutable";
--> statement-breakpoint
DROP TRIGGER "study_document_transform_publication_owner";
--> statement-breakpoint
DROP TRIGGER "study_document_versions_draft_identity";
--> statement-breakpoint
DROP TRIGGER "study_document_versions_draft_insert";
--> statement-breakpoint
DROP TRIGGER "study_document_versions_publish";
--> statement-breakpoint
DROP TRIGGER "study_document_versions_sealed_delete";
--> statement-breakpoint
DROP TRIGGER "study_document_versions_sealed_update";
--> statement-breakpoint
DROP TRIGGER "study_document_versions_snapshot_owner";
--> statement-breakpoint
DROP TRIGGER "workflow_activities_retired_insert";
--> statement-breakpoint
DROP TRIGGER "workflow_clocks_retired_insert";
--> statement-breakpoint
DROP TRIGGER "workflow_configuration_waits_retired_insert";
--> statement-breakpoint
DROP TRIGGER "workflow_deferreds_retired_insert";
--> statement-breakpoint
DROP TRIGGER "workflow_retired_correlations_delete_retained";
--> statement-breakpoint
DROP TRIGGER "workflow_retired_correlations_update_retained";
--> statement-breakpoint
DROP TRIGGER "workflow_retired_executions_delete_retained";
--> statement-breakpoint
DROP TRIGGER "workflow_retired_executions_update_retained";
--> statement-breakpoint
CREATE TEMP TABLE cutover_reply_source_parts AS
SELECT r.request_id,CAST(message.key AS INTEGER) message_index,CAST(part.key AS INTEGER) part_index,
CAST(json_extract(part.value,'$.partId') AS INTEGER) part_id,CAST(json_extract(part.value,'$.sourceId') AS INTEGER) source_id,
CAST(coalesce(json_extract(part.value,'$.snapshotId'),json_extract(part.value,'$.documentId')) AS INTEGER) snapshot_id,
CASE WHEN json_extract(part.value,'$.revision') IS NOT NULL THEN CAST(json_extract(part.value,'$.revision') AS INTEGER)
ELSE (SELECT CASE WHEN count(*)=1 THEN max(e.revision) END FROM source_extraction_revisions e WHERE e.source_id=CAST(json_extract(part.value,'$.sourceId') AS INTEGER)
 AND e.snapshot_id=CAST(coalesce(json_extract(part.value,'$.snapshotId'),json_extract(part.value,'$.documentId')) AS INTEGER)) END revision
FROM conversation_reply_requests r,json_each(r.snapshot,'$.messages') message,json_each(message.value,'$.attachments') part;
--> statement-breakpoint
CREATE TEMP TABLE cutover_unsupported_replies AS SELECT r.request_id,r.session_id,r.version_id,v.message_id,v.status
FROM conversation_reply_requests r LEFT JOIN message_versions v ON v.id=r.version_id
WHERE json_type(r.snapshot,'$.messages') IS NOT 'array' OR json_extract(r.snapshot,'$.requestId') IS NOT r.request_id
OR EXISTS(SELECT 1 FROM cutover_reply_source_parts p WHERE p.request_id=r.request_id AND (p.revision IS NULL OR p.part_id IS NULL OR NOT EXISTS(
 SELECT 1 FROM source_extraction_revisions e WHERE e.source_id=p.source_id AND e.revision=p.revision AND e.snapshot_id=p.snapshot_id)))
OR EXISTS(SELECT 1 FROM session_retired_intents retired WHERE retired.request_id=r.request_id)
OR EXISTS(SELECT 1 FROM cutover_reply_source_parts p WHERE p.request_id=r.request_id GROUP BY p.part_id HAVING count(*)>1)
OR EXISTS(SELECT 1 FROM json_each(r.snapshot,'$.pendingAttachments') p WHERE p.type='object' AND NOT EXISTS(SELECT 1 FROM source_snapshots s
 WHERE s.source_id=CAST(json_extract(p.value,'$.sourceId') AS INTEGER) AND s.revision=CAST(json_extract(p.value,'$.inputRevision') AS INTEGER)));
--> statement-breakpoint
INSERT OR IGNORE INTO workflow_retired_correlations(correlation_id,event_type) SELECT request_id,'ConversationGenerationRequested' FROM cutover_unsupported_replies;
--> statement-breakpoint
INSERT OR IGNORE INTO workflow_retired_executions(execution_id,correlation_id)
SELECT execution_id,json_extract(payload,'$.event.correlationId') FROM workflow_executions
WHERE json_extract(payload,'$.event.type')='ConversationGenerationRequested' AND json_extract(payload,'$.event.correlationId') IN(SELECT request_id FROM cutover_unsupported_replies);
--> statement-breakpoint
DELETE FROM workflow_activities WHERE execution_id IN(SELECT x.execution_id FROM workflow_retired_executions x JOIN cutover_unsupported_replies r ON r.request_id=x.correlation_id);
--> statement-breakpoint
DELETE FROM workflow_deferreds WHERE execution_id IN(SELECT x.execution_id FROM workflow_retired_executions x JOIN cutover_unsupported_replies r ON r.request_id=x.correlation_id);
--> statement-breakpoint
DELETE FROM workflow_clocks WHERE execution_id IN(SELECT x.execution_id FROM workflow_retired_executions x JOIN cutover_unsupported_replies r ON r.request_id=x.correlation_id);
--> statement-breakpoint
DELETE FROM workflow_configuration_waits WHERE execution_id IN(SELECT x.execution_id FROM workflow_retired_executions x JOIN cutover_unsupported_replies r ON r.request_id=x.correlation_id);
--> statement-breakpoint
UPDATE workflow_executions SET payload='{}',result=NULL,owner_token=NULL,status=CASE WHEN status='completed' THEN 'completed' ELSE 'cancelled' END
WHERE execution_id IN(SELECT x.execution_id FROM workflow_retired_executions x JOIN cutover_unsupported_replies r ON r.request_id=x.correlation_id);
--> statement-breakpoint
UPDATE workflow_events SET payload='{}' WHERE type='ConversationGenerationRequested' AND correlation_id IN(SELECT request_id FROM cutover_unsupported_replies);
--> statement-breakpoint
UPDATE message_versions SET generation_request_id=(SELECT r.request_id FROM cutover_unsupported_replies r WHERE r.version_id=message_versions.id)
WHERE id IN(SELECT version_id FROM cutover_unsupported_replies) AND status='complete' AND generation_request_id IS NULL;
--> statement-breakpoint
UPDATE messages SET active_version_id=coalesce((SELECT parent.id FROM message_versions pending JOIN message_versions parent ON parent.id=pending.based_on AND parent.message_id=pending.message_id AND parent.status='complete'
 WHERE pending.id=messages.active_version_id),(SELECT id FROM message_versions v WHERE v.message_id=messages.id AND v.status='complete' ORDER BY number DESC LIMIT 1))
WHERE active_version_id IN(SELECT version_id FROM cutover_unsupported_replies WHERE status!='complete')
AND EXISTS(SELECT 1 FROM message_versions v WHERE v.message_id=messages.id AND v.status='complete');
--> statement-breakpoint
INSERT OR IGNORE INTO session_retired_intents(session_id,intent_key,request_id,reason)
SELECT session_id,intent_key,request_id,'input_retired' FROM session_run_contexts WHERE request_id IN(SELECT request_id FROM cutover_unsupported_replies);
--> statement-breakpoint
DELETE FROM session_run_contexts WHERE request_id IN(SELECT request_id FROM cutover_unsupported_replies);
--> statement-breakpoint
DELETE FROM conversation_reply_requests WHERE request_id IN(SELECT request_id FROM cutover_unsupported_replies);
--> statement-breakpoint
DELETE FROM message_versions WHERE id IN(SELECT version_id FROM cutover_unsupported_replies WHERE status!='complete')
AND EXISTS(SELECT 1 FROM message_versions complete WHERE complete.message_id=message_versions.message_id AND complete.status='complete');
--> statement-breakpoint
DELETE FROM messages WHERE id IN(SELECT message_id FROM cutover_unsupported_replies WHERE status!='complete') AND NOT EXISTS(SELECT 1 FROM message_versions v WHERE v.message_id=messages.id AND v.status='complete');
--> statement-breakpoint
UPDATE conversation_reply_requests AS r SET snapshot=json_set(r.snapshot,'$.messages',json((SELECT json_group_array(json(value)) FROM (
 SELECT json_set(message.value,'$.attachments',json((SELECT json_group_array(json(value)) FROM (
  SELECT json_set(json_remove(part.value,'$.documentId'),'$.revision',CAST(p.revision AS TEXT),'$.snapshotId',CAST(p.snapshot_id AS TEXT)) value
  FROM json_each(message.value,'$.attachments') part JOIN cutover_reply_source_parts p ON p.request_id=r.request_id AND p.message_index=CAST(message.key AS INTEGER) AND p.part_index=CAST(part.key AS INTEGER) ORDER BY CAST(part.key AS INTEGER)
 )))) value FROM json_each(r.snapshot,'$.messages') message ORDER BY CAST(message.key AS INTEGER)
)))) WHERE EXISTS(SELECT 1 FROM cutover_reply_source_parts p WHERE p.request_id=r.request_id)
AND NOT EXISTS(SELECT 1 FROM session_retired_intents retired WHERE retired.request_id=r.request_id);
--> statement-breakpoint
INSERT OR IGNORE INTO conversation_reply_sources(request_id,part_id,source_id,revision,snapshot_id)
SELECT p.request_id,p.part_id,p.source_id,p.revision,p.snapshot_id FROM cutover_reply_source_parts p JOIN conversation_reply_requests r ON r.request_id=p.request_id;
--> statement-breakpoint
INSERT OR IGNORE INTO conversation_reply_sources(request_id,part_id,source_id,revision,snapshot_id)
SELECT r.request_id,CAST(json_extract(p.value,'$.partId') AS INTEGER),CAST(json_extract(p.value,'$.sourceId') AS INTEGER),CAST(json_extract(p.value,'$.inputRevision') AS INTEGER),NULL
FROM conversation_reply_requests r,json_each(r.snapshot,'$.pendingAttachments') p WHERE p.type='object';
--> statement-breakpoint
DROP TABLE cutover_unsupported_replies;
--> statement-breakpoint
DROP TABLE cutover_reply_source_parts;
--> statement-breakpoint
CREATE TEMP TABLE cutover_retired_contexts AS SELECT c.request_id,c.session_id,c.intent_key FROM session_run_contexts c
WHERE EXISTS(SELECT 1 FROM session_retired_intents r WHERE r.request_id=c.request_id)
OR json_type(c.snapshot,'$.inputs') IS NOT 'array' OR json_type(c.snapshot,'$.messages') IS NOT 'array'
OR json_type(c.snapshot,'$.intentKey') IS NOT 'text' OR json_type(c.snapshot,'$.instruction') IS NOT 'text'
OR EXISTS(SELECT 1 FROM json_tree(c.snapshot) j WHERE j.key IN ('materialId','inputVersionIds'))
OR EXISTS(SELECT 1 FROM json_each(c.snapshot,'$.inputs') j WHERE json_extract(j.value,'$.input.kind') NOT IN ('document','source')
 OR json_type(j.value,'$.input.kind') IS NULL)
OR EXISTS(SELECT 1 FROM material_deletion_requests r WHERE r.request_id=c.request_id AND r.kind='context')
OR EXISTS(SELECT 1 FROM material_history_requests r WHERE r.request_id=c.request_id AND r.kind='context')
UNION SELECT r.request_id,r.session_id,c.intent_key FROM conversation_reply_requests r LEFT JOIN session_run_contexts c ON c.request_id=r.request_id
WHERE CAST(json_extract(r.snapshot,'$.sessionId') AS INTEGER) IS NOT r.session_id OR CAST(json_extract(r.snapshot,'$.versionId') AS INTEGER) IS NOT r.version_id
OR CAST(json_extract(r.snapshot,'$.messageId') AS INTEGER) IS NOT(SELECT message_id FROM message_versions WHERE id=r.version_id)
OR json_type(r.snapshot,'$.contextRevision') NOT IN('text','integer') OR json_type(r.snapshot,'$.contextRevision') IS NULL
OR EXISTS(SELECT 1 FROM json_each(r.snapshot,'$.messages') m WHERE json_type(m.value,'$.text') IS NOT 'text' OR json_extract(m.value,'$.role') NOT IN('assistant','user') OR CAST(json_extract(m.value,'$.versionId') AS INTEGER)<=0);
--> statement-breakpoint
CREATE TEMP TABLE cutover_retired_requests AS
SELECT id request_id,'MaterialGenerationRequested' event_type FROM material_generation_requests r
WHERE json_extract(payload,'$.kind') IS NULL OR json_extract(payload,'$.kind') NOT IN ('diagram','quiz','flashcards')
OR json_type(payload,'$.inputs') IS NOT 'array' OR json_extract(payload,'$.documentTransform') IS NOT NULL
OR EXISTS(SELECT 1 FROM json_each(payload,'$.inputs') i WHERE json_extract(i.value,'$.kind') NOT IN ('document','source') OR json_type(i.value,'$.kind') IS NULL)
UNION SELECT request_id,'ConversationGenerationRequested' FROM cutover_retired_contexts
UNION SELECT id,'DocumentGenerationRequested' FROM study_document_transform_requests WHERE context_request_id IN(SELECT request_id FROM cutover_retired_contexts)
UNION SELECT e.correlation_id,e.type FROM workflow_events e WHERE e.type='MaterialGenerationRequested'
AND (json_extract(e.payload,'$.kind')='document' OR json_extract(e.payload,'$.documentTransform') IS NOT NULL)
UNION SELECT e.correlation_id,e.type FROM workflow_events e WHERE e.correlation_id IN(
 SELECT request_id FROM material_deletion_requests WHERE kind IN('context','source','recording')
 UNION SELECT request_id FROM material_history_requests WHERE kind IN('context','source'))
UNION SELECT json_extract(e.payload,'$.event.correlationId'),json_extract(e.payload,'$.event.type') FROM workflow_executions e
WHERE json_extract(e.payload,'$.event.correlationId') IN(SELECT request_id FROM material_deletion_requests WHERE kind IN('context','source','recording') UNION SELECT request_id FROM material_history_requests WHERE kind IN('context','source'))
UNION SELECT e.correlation_id,e.type FROM workflow_events e WHERE e.type='MaterialDeletionRequested' AND EXISTS(SELECT 1 FROM materials m WHERE CAST(m.id AS TEXT)=json_extract(e.payload,'$.materialId') AND m.kind NOT IN('diagram','quiz','flashcards'))
UNION SELECT e.correlation_id,e.type FROM workflow_events e JOIN material_history_prunes p ON p.operation_id=json_extract(e.payload,'$.operationId') JOIN materials m ON m.id=p.material_id WHERE e.type='MaterialHistoryPruneRequested' AND m.kind NOT IN('diagram','quiz','flashcards');
--> statement-breakpoint
INSERT OR IGNORE INTO workflow_retired_correlations(correlation_id,event_type) SELECT request_id,event_type FROM cutover_retired_requests;
--> statement-breakpoint
INSERT OR IGNORE INTO workflow_retired_executions(execution_id,correlation_id)
SELECT e.execution_id,json_extract(e.payload,'$.event.correlationId') FROM workflow_executions e
JOIN cutover_retired_requests r ON r.request_id=json_extract(e.payload,'$.event.correlationId') AND r.event_type=json_extract(e.payload,'$.event.type');
--> statement-breakpoint
DELETE FROM workflow_activities WHERE execution_id IN(SELECT x.execution_id FROM workflow_retired_executions x JOIN cutover_retired_requests r ON r.request_id=x.correlation_id);
--> statement-breakpoint
DELETE FROM workflow_deferreds WHERE execution_id IN(SELECT x.execution_id FROM workflow_retired_executions x JOIN cutover_retired_requests r ON r.request_id=x.correlation_id);
--> statement-breakpoint
DELETE FROM workflow_clocks WHERE execution_id IN(SELECT x.execution_id FROM workflow_retired_executions x JOIN cutover_retired_requests r ON r.request_id=x.correlation_id);
--> statement-breakpoint
DELETE FROM workflow_configuration_waits WHERE execution_id IN(SELECT x.execution_id FROM workflow_retired_executions x JOIN cutover_retired_requests r ON r.request_id=x.correlation_id);
--> statement-breakpoint
UPDATE workflow_executions SET payload='{}',result=NULL,owner_token=NULL,status=CASE WHEN status='completed' THEN 'completed' ELSE 'cancelled' END
WHERE execution_id IN(SELECT x.execution_id FROM workflow_retired_executions x JOIN cutover_retired_requests r ON r.request_id=x.correlation_id);
--> statement-breakpoint
UPDATE workflow_events SET payload='{}' WHERE EXISTS(SELECT 1 FROM cutover_retired_requests r WHERE r.request_id=workflow_events.correlation_id AND r.event_type=workflow_events.type);
--> statement-breakpoint
UPDATE study_document_transform_requests SET cancelled=1 WHERE context_request_id IN(SELECT request_id FROM cutover_retired_contexts);
--> statement-breakpoint
INSERT OR IGNORE INTO session_retired_intents(session_id,intent_key,request_id,reason)
SELECT session_id,intent_key,request_id,'input_retired' FROM cutover_retired_contexts WHERE intent_key IS NOT NULL;
--> statement-breakpoint
CREATE TEMP TABLE cutover_pending_replies AS SELECT r.request_id,r.version_id,v.message_id,v.status FROM conversation_reply_requests r JOIN message_versions v ON v.id=r.version_id WHERE r.request_id IN(SELECT request_id FROM cutover_retired_contexts);
--> statement-breakpoint
UPDATE message_versions SET generation_request_id=(SELECT request_id FROM cutover_pending_replies r WHERE r.version_id=message_versions.id) WHERE id IN(SELECT version_id FROM cutover_pending_replies) AND status='complete' AND generation_request_id IS NULL;
--> statement-breakpoint
UPDATE messages SET active_version_id=coalesce((SELECT parent.id FROM message_versions pending JOIN message_versions parent ON parent.id=pending.based_on AND parent.message_id=pending.message_id AND parent.status='complete' WHERE pending.id=messages.active_version_id),(SELECT id FROM message_versions v WHERE v.message_id=messages.id AND v.status='complete' ORDER BY number DESC LIMIT 1))
WHERE active_version_id IN(SELECT version_id FROM cutover_pending_replies WHERE status!='complete') AND EXISTS(SELECT 1 FROM message_versions v WHERE v.message_id=messages.id AND v.status='complete');
--> statement-breakpoint
DELETE FROM conversation_reply_sources WHERE request_id IN(SELECT request_id FROM cutover_retired_contexts);
--> statement-breakpoint
DELETE FROM conversation_reply_requests WHERE request_id IN(SELECT request_id FROM cutover_retired_contexts);
--> statement-breakpoint
DELETE FROM message_versions WHERE id IN(SELECT version_id FROM cutover_pending_replies WHERE status!='complete') AND EXISTS(SELECT 1 FROM message_versions v WHERE v.message_id=message_versions.message_id AND v.status='complete');
--> statement-breakpoint
DELETE FROM messages WHERE id IN(SELECT message_id FROM cutover_pending_replies WHERE status!='complete') AND NOT EXISTS(SELECT 1 FROM message_versions v WHERE v.message_id=messages.id AND v.status='complete');
--> statement-breakpoint
DELETE FROM session_context_documents WHERE request_id IN(SELECT request_id FROM cutover_retired_contexts);
--> statement-breakpoint
DELETE FROM session_context_sources WHERE request_id IN(SELECT request_id FROM cutover_retired_contexts);
--> statement-breakpoint
DELETE FROM session_run_contexts WHERE request_id IN(SELECT request_id FROM cutover_retired_contexts);
--> statement-breakpoint
UPDATE sessions SET selection='[]',selection_revision=selection_revision+1 WHERE EXISTS(SELECT 1 FROM json_tree(selection) WHERE key IN('materialId','inputVersionIds'));
--> statement-breakpoint
UPDATE workflow_events AS e SET type='DocumentPublished',payload=json_remove(json_set(e.payload,'$.type','DocumentPublished','$.versionId',CAST((SELECT x.document_version_id FROM legacy_document_versions x WHERE CAST(x.material_version_id AS TEXT)=json_extract(e.payload,'$.materialVersionId')) AS TEXT)),'$.materialId','$.materialVersionId','$.generationRequestId')
WHERE e.type='MaterialPublished' AND EXISTS(SELECT 1 FROM legacy_document_versions x WHERE CAST(x.material_version_id AS TEXT)=json_extract(e.payload,'$.materialVersionId') AND x.document_version_id IS NOT NULL);
--> statement-breakpoint
UPDATE workflow_events AS e SET type='DocumentAnnotationChanged',payload=json_remove(json_set(e.payload,'$.type','DocumentAnnotationChanged',
'$.annotationId',CAST((SELECT x.annotation_id FROM legacy_document_annotations x WHERE CAST(x.material_annotation_id AS TEXT)=json_extract(e.payload,'$.annotationId')) AS TEXT),
'$.documentId',CAST((SELECT x.document_id FROM legacy_document_materials x WHERE CAST(x.material_id AS TEXT)=json_extract(e.payload,'$.materialId')) AS TEXT)),'$.materialId')
WHERE e.type='MaterialAnnotationChanged' AND EXISTS(SELECT 1 FROM legacy_document_annotations x WHERE CAST(x.material_annotation_id AS TEXT)=json_extract(e.payload,'$.annotationId'));
--> statement-breakpoint
CREATE TEMP TABLE cutover_obsolete_events AS SELECT event_id,correlation_id,type FROM workflow_events e WHERE type='MaterialAnnotationChanged' OR (type='MaterialPublished' AND NOT EXISTS(SELECT 1 FROM material_versions v WHERE CAST(v.id AS TEXT)=json_extract(e.payload,'$.materialVersionId') AND v.kind IN('diagram','quiz','flashcards')));
--> statement-breakpoint
INSERT OR IGNORE INTO workflow_retired_correlations(correlation_id,event_type) SELECT correlation_id,type FROM cutover_obsolete_events;
--> statement-breakpoint
UPDATE workflow_events SET payload='{}' WHERE event_id IN(SELECT event_id FROM cutover_obsolete_events);
--> statement-breakpoint
UPDATE study_document_inputs AS i SET document_version_id=(SELECT x.document_version_id FROM legacy_document_versions x WHERE x.material_version_id=i.legacy_material_version_id),legacy_material_version_id=NULL
WHERE i.legacy_material_version_id IS NOT NULL AND EXISTS(SELECT 1 FROM legacy_document_versions x WHERE x.material_version_id=i.legacy_material_version_id AND x.document_version_id IS NOT NULL);
--> statement-breakpoint
UPDATE study_document_inputs AS i SET source_id=(SELECT s.source_id FROM material_source_snapshots s WHERE s.version_id=i.legacy_material_version_id),
source_revision=(SELECT s.revision FROM material_source_snapshots s WHERE s.version_id=i.legacy_material_version_id),
source_snapshot_id=(SELECT s.document_id FROM material_source_snapshots s WHERE s.version_id=i.legacy_material_version_id),legacy_material_version_id=NULL
WHERE i.legacy_material_version_id IS NOT NULL AND EXISTS(SELECT 1 FROM material_source_snapshots s WHERE s.version_id=i.legacy_material_version_id);
--> statement-breakpoint
DELETE FROM study_document_citation_assessments WHERE (version_id,marker) IN(SELECT c.version_id,c.marker FROM study_document_citations c JOIN study_document_inputs i ON i.id=c.input_id WHERE i.legacy_material_version_id IS NOT NULL);
--> statement-breakpoint
DELETE FROM study_document_citations WHERE input_id IN(SELECT id FROM study_document_inputs WHERE legacy_material_version_id IS NOT NULL);
--> statement-breakpoint
DELETE FROM study_document_inputs WHERE legacy_material_version_id IS NOT NULL;
--> statement-breakpoint
INSERT OR IGNORE INTO study_document_deletions(document_id,created_at)
SELECT x.document_id,d.created_at FROM legacy_document_materials x JOIN material_deletion_members m ON m.material_id=x.material_id JOIN material_deletions d ON d.material_id=m.deletion_id;
--> statement-breakpoint
INSERT OR IGNORE INTO study_document_retirements(version_id,reason,created_at)
SELECT x.document_version_id,'history',p.created_at FROM legacy_document_versions x JOIN material_history_members m ON m.version_id=x.material_version_id JOIN material_history_prunes p ON p.operation_id=m.operation_id WHERE x.document_version_id IS NOT NULL;
--> statement-breakpoint
INSERT OR IGNORE INTO study_document_retirements(version_id,reason,created_at) SELECT v.id,'deletion',d.created_at FROM study_document_versions v JOIN study_document_deletions d ON d.document_id=v.document_id;
--> statement-breakpoint
DELETE FROM study_document_citation_assessments WHERE version_id IN(SELECT version_id FROM study_document_retirements);
--> statement-breakpoint
DELETE FROM study_document_citations WHERE version_id IN(SELECT version_id FROM study_document_retirements);
--> statement-breakpoint
DELETE FROM study_document_inputs WHERE version_id IN(SELECT version_id FROM study_document_retirements);
--> statement-breakpoint
DELETE FROM document_assets WHERE document_id IN(SELECT content_snapshot_id FROM study_document_versions WHERE id IN(SELECT version_id FROM study_document_retirements));
--> statement-breakpoint
DELETE FROM chunks WHERE document_id IN(SELECT content_snapshot_id FROM study_document_versions WHERE id IN(SELECT version_id FROM study_document_retirements));
--> statement-breakpoint
DELETE FROM blocks WHERE document_id IN(SELECT content_snapshot_id FROM study_document_versions WHERE id IN(SELECT version_id FROM study_document_retirements));
--> statement-breakpoint
DELETE FROM material_evidence_inputs WHERE request_id IN(SELECT request_id FROM cutover_retired_requests WHERE event_type='MaterialGenerationRequested');
--> statement-breakpoint
UPDATE material_generation_requests SET payload='{}',cancelled=1,result_version_id=NULL,result_hash=NULL,result_metadata=NULL WHERE id IN(SELECT request_id FROM cutover_retired_requests WHERE event_type='MaterialGenerationRequested') OR result_version_id IN(SELECT id FROM material_versions WHERE kind NOT IN('diagram','quiz','flashcards'));
--> statement-breakpoint
CREATE TEMP TABLE cutover_old_materials AS SELECT id FROM materials WHERE kind NOT IN('diagram','quiz','flashcards');
--> statement-breakpoint
CREATE TEMP TABLE cutover_old_versions AS SELECT id FROM material_versions WHERE kind NOT IN('diagram','quiz','flashcards');
--> statement-breakpoint
CREATE TEMP TABLE cutover_old_snapshots AS SELECT DISTINCT document_id id FROM material_document_versions d JOIN content_snapshots s ON s.id=d.document_id WHERE s.source_id IS NULL
AND NOT EXISTS(SELECT 1 FROM study_document_versions v WHERE v.content_snapshot_id=s.id) AND NOT EXISTS(SELECT 1 FROM citations c WHERE c.document_id=s.id);
--> statement-breakpoint
DELETE FROM project_materials WHERE material_id IN(SELECT id FROM cutover_old_materials);
--> statement-breakpoint
DELETE FROM session_materials WHERE material_id IN(SELECT id FROM cutover_old_materials);
--> statement-breakpoint
DELETE FROM material_version_parents WHERE version_id IN(SELECT id FROM cutover_old_versions);
--> statement-breakpoint
DELETE FROM material_version_parents WHERE parent_version_id IN(SELECT id FROM cutover_old_versions);
--> statement-breakpoint
DELETE FROM material_evidence_citations WHERE version_id IN(SELECT id FROM cutover_old_versions);
--> statement-breakpoint
DELETE FROM material_evidence_inputs WHERE version_id IN(SELECT id FROM cutover_old_versions);
--> statement-breakpoint
DELETE FROM material_history_members WHERE version_id IN(SELECT id FROM cutover_old_versions);
--> statement-breakpoint
DELETE FROM material_history_requests WHERE kind NOT IN('generation','learning','publication') OR operation_id IN(SELECT operation_id FROM material_history_prunes WHERE material_id IN(SELECT id FROM cutover_old_materials));
--> statement-breakpoint
DELETE FROM material_history_prunes WHERE material_id IN(SELECT id FROM cutover_old_materials);
--> statement-breakpoint
DELETE FROM material_deletion_requests WHERE kind NOT IN('generation','learning','publication') OR deletion_id IN(SELECT material_id FROM material_deletion_members WHERE material_id IN(SELECT id FROM cutover_old_materials));
--> statement-breakpoint
DELETE FROM material_deletion_members WHERE material_id IN(SELECT id FROM cutover_old_materials);
--> statement-breakpoint
DELETE FROM material_deletions WHERE material_id IN(SELECT id FROM cutover_old_materials) AND NOT EXISTS(SELECT 1 FROM material_deletion_members m WHERE m.deletion_id=material_deletions.material_id);
--> statement-breakpoint
UPDATE material_versions SET operation=CASE WHEN generation_request_id IS NOT NULL THEN 'generate' ELSE 'original' END WHERE kind IN('diagram','quiz','flashcards') AND operation NOT IN('original','edit','generate');
--> statement-breakpoint
UPDATE material_versions SET creator=CASE WHEN generation_request_id IS NOT NULL THEN 'agent' ELSE 'user' END WHERE kind IN('diagram','quiz','flashcards') AND creator='import';
--> statement-breakpoint
DELETE FROM document_assets WHERE document_id IN(SELECT id FROM cutover_old_snapshots);
--> statement-breakpoint
DELETE FROM chunks WHERE document_id IN(SELECT id FROM cutover_old_snapshots);
--> statement-breakpoint
DELETE FROM blocks WHERE document_id IN(SELECT id FROM cutover_old_snapshots);
--> statement-breakpoint
DELETE FROM content_snapshots WHERE id IN(SELECT id FROM cutover_old_snapshots);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;
--> statement-breakpoint
CREATE TABLE `__new_citations` (
	`version_id` integer NOT NULL,
	`marker` integer NOT NULL,
	`source_id` integer,
	`authored_version_id` integer,
	`source_revision` integer,
	`document_id` integer,
	`block_id` text,
	`range_start` integer,
	`range_end` integer,
	`source_name` text NOT NULL,
	`anchor` text NOT NULL,
	`quote` text NOT NULL,
	CONSTRAINT `citations_pk` PRIMARY KEY(`version_id`, `marker`),
	CONSTRAINT `fk_citations_version_id_message_versions_id_fk` FOREIGN KEY (`version_id`) REFERENCES `message_versions`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_citations_source_id_sources_id_fk` FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_citations_authored_version_id_study_document_versions_id_fk` FOREIGN KEY (`authored_version_id`) REFERENCES `study_document_versions`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_citations_document_id_documents_id_fk` FOREIGN KEY (`document_id`) REFERENCES `content_snapshots`(`id`) ON DELETE SET NULL,
	CONSTRAINT "citations_check_1" CHECK(marker BETWEEN 1 AND 4294967295),
	CONSTRAINT "citations_check_2" CHECK(json_valid(anchor))
);
--> statement-breakpoint
INSERT INTO `__new_citations`(`version_id`, `marker`, `source_id`, `authored_version_id`, `source_revision`, `document_id`, `block_id`, `range_start`, `range_end`, `source_name`, `anchor`, `quote`) SELECT `version_id`, `marker`, `source_id`, `authored_version_id`, `source_revision`, `document_id`, `block_id`, `range_start`, `range_end`, `source_name`, `anchor`, `quote` FROM `citations`;
--> statement-breakpoint
DROP TABLE `citations`;
--> statement-breakpoint
ALTER TABLE `__new_citations` RENAME TO `citations`;
--> statement-breakpoint
PRAGMA foreign_keys=ON;
--> statement-breakpoint
PRAGMA foreign_keys=OFF;
--> statement-breakpoint
CREATE TABLE `__new_study_document_inputs` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`version_id` integer,
	`request_id` text,
	`position` integer NOT NULL,
	`document_version_id` integer,
	`source_id` integer,
	`source_revision` integer,
	`source_snapshot_id` integer,
	`message_version_id` integer,
	`exact_message_version_id` integer,
	CONSTRAINT `fk_study_document_inputs_version_id_study_document_versions_id_fk` FOREIGN KEY (`version_id`) REFERENCES `study_document_versions`(`id`),
	CONSTRAINT `fk_study_document_inputs_request_id_study_document_generation_requests_id_fk` FOREIGN KEY (`request_id`) REFERENCES `study_document_generation_requests`(`id`),
	CONSTRAINT `fk_study_document_inputs_document_version_id_study_document_versions_id_fk` FOREIGN KEY (`document_version_id`) REFERENCES `study_document_versions`(`id`),
	CONSTRAINT `fk_study_document_inputs_source_snapshot_id_content_snapshots_id_fk` FOREIGN KEY (`source_snapshot_id`) REFERENCES `content_snapshots`(`id`),
	CONSTRAINT `fk_study_document_inputs_message_version_id_message_versions_id_fk` FOREIGN KEY (`message_version_id`) REFERENCES `message_versions`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_study_document_inputs_source_id_source_revision_source_snapshots_source_id_revision_fk` FOREIGN KEY (`source_id`,`source_revision`) REFERENCES `source_snapshots`(`source_id`,`revision`),
	CONSTRAINT `fk_study_document_inputs_source_id_source_revision_source_snapshot_id_source_extraction_revisions_source_id_revision_snapshot_id_fk` FOREIGN KEY (`source_id`,`source_revision`,`source_snapshot_id`) REFERENCES `source_extraction_revisions`(`source_id`,`revision`,`snapshot_id`),
	CONSTRAINT "study_document_inputs_exact_target" CHECK(("version_id" IS NOT NULL) != ("request_id" IS NOT NULL) AND "position">=0 AND
 (("document_version_id" IS NOT NULL)+("source_id" IS NOT NULL)+("exact_message_version_id" IS NOT NULL))=1 AND
 (("source_id" IS NULL)=("source_revision" IS NULL)) AND ("source_snapshot_id" IS NULL OR "source_id" IS NOT NULL) AND ("source_revision" IS NULL OR "source_revision">0) AND ("message_version_id" IS NULL OR "message_version_id"="exact_message_version_id"))
);
--> statement-breakpoint
INSERT INTO `__new_study_document_inputs`(`id`, `version_id`, `request_id`, `position`, `document_version_id`, `source_id`, `source_revision`, `source_snapshot_id`, `message_version_id`, `exact_message_version_id`) SELECT `id`, `version_id`, `request_id`, `position`, `document_version_id`, `source_id`, `source_revision`, `source_snapshot_id`, `message_version_id`, `exact_message_version_id` FROM `study_document_inputs`;
--> statement-breakpoint
DROP TABLE `study_document_inputs`;
--> statement-breakpoint
ALTER TABLE `__new_study_document_inputs` RENAME TO `study_document_inputs`;
--> statement-breakpoint
PRAGMA foreign_keys=ON;
--> statement-breakpoint
PRAGMA foreign_keys=OFF;
--> statement-breakpoint
CREATE TABLE `__new_material_versions` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`material_id` integer NOT NULL,
	`kind` text NOT NULL,
	`number` integer NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`operation` text DEFAULT 'original' NOT NULL,
	`creator` text DEFAULT 'user' NOT NULL,
	`instruction` text,
	`generation_request_id` text,
	`language` text,
	`created_at` integer NOT NULL,
	`published_at` integer,
	CONSTRAINT `fk_material_versions_generation_request_id_material_generation_requests_id_fk` FOREIGN KEY (`generation_request_id`) REFERENCES `material_generation_requests`(`id`),
	CONSTRAINT `fk_material_versions_material_id_kind_materials_id_kind_fk` FOREIGN KEY (`material_id`,`kind`) REFERENCES `materials`(`id`,`kind`) ON DELETE CASCADE,
	CONSTRAINT "material_versions_identity_check" CHECK(id > 0 AND typeof(number) = 'integer' AND number > 0),
	CONSTRAINT "material_versions_status_check" CHECK(status IN ('draft','published') AND ((status = 'published') = (published_at IS NOT NULL))),
	CONSTRAINT "material_versions_operation_check" CHECK(operation IN ('original','edit','generate')),
	CONSTRAINT "material_versions_creator_check" CHECK(creator IN ('user','agent')),
	CONSTRAINT "material_versions_language_check" CHECK(language IS NULL OR length(trim(language)) BETWEEN 1 AND 64),
	CONSTRAINT "material_versions_instruction_check" CHECK(instruction IS NULL OR length(trim(instruction)) BETWEEN 1 AND 100000),
	CONSTRAINT "material_versions_times_check" CHECK(typeof(created_at) = 'integer' AND created_at >= 0 AND (published_at IS NULL OR (typeof(published_at) = 'integer' AND published_at >= created_at)))
);
--> statement-breakpoint
INSERT INTO `__new_material_versions`(`id`, `material_id`, `kind`, `number`, `status`, `operation`, `creator`, `instruction`, `generation_request_id`, `language`, `created_at`, `published_at`) SELECT `id`, `material_id`, `kind`, `number`, `status`, `operation`, `creator`, `instruction`, `generation_request_id`, `language`, `created_at`, `published_at` FROM `material_versions` WHERE kind IN('diagram','quiz','flashcards');
--> statement-breakpoint
DROP TABLE `material_versions`;
--> statement-breakpoint
ALTER TABLE `__new_material_versions` RENAME TO `material_versions`;
--> statement-breakpoint
PRAGMA foreign_keys=ON;
--> statement-breakpoint
PRAGMA foreign_keys=OFF;
--> statement-breakpoint
CREATE TABLE `__new_materials` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`create_key` text,
	`creation_intent` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`archived_at` integer,
	CONSTRAINT "materials_description_check" CHECK("description" IS NULL OR length("description") <= 240),
	CONSTRAINT "materials_creation_intent_check" CHECK(("create_key" IS NULL AND "creation_intent" IS NULL) OR (length("create_key") BETWEEN 1 AND 200 AND json_valid("creation_intent"))),
	CONSTRAINT "materials_kind_check" CHECK(kind IN ('diagram','quiz','flashcards')),
	CONSTRAINT "materials_title_check" CHECK(length(trim(title)) BETWEEN 1 AND 200),
	CONSTRAINT "materials_times_check" CHECK(id > 0 AND typeof(created_at) = 'integer' AND typeof(updated_at) = 'integer' AND created_at >= 0 AND updated_at >= created_at AND (archived_at IS NULL OR (typeof(archived_at) = 'integer' AND archived_at >= created_at)))
);
--> statement-breakpoint
INSERT INTO `__new_materials`(`id`, `kind`, `title`, `description`, `create_key`, `creation_intent`, `created_at`, `updated_at`, `archived_at`) SELECT `id`, `kind`, `title`, `description`, `create_key`, `creation_intent`, `created_at`, `updated_at`, `archived_at` FROM `materials` WHERE kind IN('diagram','quiz','flashcards');
--> statement-breakpoint
DROP TABLE `materials`;
--> statement-breakpoint
ALTER TABLE `__new_materials` RENAME TO `materials`;
--> statement-breakpoint
PRAGMA foreign_keys=ON;
--> statement-breakpoint
PRAGMA foreign_keys=OFF;
--> statement-breakpoint
CREATE TABLE `__new_material_diagram_versions` (
	`version_id` integer PRIMARY KEY,
	`kind` text DEFAULT 'diagram' NOT NULL,
	`format` text NOT NULL,
	`payload` text NOT NULL,
	CONSTRAINT `fk_material_diagram_versions_version_id_kind_material_versions_id_kind_fk` FOREIGN KEY (`version_id`,`kind`) REFERENCES `material_versions`(`id`,`kind`) ON DELETE CASCADE,
	CONSTRAINT "payload_kind_check" CHECK("kind"='diagram'),
	CONSTRAINT "material_diagram_format_check" CHECK(format IN ('mermaid')),
	CONSTRAINT "material_diagram_payload_check" CHECK(length(trim(payload)) > 0)
);
--> statement-breakpoint
INSERT INTO `__new_material_diagram_versions`(`version_id`, `kind`, `format`, `payload`) SELECT `version_id`, `kind`, `format`, `payload` FROM `material_diagram_versions`;
--> statement-breakpoint
DROP TABLE `material_diagram_versions`;
--> statement-breakpoint
ALTER TABLE `__new_material_diagram_versions` RENAME TO `material_diagram_versions`;
--> statement-breakpoint
PRAGMA foreign_keys=ON;
--> statement-breakpoint
DROP INDEX IF EXISTS `material_generation_inputs_position_unique`;
--> statement-breakpoint
DROP INDEX IF EXISTS `material_version_inputs_input_idx`;
--> statement-breakpoint
DROP INDEX IF EXISTS `material_audio_versions_source_idx`;
--> statement-breakpoint
DROP INDEX IF EXISTS `material_document_versions_document_unique`;
--> statement-breakpoint
DROP INDEX IF EXISTS `material_file_versions_source_idx`;
--> statement-breakpoint
DROP INDEX IF EXISTS `material_image_versions_source_idx`;
--> statement-breakpoint
DROP INDEX IF EXISTS `material_link_versions_source_idx`;
--> statement-breakpoint
DROP INDEX IF EXISTS `material_version_citations_marker_unique`;
--> statement-breakpoint
DROP INDEX IF EXISTS `material_version_citations_input_idx`;
--> statement-breakpoint
DROP INDEX IF EXISTS `material_video_versions_source_idx`;
--> statement-breakpoint
DROP INDEX IF EXISTS `material_imports_material_unique`;
--> statement-breakpoint
DROP INDEX IF EXISTS `material_source_document_unique`;
--> statement-breakpoint
DROP INDEX IF EXISTS `document_edit_receipts_submitted_unique`;
--> statement-breakpoint
DROP INDEX IF EXISTS `document_proposal_receipts_completed_unique`;
--> statement-breakpoint
DROP INDEX IF EXISTS `material_annotations_material_idx`;
--> statement-breakpoint
DROP INDEX IF EXISTS `material_citation_assessments_claim_idx`;
--> statement-breakpoint
CREATE INDEX `citations_source_idx` ON `citations` (`source_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `study_document_inputs_owner` ON `study_document_inputs` (`id`,`version_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `study_document_inputs_version_position` ON `study_document_inputs` (`version_id`,`position`);
--> statement-breakpoint
CREATE UNIQUE INDEX `study_document_inputs_request_position` ON `study_document_inputs` (`request_id`,`position`);
--> statement-breakpoint
CREATE UNIQUE INDEX `material_versions_generation_request_unique` ON `material_versions` (`generation_request_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `material_versions_number_unique` ON `material_versions` (`material_id`,`number`);
--> statement-breakpoint
CREATE UNIQUE INDEX `material_versions_id_kind_unique` ON `material_versions` (`id`,`kind`);
--> statement-breakpoint
CREATE UNIQUE INDEX `material_versions_id_material_kind_unique` ON `material_versions` (`id`,`material_id`,`kind`);
--> statement-breakpoint
CREATE UNIQUE INDEX `material_versions_id_material_unique` ON `material_versions` (`id`,`material_id`);
--> statement-breakpoint
CREATE INDEX `material_versions_heads_idx` ON `material_versions` (`material_id`,`status`,"number" desc);
--> statement-breakpoint
CREATE UNIQUE INDEX `materials_id_kind_unique` ON `materials` (`id`,`kind`);
--> statement-breakpoint
CREATE UNIQUE INDEX `materials_create_key_unique` ON `materials` (`create_key`);
--> statement-breakpoint
DROP TABLE `material_generation_inputs`;
--> statement-breakpoint
DROP TABLE `material_version_inputs`;
--> statement-breakpoint
DROP TABLE `material_audio_versions`;
--> statement-breakpoint
DROP TABLE `material_document_versions`;
--> statement-breakpoint
DROP TABLE `material_file_versions`;
--> statement-breakpoint
DROP TABLE `material_image_versions`;
--> statement-breakpoint
DROP TABLE `material_link_versions`;
--> statement-breakpoint
DROP TABLE `material_version_citations`;
--> statement-breakpoint
DROP TABLE `material_video_versions`;
--> statement-breakpoint
DROP TABLE `material_imports`;
--> statement-breakpoint
DROP TABLE `material_source_snapshots`;
--> statement-breakpoint
DROP TABLE `document_edit_receipts`;
--> statement-breakpoint
DROP TABLE `document_proposal_receipts`;
--> statement-breakpoint
DROP TABLE `document_proposals`;
--> statement-breakpoint
DROP TABLE `retired_document_proposal_receipts`;
--> statement-breakpoint
DROP TABLE `session_generation_retirements`;
--> statement-breakpoint
DROP TABLE `material_annotation_revisions`;
--> statement-breakpoint
DROP TABLE `material_annotations`;
--> statement-breakpoint
DROP TABLE `material_citation_assessments`;
--> statement-breakpoint
DROP TABLE `source_material_deletion_assets`;
--> statement-breakpoint
DROP TABLE `conversation_history_intents`;
--> statement-breakpoint
DROP TABLE `source_history_documents`;
--> statement-breakpoint
DROP TABLE `source_history_revisions`;
--> statement-breakpoint
DROP TABLE `legacy_document_annotations`;
--> statement-breakpoint
DROP TABLE `legacy_document_generations`;
--> statement-breakpoint
DROP TABLE `legacy_document_materials`;
--> statement-breakpoint
DROP TABLE `legacy_document_versions`;
--> statement-breakpoint
ALTER TABLE `material_generation_requests` DROP COLUMN `result_metadata`;
--> statement-breakpoint
CREATE TRIGGER authored_source_blocks_delete BEFORE DELETE ON blocks WHEN EXISTS(SELECT 1 FROM (SELECT source_id,revision,snapshot_id FROM conversation_reply_sources UNION ALL SELECT source_id,revision,snapshot_id FROM session_context_sources UNION ALL SELECT source_id,source_revision,source_snapshot_id FROM study_document_inputs WHERE source_id IS NOT NULL UNION ALL SELECT source_id,source_revision,source_snapshot_id FROM material_evidence_inputs WHERE source_id IS NOT NULL UNION ALL SELECT source_id,source_revision,source_snapshot_id FROM learning_practice_inputs WHERE source_id IS NOT NULL) p WHERE p.snapshot_id=OLD.document_id) BEGIN SELECT RAISE(ABORT,'exact evidence pins source extraction'); END;
--> statement-breakpoint
CREATE TRIGGER authored_source_blocks_insert BEFORE INSERT ON blocks WHEN EXISTS(SELECT 1 FROM study_document_inputs WHERE source_snapshot_id=NEW.document_id) BEGIN SELECT RAISE(ABORT,'authored provenance pins exact source extraction'); END;
--> statement-breakpoint
CREATE TRIGGER authored_source_blocks_update BEFORE UPDATE ON blocks WHEN EXISTS(SELECT 1 FROM (SELECT source_id,revision,snapshot_id FROM conversation_reply_sources UNION ALL SELECT source_id,revision,snapshot_id FROM session_context_sources UNION ALL SELECT source_id,source_revision,source_snapshot_id FROM study_document_inputs WHERE source_id IS NOT NULL UNION ALL SELECT source_id,source_revision,source_snapshot_id FROM material_evidence_inputs WHERE source_id IS NOT NULL UNION ALL SELECT source_id,source_revision,source_snapshot_id FROM learning_practice_inputs WHERE source_id IS NOT NULL) p WHERE p.snapshot_id=OLD.document_id) BEGIN SELECT RAISE(ABORT,'exact evidence pins source extraction'); END;
--> statement-breakpoint
CREATE TRIGGER authored_source_content_snapshots_delete BEFORE DELETE ON content_snapshots WHEN EXISTS(SELECT 1 FROM (SELECT source_id,revision,snapshot_id FROM conversation_reply_sources UNION ALL SELECT source_id,revision,snapshot_id FROM session_context_sources UNION ALL SELECT source_id,source_revision,source_snapshot_id FROM study_document_inputs WHERE source_id IS NOT NULL UNION ALL SELECT source_id,source_revision,source_snapshot_id FROM material_evidence_inputs WHERE source_id IS NOT NULL UNION ALL SELECT source_id,source_revision,source_snapshot_id FROM learning_practice_inputs WHERE source_id IS NOT NULL) p WHERE p.snapshot_id=OLD.id) BEGIN SELECT RAISE(ABORT,'exact evidence pins source extraction'); END;
--> statement-breakpoint
CREATE TRIGGER authored_source_content_snapshots_update BEFORE UPDATE ON content_snapshots WHEN EXISTS(SELECT 1 FROM (SELECT source_id,revision,snapshot_id FROM conversation_reply_sources UNION ALL SELECT source_id,revision,snapshot_id FROM session_context_sources UNION ALL SELECT source_id,source_revision,source_snapshot_id FROM study_document_inputs WHERE source_id IS NOT NULL UNION ALL SELECT source_id,source_revision,source_snapshot_id FROM material_evidence_inputs WHERE source_id IS NOT NULL UNION ALL SELECT source_id,source_revision,source_snapshot_id FROM learning_practice_inputs WHERE source_id IS NOT NULL) p WHERE p.snapshot_id=OLD.id) BEGIN SELECT RAISE(ABORT,'exact evidence pins source extraction'); END;
--> statement-breakpoint
CREATE TRIGGER authored_source_revision_update BEFORE UPDATE ON source_snapshots WHEN EXISTS(SELECT 1 FROM study_document_inputs WHERE source_id=OLD.source_id AND source_revision=OLD.revision) BEGIN SELECT RAISE(ABORT,'authored provenance pins exact source revision'); END;
--> statement-breakpoint
CREATE TRIGGER catalog_native_material_delete BEFORE DELETE ON materials BEGIN DELETE FROM catalog_fts WHERE kind='material' AND target_id=old.id; DELETE FROM catalog_fts WHERE kind='question' AND target_id IN (SELECT q.id FROM material_quiz_questions q JOIN material_versions v ON v.id=q.version_id WHERE v.material_id=old.id); END;
--> statement-breakpoint
CREATE TRIGGER catalog_native_material_update AFTER UPDATE OF title,archived_at ON materials WHEN NOT EXISTS(SELECT 1 FROM material_deletion_members WHERE material_id=NEW.id)
BEGIN
 DELETE FROM catalog_fts WHERE kind='material' AND target_id=new.id;
 DELETE FROM catalog_fts WHERE kind='question' AND target_id IN (SELECT q.id FROM material_quiz_questions q JOIN material_versions v ON v.id=q.version_id WHERE v.material_id=new.id);
 INSERT INTO catalog_fts SELECT m.title,'material',m.id,NULL FROM materials m WHERE m.id=new.id AND m.archived_at IS NULL AND EXISTS (SELECT 1 FROM material_versions v WHERE v.material_id=m.id AND v.status='published');
 INSERT INTO catalog_fts SELECT q.prompt,'question',q.id,NULL FROM materials m JOIN material_versions v ON v.material_id=m.id JOIN material_quiz_questions q ON q.version_id=v.id WHERE m.id=new.id AND m.archived_at IS NULL AND v.status='published' AND v.number=(SELECT max(h.number) FROM material_versions h WHERE h.material_id=m.id AND h.status='published');
END;
--> statement-breakpoint
CREATE TRIGGER catalog_native_question_delete BEFORE DELETE ON material_quiz_questions BEGIN DELETE FROM catalog_fts WHERE kind='question' AND target_id=old.id; END;
--> statement-breakpoint
CREATE TRIGGER catalog_native_version_delete AFTER DELETE ON material_versions WHEN NOT EXISTS(SELECT 1 FROM material_deletion_members WHERE material_id=OLD.material_id)
BEGIN
 DELETE FROM catalog_fts WHERE kind='material' AND target_id=old.material_id;
 DELETE FROM catalog_fts WHERE kind='question' AND target_id IN (SELECT q.id FROM material_quiz_questions q JOIN material_versions v ON v.id=q.version_id WHERE v.material_id=old.material_id);
 INSERT INTO catalog_fts SELECT m.title,'material',m.id,NULL FROM materials m WHERE m.id=old.material_id AND m.archived_at IS NULL AND EXISTS (SELECT 1 FROM material_versions v WHERE v.material_id=m.id AND v.status='published');
 INSERT INTO catalog_fts SELECT q.prompt,'question',q.id,NULL FROM materials m JOIN material_versions v ON v.material_id=m.id JOIN material_quiz_questions q ON q.version_id=v.id WHERE m.id=old.material_id AND m.archived_at IS NULL AND v.status='published' AND v.number=(SELECT max(h.number) FROM material_versions h WHERE h.material_id=m.id AND h.status='published');
END;
--> statement-breakpoint
CREATE TRIGGER catalog_native_version_insert AFTER INSERT ON material_versions WHEN NOT EXISTS(SELECT 1 FROM material_deletion_members WHERE material_id=NEW.material_id)
BEGIN
 DELETE FROM catalog_fts WHERE kind='material' AND target_id=new.material_id;
 DELETE FROM catalog_fts WHERE kind='question' AND target_id IN (SELECT q.id FROM material_quiz_questions q JOIN material_versions v ON v.id=q.version_id WHERE v.material_id=new.material_id);
 INSERT INTO catalog_fts SELECT m.title,'material',m.id,NULL FROM materials m WHERE m.id=new.material_id AND m.archived_at IS NULL AND EXISTS (SELECT 1 FROM material_versions v WHERE v.material_id=m.id AND v.status='published');
 INSERT INTO catalog_fts SELECT q.prompt,'question',q.id,NULL FROM materials m JOIN material_versions v ON v.material_id=m.id JOIN material_quiz_questions q ON q.version_id=v.id WHERE m.id=new.material_id AND m.archived_at IS NULL AND v.status='published' AND v.number=(SELECT max(h.number) FROM material_versions h WHERE h.material_id=m.id AND h.status='published');
END;
--> statement-breakpoint
CREATE TRIGGER catalog_native_version_update AFTER UPDATE OF status,number ON material_versions WHEN NOT EXISTS(SELECT 1 FROM material_deletion_members WHERE material_id=NEW.material_id)
BEGIN
 DELETE FROM catalog_fts WHERE kind='material' AND target_id=new.material_id;
 DELETE FROM catalog_fts WHERE kind='question' AND target_id IN (SELECT q.id FROM material_quiz_questions q JOIN material_versions v ON v.id=q.version_id WHERE v.material_id=new.material_id);
 INSERT INTO catalog_fts SELECT m.title,'material',m.id,NULL FROM materials m WHERE m.id=new.material_id AND m.archived_at IS NULL AND EXISTS (SELECT 1 FROM material_versions v WHERE v.material_id=m.id AND v.status='published');
 INSERT INTO catalog_fts SELECT q.prompt,'question',q.id,NULL FROM materials m JOIN material_versions v ON v.material_id=m.id JOIN material_quiz_questions q ON q.version_id=v.id WHERE m.id=new.material_id AND m.archived_at IS NULL AND v.status='published' AND v.number=(SELECT max(h.number) FROM material_versions h WHERE h.material_id=m.id AND h.status='published');
END;
--> statement-breakpoint
CREATE TRIGGER catalog_project_delete AFTER DELETE ON projects BEGIN DELETE FROM catalog_fts WHERE kind='project' AND target_id=old.id; END;
--> statement-breakpoint
CREATE TRIGGER catalog_project_insert AFTER INSERT ON projects BEGIN INSERT INTO catalog_fts VALUES(new.name, 'project', new.id, new.id); END;
--> statement-breakpoint
CREATE TRIGGER catalog_project_update AFTER UPDATE OF name ON projects BEGIN DELETE FROM catalog_fts WHERE kind='project' AND target_id=old.id; INSERT INTO catalog_fts VALUES(new.name, 'project', new.id, new.id); END;
--> statement-breakpoint
CREATE TRIGGER catalog_session_delete AFTER DELETE ON sessions BEGIN
    DELETE FROM catalog_fts WHERE kind = 'session' AND target_id = old.id;
END;
--> statement-breakpoint
CREATE TRIGGER catalog_session_insert AFTER INSERT ON sessions BEGIN
    INSERT INTO catalog_fts VALUES (new.title, 'session', new.id, NULL);
END;
--> statement-breakpoint
CREATE TRIGGER catalog_session_update AFTER UPDATE OF title ON sessions BEGIN
    DELETE FROM catalog_fts WHERE kind = 'session' AND target_id = old.id;
    INSERT INTO catalog_fts VALUES (new.title, 'session', new.id, NULL);
END;
--> statement-breakpoint
CREATE TRIGGER catalog_source_delete AFTER DELETE ON sources BEGIN DELETE FROM catalog_fts WHERE kind='source' AND target_id=old.id; END;
--> statement-breakpoint
CREATE TRIGGER catalog_source_insert AFTER INSERT ON sources BEGIN INSERT INTO catalog_fts VALUES(new.name, 'source', new.id, new.project_id); END;
--> statement-breakpoint
CREATE TRIGGER catalog_source_update AFTER UPDATE OF name,project_id ON sources BEGIN DELETE FROM catalog_fts WHERE kind='source' AND target_id=OLD.id; INSERT INTO catalog_fts VALUES(NEW.name,'source',NEW.id,NEW.project_id); END;
--> statement-breakpoint
CREATE TRIGGER chunks_fts_ad AFTER DELETE ON chunks BEGIN
    INSERT INTO chunks_fts (chunks_fts, rowid, text) VALUES ('delete', old.id, old.text);
END;
--> statement-breakpoint
CREATE TRIGGER chunks_fts_ai AFTER INSERT ON chunks BEGIN
    INSERT INTO chunks_fts (rowid, text) VALUES (new.id, new.text);
END;
--> statement-breakpoint
CREATE TRIGGER chunks_fts_au AFTER UPDATE OF text ON chunks BEGIN
    INSERT INTO chunks_fts (chunks_fts, rowid, text) VALUES ('delete', old.id, old.text);
    INSERT INTO chunks_fts (rowid, text) VALUES (new.id, new.text);
END;
--> statement-breakpoint
CREATE TRIGGER conversation_recording_posts_immutable BEFORE UPDATE ON conversation_recording_posts
BEGIN SELECT RAISE(ABORT,'conversation recording post is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER conversation_recording_posts_retain BEFORE DELETE ON conversation_recording_posts
WHEN EXISTS(SELECT 1 FROM sessions s WHERE s.id=OLD.session_id)
BEGIN SELECT RAISE(ABORT,'conversation recording post is retained'); END;
--> statement-breakpoint
CREATE TRIGGER conversation_recording_posts_validate_insert BEFORE INSERT ON conversation_recording_posts
WHEN NOT EXISTS (
 SELECT 1 FROM messages m JOIN sessions s ON s.id=m.session_id
 JOIN message_versions v ON v.id=m.active_version_id AND v.message_id=m.id
 JOIN message_parts p ON p.message_id=m.id AND p.ordinal=0 JOIN sources src ON src.id=p.source_id
 WHERE m.id=NEW.message_id AND m.session_id=NEW.session_id AND m.role='user' AND m.recording_ms IS NOT NULL AND m.recorded_in=src.id AND v.origin='typed' AND v.status='complete' AND v.text='' AND src.origin='recording' AND src.kind='audio' AND src.mime LIKE 'audio/%'
)
BEGIN SELECT RAISE(ABORT,'invalid conversation recording post'); END;
--> statement-breakpoint
CREATE TRIGGER conversation_reply_requests_history_update BEFORE UPDATE ON conversation_reply_requests WHEN EXISTS(SELECT 1 FROM material_history_requests WHERE request_id=OLD.request_id) BEGIN SELECT RAISE(ABORT,'retired context cannot restore content'); END;
--> statement-breakpoint
CREATE TRIGGER conversation_reply_sources_capture BEFORE INSERT ON conversation_reply_sources
WHEN (NEW.snapshot_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM conversation_reply_requests r,json_each(r.snapshot,'$.messages') m,json_each(m.value,'$.attachments') p
 WHERE r.request_id=NEW.request_id AND CAST(json_extract(p.value,'$.partId') AS INTEGER)=NEW.part_id
 AND CAST(json_extract(p.value,'$.sourceId') AS INTEGER)=NEW.source_id AND CAST(json_extract(p.value,'$.revision') AS INTEGER)=NEW.revision
 AND CAST(json_extract(p.value,'$.snapshotId') AS INTEGER)=NEW.snapshot_id)) OR (NEW.snapshot_id IS NULL AND NOT EXISTS(SELECT 1 FROM conversation_reply_requests r,json_each(r.snapshot,'$.pendingAttachments') p
 WHERE r.request_id=NEW.request_id AND CAST(json_extract(p.value,'$.partId') AS INTEGER)=NEW.part_id
 AND CAST(json_extract(p.value,'$.sourceId') AS INTEGER)=NEW.source_id AND CAST(json_extract(p.value,'$.inputRevision') AS INTEGER)=NEW.revision))
BEGIN SELECT RAISE(ABORT,'reply source pin does not match exact captured intent'); END;
--> statement-breakpoint
CREATE TRIGGER conversation_reply_sources_immutable BEFORE UPDATE ON conversation_reply_sources
WHEN NEW.request_id IS NOT OLD.request_id OR NEW.part_id IS NOT OLD.part_id OR NEW.source_id IS NOT OLD.source_id OR NEW.revision IS NOT OLD.revision
 OR (OLD.snapshot_id IS NOT NULL AND NEW.snapshot_id IS NOT OLD.snapshot_id) OR (NEW.snapshot_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM conversation_reply_requests r,json_each(r.snapshot,'$.messages') m,json_each(m.value,'$.attachments') p
 WHERE r.request_id=NEW.request_id AND CAST(json_extract(p.value,'$.partId') AS INTEGER)=NEW.part_id
 AND CAST(json_extract(p.value,'$.sourceId') AS INTEGER)=NEW.source_id AND CAST(json_extract(p.value,'$.revision') AS INTEGER)=NEW.revision
 AND CAST(json_extract(p.value,'$.snapshotId') AS INTEGER)=NEW.snapshot_id))
BEGIN SELECT RAISE(ABORT,'reply source identity is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER conversation_reply_sources_retained BEFORE DELETE ON conversation_reply_sources
WHEN EXISTS(SELECT 1 FROM conversation_reply_requests r WHERE r.request_id=OLD.request_id)
BEGIN SELECT RAISE(ABORT,'retained reply source pins require capture retirement'); END;
--> statement-breakpoint
CREATE TRIGGER document_asset_insert AFTER INSERT ON blocks WHEN new.kind='image'
BEGIN
INSERT INTO document_assets(document_id,block_id,source_id,revision)
SELECT new.document_id,new.editing_id,CAST(json_extract(new.content,'$.sourceId') AS INTEGER),json_extract(new.content,'$.revision');
END;
--> statement-breakpoint
CREATE TRIGGER document_asset_kind BEFORE INSERT ON document_assets
WHEN NOT EXISTS(SELECT 1 FROM blocks b WHERE b.document_id=new.document_id AND b.editing_id=new.block_id AND b.kind='image' AND CAST(json_extract(b.content,'$.sourceId') AS INTEGER)=new.source_id AND json_extract(b.content,'$.revision')=new.revision) OR NOT EXISTS(SELECT 1 FROM source_snapshots ss WHERE ss.source_id=new.source_id AND ss.revision=new.revision AND ss.kind='image' AND lower(ss.mime) LIKE 'image/%')
BEGIN SELECT RAISE(ABORT, 'managed image revision is unavailable'); END;
--> statement-breakpoint
CREATE TRIGGER document_asset_snapshot_delete BEFORE DELETE ON source_snapshots
WHEN EXISTS(SELECT 1 FROM document_assets a WHERE a.source_id=old.source_id AND a.revision=old.revision)
BEGIN SELECT RAISE(ABORT, 'retained document asset is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER document_asset_snapshot_update BEFORE UPDATE ON source_snapshots
WHEN EXISTS(SELECT 1 FROM document_assets a WHERE a.source_id=old.source_id AND a.revision=old.revision)
BEGIN SELECT RAISE(ABORT, 'retained document asset is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER document_asset_update AFTER UPDATE OF content,kind,editing_id,document_id ON blocks
BEGIN
DELETE FROM document_assets WHERE document_id=old.document_id AND block_id=old.editing_id;
INSERT INTO document_assets(document_id,block_id,source_id,revision)
SELECT new.document_id,new.editing_id,CAST(json_extract(new.content,'$.sourceId') AS INTEGER),json_extract(new.content,'$.revision') WHERE new.kind='image';
END;
--> statement-breakpoint
CREATE TRIGGER document_asset_update_forbidden BEFORE UPDATE ON document_assets
BEGIN SELECT RAISE(ABORT, 'asset associations follow canonical blocks'); END;
--> statement-breakpoint
CREATE TRIGGER generation_history_publication BEFORE UPDATE ON material_generation_requests WHEN EXISTS(SELECT 1 FROM material_history_requests WHERE request_id=OLD.id) AND NOT((NEW.cancelled=1 AND NEW.payload='{}' AND NEW.result_version_id IS NULL AND NEW.result_hash IS NULL) OR (NEW.result_version_id IS NULL AND NEW.result_hash IS NULL AND NEW.payload IS OLD.payload AND NEW.cancelled IS OLD.cancelled)) BEGIN SELECT RAISE(ABORT,'retired generation cannot publish'); END;
--> statement-breakpoint
CREATE TRIGGER history_reply_publication BEFORE UPDATE OF status,text ON message_versions WHEN EXISTS(SELECT 1 FROM conversation_reply_requests r JOIN material_history_requests h ON h.request_id=r.request_id WHERE r.version_id=NEW.id) BEGIN SELECT RAISE(ABORT,'retired reply cannot publish'); END;
--> statement-breakpoint
CREATE TRIGGER learning_practice_answer_immutable
BEFORE UPDATE OF answer ON material_quiz_responses
WHEN NEW.answer IS NOT OLD.answer AND EXISTS (
  SELECT 1 FROM learning_practice_slots p JOIN projects owner ON owner.id = p.project_id
  WHERE p.attempt_id = OLD.attempt_id AND p.status = 'answered'
)
BEGIN SELECT RAISE(ABORT, 'committed practice answers are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER learning_practice_control_identity
BEFORE UPDATE ON learning_practice_controls
WHEN NEW.project_id IS NOT OLD.project_id
  OR (OLD.enabled = 1 AND NEW.epoch IS NOT OLD.epoch)
  OR (OLD.enabled = 0 AND NEW.enabled = 1 AND NEW.epoch = OLD.epoch)
BEGIN SELECT RAISE(ABORT, 'practice control requires a fresh epoch'); END;
--> statement-breakpoint
CREATE TRIGGER learning_practice_control_retained
BEFORE DELETE ON learning_practice_controls
WHEN EXISTS (SELECT 1 FROM projects WHERE id = OLD.project_id)
BEGIN SELECT RAISE(ABORT, 'practice control is retained'); END;
--> statement-breakpoint
CREATE TRIGGER learning_practice_failure_clear
BEFORE UPDATE OF failure_kind ON learning_practice_slots
WHEN OLD.failure_kind IS NOT NULL AND NEW.failure_kind IS NULL
  AND NEW.generation_attempt = OLD.generation_attempt
  AND NEW.status = 'pending'
BEGIN SELECT RAISE(ABORT, 'practice failures require an explicit retry'); END;
--> statement-breakpoint
CREATE TRIGGER learning_practice_inputs_available BEFORE INSERT ON learning_practice_inputs
WHEN NEW.document_version_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM study_document_versions v JOIN study_documents d ON d.id=v.document_id
WHERE v.id=NEW.document_version_id AND v.status='published' AND d.archived_at IS NULL
AND NOT EXISTS(SELECT 1 FROM study_document_retirements r WHERE r.version_id=v.id))
BEGIN SELECT RAISE(ABORT,'exact authored learning input is unavailable'); END;
--> statement-breakpoint
CREATE TRIGGER learning_practice_inputs_capture BEFORE INSERT ON learning_practice_inputs
WHEN NOT EXISTS(SELECT 1 FROM learning_practice_slots p WHERE p.id=NEW.slot_id AND p.status IN ('pending','ready')
 AND json_extract(p.inputs,'$['||NEW.position||'].kind')=CASE WHEN NEW.document_version_id IS NULL THEN 'source' ELSE 'document' END
 AND json_extract(p.inputs,'$['||NEW.position||'].versionId') IS CASE WHEN NEW.document_version_id IS NULL THEN NULL ELSE CAST(NEW.document_version_id AS TEXT) END
 AND json_extract(p.inputs,'$['||NEW.position||'].sourceId') IS CASE WHEN NEW.source_id IS NULL THEN NULL ELSE CAST(NEW.source_id AS TEXT) END
 AND json_extract(p.inputs,'$['||NEW.position||'].revision') IS CASE WHEN NEW.source_revision IS NULL THEN NULL ELSE CAST(NEW.source_revision AS TEXT) END
 AND json_extract(p.inputs,'$['||NEW.position||'].snapshotId') IS CASE WHEN NEW.source_snapshot_id IS NULL THEN NULL ELSE CAST(NEW.source_snapshot_id AS TEXT) END)
BEGIN SELECT RAISE(ABORT,'practice evidence does not match exact capture'); END;
--> statement-breakpoint
CREATE TRIGGER learning_practice_inputs_immutable BEFORE UPDATE ON learning_practice_inputs
BEGIN SELECT RAISE(ABORT,'exact learning inputs are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER learning_practice_inputs_retained BEFORE DELETE ON learning_practice_inputs
WHEN EXISTS(SELECT 1 FROM learning_practice_slots p JOIN learning_practice_controls c ON c.project_id=p.project_id AND c.epoch=p.epoch
 WHERE p.id=OLD.slot_id AND p.status IN ('pending','ready') AND c.enabled=1)
BEGIN SELECT RAISE(ABORT,'active practice evidence is retained'); END;
--> statement-breakpoint
CREATE TRIGGER learning_practice_retry_capture
BEFORE INSERT ON learning_practice_slots
WHEN NEW.generation_attempt != 0 OR NEW.failure_kind IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'practice slots start with an unfailed first generation'); END;
--> statement-breakpoint
CREATE TRIGGER learning_practice_retry_transition
BEFORE UPDATE OF generation_attempt ON learning_practice_slots
WHEN NEW.generation_attempt IS NOT OLD.generation_attempt AND (
  OLD.status != 'pending' OR NEW.status != 'pending'
  OR OLD.failure_kind IS NULL OR NEW.failure_kind IS NOT NULL
  OR typeof(NEW.generation_attempt) != 'integer'
  OR NEW.generation_attempt != OLD.generation_attempt + 1
  OR NEW.generation_attempt > 9007199254740991
)
BEGIN SELECT RAISE(ABORT, 'practice retry must advance a failed generation exactly once'); END;
--> statement-breakpoint
CREATE TRIGGER learning_practice_selection_delete
BEFORE DELETE ON material_quiz_selections
WHEN ((EXISTS (
  SELECT 1 FROM learning_practice_slots p JOIN projects owner ON owner.id = p.project_id
  WHERE p.attempt_id = OLD.attempt_id AND p.status = 'answered'
)) AND NOT (EXISTS(SELECT 1 FROM material_deletion_members dm JOIN material_deletions d ON d.material_id=dm.deletion_id WHERE dm.material_id=(SELECT material_id FROM material_versions WHERE id=(SELECT version_id FROM material_quiz_attempts WHERE id=OLD.attempt_id)) AND d.status IN ('pending','failed')))) AND NOT (EXISTS(SELECT 1 FROM material_history_members m JOIN material_history_prunes p ON p.operation_id=m.operation_id WHERE m.version_id=(SELECT version_id FROM material_quiz_attempts WHERE id=OLD.attempt_id) AND p.status IN ('pending','failed')))
BEGIN SELECT RAISE(ABORT, 'committed practice answers are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER learning_practice_selection_insert
BEFORE INSERT ON material_quiz_selections
WHEN EXISTS (SELECT 1 FROM learning_practice_slots p WHERE p.attempt_id = NEW.attempt_id AND p.status = 'answered')
BEGIN SELECT RAISE(ABORT, 'committed practice answers are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER learning_practice_selection_update
BEFORE UPDATE ON material_quiz_selections
WHEN EXISTS (SELECT 1 FROM learning_practice_slots p WHERE p.attempt_id IN (OLD.attempt_id, NEW.attempt_id) AND p.status = 'answered')
BEGIN SELECT RAISE(ABORT, 'committed practice answers are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER learning_practice_slot_answer
BEFORE UPDATE OF status ON learning_practice_slots
WHEN NEW.status = 'answered' AND OLD.status != 'answered' AND NOT EXISTS (
  SELECT 1 FROM material_quiz_responses r WHERE r.attempt_id = NEW.attempt_id AND r.version_id = NEW.version_id
)
BEGIN SELECT RAISE(ABORT, 'practice answer requires a canonical response'); END;
--> statement-breakpoint
CREATE TRIGGER learning_practice_slot_capture
BEFORE INSERT ON learning_practice_slots
WHEN NEW.status != 'pending' OR NEW.version_id IS NOT NULL OR NEW.attempt_id IS NOT NULL
  OR NEW.kind IS NOT CASE WHEN NEW.ordinal % 3 = 2 THEN 'open' ELSE 'choice' END
  OR NOT EXISTS (SELECT 1 FROM learning_practice_controls c WHERE c.project_id = NEW.project_id AND c.epoch = NEW.epoch AND c.enabled = 1)
  OR (SELECT COUNT(*) FROM learning_practice_slots p WHERE p.project_id = NEW.project_id AND p.epoch = NEW.epoch AND p.status IN ('pending','ready')) >= 2
  OR NEW.ordinal != (SELECT COALESCE(MAX(p.ordinal) + 1, 0) FROM learning_practice_slots p WHERE p.project_id = NEW.project_id AND p.epoch = NEW.epoch)
  OR json_type(NEW.inputs) IS NOT 'array' OR json_array_length(NEW.inputs) NOT BETWEEN 1 AND 20
  OR (SELECT COUNT(DISTINCT value) FROM json_each(NEW.inputs)) != json_array_length(NEW.inputs)
  OR EXISTS(SELECT 1 FROM json_each(NEW.inputs) j WHERE
    (json_extract(j.value,'$.kind')='document' AND NOT EXISTS(
      SELECT 1 FROM study_document_versions v JOIN study_documents d ON d.id=v.document_id
      JOIN project_documents p ON p.document_id=d.id AND p.project_id=NEW.project_id
      WHERE CAST(v.id AS TEXT)=json_extract(j.value,'$.versionId') AND v.status='published' AND d.archived_at IS NULL
      AND NOT EXISTS(SELECT 1 FROM study_document_retirements r WHERE r.version_id=v.id)))
    OR (json_extract(j.value,'$.kind')='source' AND NOT EXISTS(
      SELECT 1 FROM source_extraction_revisions e JOIN sources s ON s.id=e.source_id
      WHERE CAST(e.source_id AS TEXT)=json_extract(j.value,'$.sourceId') AND CAST(e.revision AS TEXT)=json_extract(j.value,'$.revision')
      AND CAST(e.snapshot_id AS TEXT)=json_extract(j.value,'$.snapshotId') AND s.project_id=NEW.project_id))
    OR json_extract(j.value,'$.kind') IS NULL OR json_extract(j.value,'$.kind') NOT IN ('source','document'))
BEGIN SELECT RAISE(ABORT, 'invalid or unbounded practice slot capture'); END;
--> statement-breakpoint
CREATE TRIGGER learning_practice_slot_immutable
BEFORE UPDATE ON learning_practice_slots
WHEN ((NEW.id IS NOT OLD.id OR NEW.project_id IS NOT OLD.project_id OR NEW.epoch IS NOT OLD.epoch
  OR NEW.ordinal IS NOT OLD.ordinal OR NEW.kind IS NOT OLD.kind OR NEW.inputs IS NOT OLD.inputs
  OR (OLD.version_id IS NOT NULL AND (NEW.version_id IS NOT OLD.version_id OR NEW.attempt_id IS NOT OLD.attempt_id))
  OR (OLD.status IN ('answered','cancelled') AND NEW.status IS NOT OLD.status)
  OR (OLD.status = 'ready' AND NEW.status NOT IN ('ready','answered','cancelled'))
  OR (OLD.status = 'pending' AND NEW.status NOT IN ('pending','ready','cancelled'))) AND NOT (EXISTS(SELECT 1 FROM material_versions v JOIN material_deletion_members d ON d.material_id=v.material_id WHERE v.id=OLD.version_id) AND NEW.status='cancelled' AND NEW.version_id IS NULL AND NEW.attempt_id IS NULL AND NEW.id IS OLD.id AND NEW.project_id IS OLD.project_id AND NEW.epoch IS OLD.epoch AND NEW.ordinal IS OLD.ordinal AND NEW.kind IS OLD.kind AND NEW.inputs IS OLD.inputs AND NEW.generation_attempt IS OLD.generation_attempt AND NEW.failure_kind IS OLD.failure_kind)) AND NOT (EXISTS(SELECT 1 FROM material_history_members h JOIN material_history_prunes p ON p.operation_id=h.operation_id WHERE h.version_id=OLD.version_id AND p.status IN ('pending','failed')) AND NEW.status='cancelled' AND NEW.version_id IS NULL AND NEW.attempt_id IS NULL AND NEW.id IS OLD.id AND NEW.project_id IS OLD.project_id AND NEW.epoch IS OLD.epoch AND NEW.ordinal IS OLD.ordinal AND NEW.kind IS OLD.kind AND NEW.inputs IS OLD.inputs AND NEW.generation_attempt IS OLD.generation_attempt AND NEW.failure_kind IS OLD.failure_kind)
BEGIN SELECT RAISE(ABORT, 'practice slot intent and receipts are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER learning_practice_slot_publication
BEFORE UPDATE OF version_id,attempt_id,status ON learning_practice_slots
WHEN OLD.version_id IS NULL AND NEW.version_id IS NOT NULL AND (
  NEW.status != 'ready' OR NOT EXISTS (
    SELECT 1 FROM learning_practice_controls c JOIN material_generation_scopes g ON g.id = c.epoch AND g.project_id = c.project_id
    JOIN material_versions v ON v.id = NEW.version_id AND EXISTS(SELECT 1 FROM project_materials pm WHERE pm.material_id=v.material_id AND pm.project_id=c.project_id)
    JOIN material_generation_requests r ON r.id = NEW.id AND r.project_id = c.project_id AND r.result_version_id = v.id
    JOIN material_quiz_attempts a ON a.id = NEW.attempt_id AND a.version_id = v.id
    WHERE c.project_id = NEW.project_id AND c.epoch = NEW.epoch AND c.enabled = 1 AND g.enabled = 1
      AND v.status = 'published' AND v.kind = 'quiz' AND v.generation_request_id = NEW.id
      AND json_extract(r.payload, '$.scopeId') = NEW.epoch
      AND json_extract(r.payload, '$.questionSpec.count') = 1 AND json_extract(r.payload, '$.questionSpec.kind') = NEW.kind
      AND json_extract(r.payload, '$.inputs') = json(NEW.inputs)
      AND (SELECT COUNT(*) FROM material_quiz_questions q WHERE q.version_id = v.id) = 1
      AND NOT EXISTS (SELECT 1 FROM material_quiz_questions q WHERE q.version_id = v.id AND ((NEW.kind = 'open' AND q.kind != 'open') OR (NEW.kind = 'choice' AND q.kind NOT IN ('single_choice','multiple_choice'))))
  )
)
BEGIN SELECT RAISE(ABORT, 'practice publication does not match its slot'); END;
--> statement-breakpoint
CREATE TRIGGER learning_practice_slot_retained
BEFORE DELETE ON learning_practice_slots
WHEN EXISTS (SELECT 1 FROM projects WHERE id = OLD.project_id)
BEGIN SELECT RAISE(ABORT, 'practice slot is retained'); END;
--> statement-breakpoint
CREATE TRIGGER material_attempt_complete_answers BEFORE UPDATE OF status ON material_quiz_attempts
WHEN new.status='completed' AND EXISTS(SELECT 1 FROM material_quiz_responses r WHERE r.attempt_id=new.id AND r.question_kind IN ('single_choice','multiple_choice') AND NOT EXISTS(SELECT 1 FROM material_quiz_selections s WHERE s.attempt_id=r.attempt_id AND s.question_id=r.question_id))
BEGIN SELECT RAISE(ABORT, 'choice responses require a selection before completion'); END;
--> statement-breakpoint
CREATE TRIGGER material_attempt_delete BEFORE DELETE ON material_quiz_attempts
WHEN ((old.status='completed' AND EXISTS(SELECT 1 FROM material_versions v WHERE v.id=old.version_id AND v.status='published')) AND NOT (EXISTS(SELECT 1 FROM material_deletion_members dm JOIN material_deletions d ON d.material_id=dm.deletion_id WHERE dm.material_id=(SELECT material_id FROM material_versions WHERE id=OLD.version_id) AND d.status IN ('pending','failed')))) AND NOT (EXISTS(SELECT 1 FROM material_history_members m JOIN material_history_prunes p ON p.operation_id=m.operation_id WHERE m.version_id=OLD.version_id AND p.status IN ('pending','failed')))
BEGIN SELECT RAISE(ABORT, 'completed attempts cannot be deleted'); END;
--> statement-breakpoint
CREATE TRIGGER material_attempt_identity BEFORE UPDATE ON material_quiz_attempts
WHEN old.status='completed' OR new.id IS NOT old.id OR new.version_id IS NOT old.version_id OR new.started_at IS NOT old.started_at
BEGIN SELECT RAISE(ABORT, 'completed attempts and attempt identities are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_attempt_published BEFORE INSERT ON material_quiz_attempts
WHEN NOT EXISTS(SELECT 1 FROM material_versions v WHERE v.id=new.version_id AND v.status='published') OR new.status != 'in_progress'
BEGIN SELECT RAISE(ABORT, 'quiz attempts must start on a published quiz'); END;
--> statement-breakpoint
CREATE TRIGGER material_card_identity_update BEFORE UPDATE ON material_card_identities
WHEN new.id IS NOT old.id OR new.material_id IS NOT old.material_id OR new.kind IS NOT old.kind
BEGIN SELECT RAISE(ABORT, 'card identity ownership is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_card_reviews_history_insert BEFORE INSERT ON material_card_reviews WHEN EXISTS(SELECT 1 FROM material_history_members WHERE version_id=NEW.version_id) BEGIN SELECT RAISE(ABORT,'pruned practice content is unavailable'); END;
--> statement-breakpoint
CREATE TRIGGER material_deletion_context_insert BEFORE INSERT ON session_run_contexts
WHEN EXISTS(SELECT 1 FROM material_deletion_requests WHERE request_id=NEW.request_id)
 OR EXISTS(SELECT 1 FROM json_each(NEW.snapshot,'$.inputs') i JOIN material_deletion_members d ON CAST(d.material_id AS TEXT)=json_extract(i.value,'$.materialId'))
BEGIN SELECT RAISE(ABORT,'deleted Material cannot be captured'); END;
--> statement-breakpoint
CREATE TRIGGER material_deletion_identity BEFORE UPDATE ON material_deletions
WHEN NEW.material_id IS NOT OLD.material_id OR NEW.operation_id IS NOT OLD.operation_id OR NEW.selection IS NOT OLD.selection OR NEW.created_at IS NOT OLD.created_at
 OR (OLD.status='completed' AND (NEW.status IS NOT OLD.status OR NEW.phase IS NOT OLD.phase OR NEW.attempt IS NOT OLD.attempt OR NEW.completed_at IS NOT OLD.completed_at OR NEW.error_kind IS NOT OLD.error_kind))
BEGIN SELECT RAISE(ABORT,'deletion identity is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_deletion_member_valid BEFORE INSERT ON material_deletion_members
WHEN NOT EXISTS(SELECT 1 FROM material_deletions d JOIN json_each(d.selection) i WHERE d.material_id=NEW.deletion_id AND d.status='pending' AND CAST(i.value AS INTEGER)=NEW.material_id)
BEGIN SELECT RAISE(ABORT,'deletion member requires exact accepted selection'); END;
--> statement-breakpoint
CREATE TRIGGER material_deletion_members_delete_retained BEFORE DELETE ON material_deletion_members BEGIN SELECT RAISE(ABORT,'deletion ownership is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_deletion_members_update_retained BEFORE UPDATE ON material_deletion_members BEGIN SELECT RAISE(ABORT,'deletion ownership is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_deletion_publication BEFORE UPDATE OF status ON material_versions WHEN NEW.status='published' AND OLD.status!='published' AND (EXISTS(SELECT 1 FROM material_deletion_members WHERE material_id=NEW.material_id) OR EXISTS(SELECT 1 FROM material_deletion_requests WHERE request_id=NEW.generation_request_id)) BEGIN SELECT RAISE(ABORT,'deleted learning artifact cannot publish'); END;
--> statement-breakpoint
CREATE TRIGGER material_deletion_reply_insert BEFORE INSERT ON conversation_reply_requests
WHEN EXISTS(SELECT 1 FROM material_deletion_requests WHERE request_id=NEW.request_id)
 OR EXISTS(SELECT 1 FROM json_each(NEW.snapshot,'$.context.inputs') i JOIN material_deletion_members d ON CAST(d.material_id AS TEXT)=json_extract(i.value,'$.materialId'))
BEGIN SELECT RAISE(ABORT,'deleted Material cannot be captured'); END;
--> statement-breakpoint
CREATE TRIGGER material_deletion_reply_publication BEFORE UPDATE OF status,text ON message_versions
WHEN EXISTS(SELECT 1 FROM conversation_reply_requests r JOIN material_deletion_requests d ON d.request_id=r.request_id WHERE r.version_id=NEW.id)
BEGIN SELECT RAISE(ABORT,'retired reply cannot publish'); END;
--> statement-breakpoint
CREATE TRIGGER material_deletion_reply_update BEFORE UPDATE ON conversation_reply_requests
WHEN EXISTS(SELECT 1 FROM material_deletion_requests WHERE request_id=OLD.request_id)
BEGIN SELECT RAISE(ABORT,'retired reply cannot restore private captures'); END;
--> statement-breakpoint
CREATE TRIGGER material_deletion_requests_owned BEFORE INSERT ON material_deletion_requests
WHEN NOT EXISTS(SELECT 1 FROM material_deletions p WHERE p.material_id=NEW.deletion_id AND p.status='pending') OR NOT(
(NEW.kind='generation' AND EXISTS(SELECT 1 FROM material_versions v JOIN material_deletion_members m ON m.material_id=v.material_id WHERE v.generation_request_id=NEW.request_id AND m.deletion_id=NEW.deletion_id))
OR (NEW.kind='publication' AND EXISTS(SELECT 1 FROM workflow_events e JOIN material_versions v ON CAST(v.id AS TEXT)=json_extract(e.payload,'$.materialVersionId') JOIN material_deletion_members m ON m.material_id=v.material_id WHERE e.correlation_id=NEW.request_id AND e.type='MaterialPublished' AND m.deletion_id=NEW.deletion_id))
OR (NEW.kind='learning' AND (EXISTS(SELECT 1 FROM learning_practice_slots p JOIN material_versions v ON v.id=p.version_id JOIN material_deletion_members m ON m.material_id=v.material_id WHERE p.id=NEW.request_id AND m.deletion_id=NEW.deletion_id) OR EXISTS(SELECT 1 FROM workflow_events e JOIN material_quiz_attempts a ON CAST(a.id AS TEXT)=json_extract(e.payload,'$.attemptId') JOIN material_versions v ON v.id=a.version_id JOIN material_deletion_members m ON m.material_id=v.material_id WHERE e.correlation_id=NEW.request_id AND e.type='QuizAnswerSubmitted' AND m.deletion_id=NEW.deletion_id))))
BEGIN SELECT RAISE(ABORT,'retirement requires exact learning ownership'); END;
--> statement-breakpoint
CREATE TRIGGER material_deletion_requests_delete_retained BEFORE DELETE ON material_deletion_requests BEGIN SELECT RAISE(ABORT,'deletion ownership is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_deletion_requests_update_retained BEFORE UPDATE ON material_deletion_requests BEGIN SELECT RAISE(ABORT,'deletion ownership is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_deletion_retained BEFORE DELETE ON material_deletions
BEGIN SELECT RAISE(ABORT,'deletion barrier is retained'); END;
--> statement-breakpoint
CREATE TRIGGER material_deletion_search AFTER INSERT ON material_deletion_members BEGIN DELETE FROM catalog_fts WHERE (kind='material' AND target_id=NEW.material_id) OR (kind='question' AND target_id IN(SELECT q.id FROM material_quiz_questions q JOIN material_versions v ON v.id=q.version_id WHERE v.material_id=NEW.material_id)); END;
--> statement-breakpoint
CREATE TRIGGER material_deletion_title BEFORE UPDATE ON materials
WHEN EXISTS(SELECT 1 FROM material_deletion_members WHERE material_id=OLD.id) AND (NEW.title!='-' OR NEW.kind IS NOT OLD.kind OR NEW.id IS NOT OLD.id)
BEGIN SELECT RAISE(ABORT,'deleted Material metadata is unavailable'); END;
--> statement-breakpoint
CREATE TRIGGER material_deletion_version_insert BEFORE INSERT ON material_versions
WHEN EXISTS(SELECT 1 FROM material_deletion_members WHERE material_id=NEW.material_id)
BEGIN SELECT RAISE(ABORT,'deleted Material cannot create versions'); END;
--> statement-breakpoint
CREATE TRIGGER material_diagram_versions_delete_draft BEFORE DELETE ON material_diagram_versions
WHEN ((EXISTS(SELECT 1 FROM material_versions v WHERE v.id=old.version_id AND v.status='published')) AND NOT (EXISTS(SELECT 1 FROM material_deletion_members dm JOIN material_deletions d ON d.material_id=dm.deletion_id WHERE dm.material_id=(SELECT material_id FROM material_versions WHERE id=OLD.version_id) AND d.status IN ('pending','failed')))) AND NOT (EXISTS(SELECT 1 FROM material_history_members h JOIN material_history_prunes p ON p.operation_id=h.operation_id WHERE h.version_id=OLD.version_id AND p.status IN ('pending','failed')))
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_diagram_versions_deletion_insert BEFORE INSERT ON material_diagram_versions WHEN EXISTS(SELECT 1 FROM material_versions v JOIN material_deletion_members d ON d.material_id=v.material_id WHERE v.id=NEW.version_id) BEGIN SELECT RAISE(ABORT,'deleted Material cannot restore content'); END;
--> statement-breakpoint
CREATE TRIGGER material_diagram_versions_history_insert BEFORE INSERT ON material_diagram_versions WHEN EXISTS(SELECT 1 FROM material_history_members WHERE version_id=NEW.version_id) BEGIN SELECT RAISE(ABORT,'pruned version cannot restore content'); END;
--> statement-breakpoint
CREATE TRIGGER material_diagram_versions_history_update BEFORE UPDATE ON material_diagram_versions WHEN EXISTS(SELECT 1 FROM material_history_members WHERE version_id=NEW.version_id) BEGIN SELECT RAISE(ABORT,'pruned version cannot restore content'); END;
--> statement-breakpoint
CREATE TRIGGER material_diagram_versions_insert_draft BEFORE INSERT ON material_diagram_versions
WHEN EXISTS(SELECT 1 FROM material_versions v WHERE v.id=new.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_diagram_versions_update_draft BEFORE UPDATE ON material_diagram_versions
WHEN EXISTS(SELECT 1 FROM material_versions v WHERE v.id=old.version_id AND v.status='published') OR EXISTS(SELECT 1 FROM material_versions v WHERE v.id=new.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_evidence_citations_draft BEFORE INSERT ON material_evidence_citations
WHEN NOT EXISTS(SELECT 1 FROM material_versions WHERE id=NEW.version_id AND status='draft')
BEGIN SELECT RAISE(ABORT,'published learning citations are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_evidence_citations_immutable BEFORE UPDATE ON material_evidence_citations
BEGIN SELECT RAISE(ABORT,'exact learning citations are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_evidence_citations_retained BEFORE DELETE ON material_evidence_citations
WHEN EXISTS(SELECT 1 FROM material_versions WHERE id=OLD.version_id AND status='published') AND NOT (EXISTS(SELECT 1 FROM material_history_members WHERE version_id=OLD.version_id)
 OR EXISTS(SELECT 1 FROM material_versions v JOIN material_deletion_members d ON d.material_id=v.material_id WHERE v.id=OLD.version_id))
BEGIN SELECT RAISE(ABORT,'published learning citations are retained'); END;
--> statement-breakpoint
CREATE TRIGGER material_evidence_inputs_available BEFORE INSERT ON material_evidence_inputs
WHEN NEW.document_version_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM study_document_versions v JOIN study_documents d ON d.id=v.document_id
WHERE v.id=NEW.document_version_id AND v.status='published' AND d.archived_at IS NULL
AND NOT EXISTS(SELECT 1 FROM study_document_retirements r WHERE r.version_id=v.id))
BEGIN SELECT RAISE(ABORT,'exact authored learning input is unavailable'); END;
--> statement-breakpoint
CREATE TRIGGER material_evidence_inputs_immutable BEFORE UPDATE ON material_evidence_inputs
BEGIN SELECT RAISE(ABORT,'exact learning inputs are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_evidence_inputs_owner BEFORE INSERT ON material_evidence_inputs
WHEN (NEW.version_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM material_versions v WHERE v.id=NEW.version_id AND v.status='draft' AND v.kind IN ('diagram','quiz','flashcards')))
 OR (NEW.request_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM material_generation_requests r WHERE r.id=NEW.request_id AND r.cancelled=0 AND r.result_version_id IS NULL
 AND json_extract(r.payload,'$.inputs['||NEW.position||'].kind')=CASE WHEN NEW.document_version_id IS NULL THEN 'source' ELSE 'document' END
 AND json_extract(r.payload,'$.inputs['||NEW.position||'].versionId') IS CASE WHEN NEW.document_version_id IS NULL THEN NULL ELSE CAST(NEW.document_version_id AS TEXT) END
 AND json_extract(r.payload,'$.inputs['||NEW.position||'].sourceId') IS CASE WHEN NEW.source_id IS NULL THEN NULL ELSE CAST(NEW.source_id AS TEXT) END
 AND json_extract(r.payload,'$.inputs['||NEW.position||'].revision') IS CASE WHEN NEW.source_revision IS NULL THEN NULL ELSE CAST(NEW.source_revision AS TEXT) END
 AND json_extract(r.payload,'$.inputs['||NEW.position||'].snapshotId') IS CASE WHEN NEW.source_snapshot_id IS NULL THEN NULL ELSE CAST(NEW.source_snapshot_id AS TEXT) END))
BEGIN SELECT RAISE(ABORT,'exact learning input does not match its owner'); END;
--> statement-breakpoint
CREATE TRIGGER material_evidence_inputs_retained BEFORE DELETE ON material_evidence_inputs
WHEN (OLD.version_id IS NOT NULL AND EXISTS(SELECT 1 FROM material_versions WHERE id=OLD.version_id AND status='published')
 AND NOT (EXISTS(SELECT 1 FROM material_history_members WHERE version_id=OLD.version_id)
 OR EXISTS(SELECT 1 FROM material_versions v JOIN material_deletion_members d ON d.material_id=v.material_id WHERE v.id=OLD.version_id))) OR (OLD.request_id IS NOT NULL AND EXISTS(SELECT 1 FROM material_generation_requests r WHERE r.id=OLD.request_id AND r.cancelled=0))
BEGIN SELECT RAISE(ABORT,'published learning evidence is retained'); END;
--> statement-breakpoint
CREATE TRIGGER material_flashcard_entries_delete_draft BEFORE DELETE ON material_flashcard_entries
WHEN ((EXISTS(SELECT 1 FROM material_versions v WHERE v.id=old.version_id AND v.status='published')) AND NOT (EXISTS(SELECT 1 FROM material_deletion_members dm JOIN material_deletions d ON d.material_id=dm.deletion_id WHERE dm.material_id=(SELECT material_id FROM material_versions WHERE id=OLD.version_id) AND d.status IN ('pending','failed')))) AND NOT (EXISTS(SELECT 1 FROM material_history_members h JOIN material_history_prunes p ON p.operation_id=h.operation_id WHERE h.version_id=OLD.version_id AND p.status IN ('pending','failed')))
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_flashcard_entries_deletion_insert BEFORE INSERT ON material_flashcard_entries WHEN EXISTS(SELECT 1 FROM material_versions v JOIN material_deletion_members d ON d.material_id=v.material_id WHERE v.id=NEW.version_id) BEGIN SELECT RAISE(ABORT,'deleted Material cannot restore content'); END;
--> statement-breakpoint
CREATE TRIGGER material_flashcard_entries_history_insert BEFORE INSERT ON material_flashcard_entries WHEN EXISTS(SELECT 1 FROM material_history_members WHERE version_id=NEW.version_id) BEGIN SELECT RAISE(ABORT,'pruned version cannot restore content'); END;
--> statement-breakpoint
CREATE TRIGGER material_flashcard_entries_history_update BEFORE UPDATE ON material_flashcard_entries WHEN EXISTS(SELECT 1 FROM material_history_members WHERE version_id=NEW.version_id) BEGIN SELECT RAISE(ABORT,'pruned version cannot restore content'); END;
--> statement-breakpoint
CREATE TRIGGER material_flashcard_entries_insert_draft BEFORE INSERT ON material_flashcard_entries
WHEN EXISTS(SELECT 1 FROM material_versions v WHERE v.id=new.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_flashcard_entries_update_draft BEFORE UPDATE ON material_flashcard_entries
WHEN EXISTS(SELECT 1 FROM material_versions v WHERE v.id=old.version_id AND v.status='published') OR EXISTS(SELECT 1 FROM material_versions v WHERE v.id=new.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_flashcard_versions_delete_draft BEFORE DELETE ON material_flashcard_versions
WHEN ((EXISTS(SELECT 1 FROM material_versions v WHERE v.id=old.version_id AND v.status='published')) AND NOT (EXISTS(SELECT 1 FROM material_deletion_members dm JOIN material_deletions d ON d.material_id=dm.deletion_id WHERE dm.material_id=(SELECT material_id FROM material_versions WHERE id=OLD.version_id) AND d.status IN ('pending','failed')))) AND NOT (EXISTS(SELECT 1 FROM material_history_members h JOIN material_history_prunes p ON p.operation_id=h.operation_id WHERE h.version_id=OLD.version_id AND p.status IN ('pending','failed')))
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_flashcard_versions_deletion_insert BEFORE INSERT ON material_flashcard_versions WHEN EXISTS(SELECT 1 FROM material_versions v JOIN material_deletion_members d ON d.material_id=v.material_id WHERE v.id=NEW.version_id) BEGIN SELECT RAISE(ABORT,'deleted Material cannot restore content'); END;
--> statement-breakpoint
CREATE TRIGGER material_flashcard_versions_history_insert BEFORE INSERT ON material_flashcard_versions WHEN EXISTS(SELECT 1 FROM material_history_members WHERE version_id=NEW.version_id) BEGIN SELECT RAISE(ABORT,'pruned version cannot restore content'); END;
--> statement-breakpoint
CREATE TRIGGER material_flashcard_versions_history_update BEFORE UPDATE ON material_flashcard_versions WHEN EXISTS(SELECT 1 FROM material_history_members WHERE version_id=NEW.version_id) BEGIN SELECT RAISE(ABORT,'pruned version cannot restore content'); END;
--> statement-breakpoint
CREATE TRIGGER material_flashcard_versions_insert_draft BEFORE INSERT ON material_flashcard_versions
WHEN EXISTS(SELECT 1 FROM material_versions v WHERE v.id=new.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_flashcard_versions_update_draft BEFORE UPDATE ON material_flashcard_versions
WHEN EXISTS(SELECT 1 FROM material_versions v WHERE v.id=old.version_id AND v.status='published') OR EXISTS(SELECT 1 FROM material_versions v WHERE v.id=new.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_generation_binding_immutable BEFORE UPDATE OF generation_request_id ON material_versions
WHEN OLD.generation_request_id IS NOT NULL AND NEW.generation_request_id IS NOT OLD.generation_request_id
BEGIN SELECT RAISE(ABORT, 'generation binding is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_generation_cancel_fence BEFORE UPDATE ON material_generation_requests WHEN (OLD.cancelled=1 AND NEW.cancelled!=1) OR (NEW.cancelled=1 AND OLD.result_version_id IS NULL AND NEW.result_version_id IS NOT NULL) BEGIN SELECT RAISE(ABORT,'generation cancellation is permanent'); END;
--> statement-breakpoint
CREATE TRIGGER material_generation_intent_immutable BEFORE UPDATE ON material_generation_requests WHEN NEW.id IS NOT OLD.id OR NEW.project_id IS NOT OLD.project_id OR NEW.created_at IS NOT OLD.created_at OR (NEW.payload IS NOT OLD.payload AND NOT(NEW.payload='{}' AND NEW.cancelled=1 AND EXISTS(SELECT 1 FROM (SELECT request_id,kind FROM material_deletion_requests UNION ALL SELECT request_id,kind FROM material_history_requests) d WHERE d.request_id=OLD.id AND d.kind='generation'))) BEGIN SELECT RAISE(ABORT,'generation intent is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_generation_intent_insert BEFORE INSERT ON material_generation_requests
WHEN NEW.result_version_id IS NOT NULL OR NEW.result_hash IS NOT NULL
 OR json_type(NEW.payload,'$.inputs') IS NOT 'array' OR json_array_length(NEW.payload,'$.inputs') NOT BETWEEN 1 AND 20
 OR (SELECT COUNT(DISTINCT value) FROM json_each(NEW.payload,'$.inputs'))!=json_array_length(NEW.payload,'$.inputs')
 OR EXISTS(SELECT 1 FROM json_each(NEW.payload,'$.inputs') j WHERE j.type!='object'
 OR json_extract(j.value,'$.kind') IS NULL OR json_extract(j.value,'$.kind') NOT IN ('source','document')
 OR (json_extract(j.value,'$.kind')='document' AND (json_type(j.value,'$.versionId') IS NOT 'text'
 OR json_extract(j.value,'$.versionId') NOT GLOB '[1-9]*' OR json_extract(j.value,'$.versionId') GLOB '*[^0-9]*'))
 OR (json_extract(j.value,'$.kind')='source' AND (json_type(j.value,'$.sourceId') IS NOT 'text'
 OR json_extract(j.value,'$.sourceId') NOT GLOB '[1-9]*' OR json_extract(j.value,'$.sourceId') GLOB '*[^0-9]*'
 OR json_type(j.value,'$.revision') IS NOT 'text' OR json_extract(j.value,'$.revision') NOT GLOB '[1-9]*' OR json_extract(j.value,'$.revision') GLOB '*[^0-9]*'
 OR json_type(j.value,'$.snapshotId') IS NOT 'text' OR json_extract(j.value,'$.snapshotId') NOT GLOB '[1-9]*' OR json_extract(j.value,'$.snapshotId') GLOB '*[^0-9]*')))
BEGIN SELECT RAISE(ABORT,'invalid exact generation intent'); END;
--> statement-breakpoint
CREATE TRIGGER material_generation_intent_retained BEFORE DELETE ON material_generation_requests
WHEN 1
BEGIN SELECT RAISE(ABORT, 'generation intent cannot be deleted'); END;
--> statement-breakpoint
CREATE TRIGGER material_generation_publication_scope
BEFORE UPDATE OF status ON material_versions
WHEN NEW.status = 'published' AND OLD.status != 'published' AND EXISTS (
  SELECT 1 FROM material_generation_requests r
  WHERE r.id = NEW.generation_request_id AND json_extract(r.payload, '$.scopeId') IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM material_generation_scopes s
      WHERE s.id = json_extract(r.payload, '$.scopeId') AND s.project_id = r.project_id AND s.enabled = 1)
)
BEGIN SELECT RAISE(ABORT, 'generation scope is not active for publication'); END;
--> statement-breakpoint
CREATE TRIGGER material_generation_publish BEFORE UPDATE OF status ON material_versions
WHEN NEW.status='published' AND NEW.creator='agent' AND NEW.operation='generate' AND NOT EXISTS(SELECT 1 FROM material_generation_requests r JOIN material_versions v ON v.generation_request_id=r.id JOIN materials m ON m.id=v.material_id
 WHERE v.id=NEW.id AND r.cancelled=0 AND v.kind IN ('diagram','quiz','flashcards') AND json_extract(r.payload,'$.kind')=v.kind
 AND json_extract(r.payload,'$.title')=m.title AND json_extract(r.payload,'$.instruction') IS v.instruction
 AND EXISTS(SELECT 1 FROM project_materials p WHERE p.material_id=v.material_id AND p.project_id=r.project_id)
 AND json_array_length(r.payload,'$.inputs') BETWEEN 1 AND 20
 AND (SELECT COUNT(*) FROM material_evidence_inputs WHERE request_id=r.id)=json_array_length(r.payload,'$.inputs')
 AND NOT EXISTS(SELECT position,document_version_id,source_id,source_revision,source_snapshot_id FROM material_evidence_inputs WHERE request_id=r.id
 EXCEPT SELECT position,document_version_id,source_id,source_revision,source_snapshot_id FROM material_evidence_inputs WHERE version_id=v.id)
 AND NOT EXISTS(SELECT position,document_version_id,source_id,source_revision,source_snapshot_id FROM material_evidence_inputs WHERE version_id=v.id
 EXCEPT SELECT position,document_version_id,source_id,source_revision,source_snapshot_id FROM material_evidence_inputs WHERE request_id=r.id))
BEGIN SELECT RAISE(ABORT,'generated publication does not match exact request'); END;
--> statement-breakpoint
CREATE TRIGGER material_generation_question_publication
BEFORE UPDATE OF status ON material_versions
WHEN NEW.status = 'published' AND OLD.status != 'published' AND EXISTS (
  SELECT 1 FROM material_generation_requests r WHERE r.id = NEW.generation_request_id
    AND json_extract(r.payload, '$.questionSpec') IS NOT NULL AND (
      NEW.kind != 'quiz'
      OR (SELECT COUNT(*) FROM material_quiz_questions q WHERE q.version_id = NEW.id) != 1
      OR EXISTS (SELECT 1 FROM material_quiz_questions q WHERE q.version_id = NEW.id AND (
        (json_extract(r.payload, '$.questionSpec.kind') = 'open' AND q.kind != 'open')
        OR (json_extract(r.payload, '$.questionSpec.kind') = 'choice' AND q.kind NOT IN ('single_choice', 'multiple_choice'))
      ))
    )
)
BEGIN SELECT RAISE(ABORT, 'generated quiz does not match its captured question specification'); END;
--> statement-breakpoint
CREATE TRIGGER material_generation_question_specification
BEFORE INSERT ON material_generation_requests
WHEN json_extract(NEW.payload, '$.questionSpec') IS NOT NULL AND (
  json_type(NEW.payload, '$.questionSpec') IS NOT 'object'
  OR json_extract(NEW.payload, '$.kind') IS NOT 'quiz'
  OR json_extract(NEW.payload, '$.questionSpec.count') IS NOT 1
  OR json_extract(NEW.payload, '$.questionSpec.kind') IS NULL
  OR json_extract(NEW.payload, '$.questionSpec.kind') NOT IN ('choice', 'open')
)
BEGIN SELECT RAISE(ABORT, 'invalid generation question specification'); END;
--> statement-breakpoint
CREATE TRIGGER material_generation_receipt_scope
BEFORE UPDATE OF result_version_id ON material_generation_requests
WHEN OLD.result_version_id IS NULL AND NEW.result_version_id IS NOT NULL
  AND json_extract(NEW.payload, '$.scopeId') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM material_generation_scopes s
    WHERE s.id = json_extract(NEW.payload, '$.scopeId') AND s.project_id = NEW.project_id AND s.enabled = 1
  )
BEGIN SELECT RAISE(ABORT, 'generation scope is not active for publication'); END;
--> statement-breakpoint
CREATE TRIGGER material_generation_receipt_valid BEFORE UPDATE OF result_version_id,result_hash ON material_generation_requests
WHEN OLD.result_version_id IS NULL AND NEW.result_version_id IS NOT NULL AND (length(NEW.result_hash)!=64 OR NEW.result_hash GLOB '*[^0-9a-f]*'
 OR NOT EXISTS(SELECT 1 FROM material_generation_requests r JOIN material_versions v ON v.generation_request_id=r.id JOIN materials m ON m.id=v.material_id
 WHERE v.id=NEW.result_version_id AND r.cancelled=0 AND v.kind IN ('diagram','quiz','flashcards') AND json_extract(r.payload,'$.kind')=v.kind
 AND json_extract(r.payload,'$.title')=m.title AND json_extract(r.payload,'$.instruction') IS v.instruction
 AND EXISTS(SELECT 1 FROM project_materials p WHERE p.material_id=v.material_id AND p.project_id=r.project_id)
 AND json_array_length(r.payload,'$.inputs') BETWEEN 1 AND 20
 AND (SELECT COUNT(*) FROM material_evidence_inputs WHERE request_id=r.id)=json_array_length(r.payload,'$.inputs')
 AND NOT EXISTS(SELECT position,document_version_id,source_id,source_revision,source_snapshot_id FROM material_evidence_inputs WHERE request_id=r.id
 EXCEPT SELECT position,document_version_id,source_id,source_revision,source_snapshot_id FROM material_evidence_inputs WHERE version_id=v.id)
 AND NOT EXISTS(SELECT position,document_version_id,source_id,source_revision,source_snapshot_id FROM material_evidence_inputs WHERE version_id=v.id
 EXCEPT SELECT position,document_version_id,source_id,source_revision,source_snapshot_id FROM material_evidence_inputs WHERE request_id=r.id) AND r.id=NEW.id AND v.status='published'))
BEGIN SELECT RAISE(ABORT,'generated receipt does not match exact publication'); END;
--> statement-breakpoint
CREATE TRIGGER material_generation_request_scope
BEFORE INSERT ON material_generation_requests
WHEN json_extract(NEW.payload, '$.scopeId') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM material_generation_scopes s
  WHERE s.id = json_extract(NEW.payload, '$.scopeId') AND s.project_id = NEW.project_id AND s.enabled = 1
)
BEGIN SELECT RAISE(ABORT, 'generation scope is not active for this project'); END;
--> statement-breakpoint
CREATE TRIGGER material_generation_result_immutable BEFORE UPDATE OF result_version_id,result_hash ON material_generation_requests WHEN OLD.result_version_id IS NOT NULL AND (NEW.result_version_id IS NOT OLD.result_version_id OR NEW.result_hash IS NOT OLD.result_hash) AND NOT(NEW.result_version_id IS NULL AND NEW.result_hash IS NULL AND EXISTS(SELECT 1 FROM (SELECT request_id,kind FROM material_deletion_requests UNION ALL SELECT request_id,kind FROM material_history_requests) d WHERE d.request_id=OLD.id AND d.kind='generation')) BEGIN SELECT RAISE(ABORT,'generation result is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_generation_scope_immutable
BEFORE UPDATE ON material_generation_scopes
WHEN NEW.id IS NOT OLD.id OR NEW.project_id IS NOT OLD.project_id
  OR NEW.created_at IS NOT OLD.created_at OR (OLD.enabled = 0 AND NEW.enabled != 0)
BEGIN SELECT RAISE(ABORT, 'generation scope identity and closure are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_generation_scope_retained
BEFORE DELETE ON material_generation_scopes
WHEN EXISTS (SELECT 1 FROM projects WHERE id = OLD.project_id)
BEGIN SELECT RAISE(ABORT, 'generation scope cannot be deleted'); END;
--> statement-breakpoint
CREATE TRIGGER material_generation_active_publication BEFORE UPDATE OF status ON material_versions WHEN NEW.status='published' AND OLD.status!='published' AND EXISTS(SELECT 1 FROM material_generation_requests r WHERE r.id=NEW.generation_request_id AND r.cancelled=1) BEGIN SELECT RAISE(ABORT,'cancelled generation cannot publish'); END;
--> statement-breakpoint
CREATE TRIGGER material_generation_session_scope BEFORE INSERT ON material_generation_requests
WHEN NEW.project_id IS NULL OR json_extract(NEW.payload,'$.kind') IS NULL
 OR json_extract(NEW.payload,'$.kind') NOT IN ('diagram','quiz','flashcards')
 OR json_extract(NEW.payload,'$.documentTransform') IS NOT NULL
BEGIN SELECT RAISE(ABORT,'invalid learning generation scope'); END;
--> statement-breakpoint
CREATE TRIGGER material_history_members_delete BEFORE DELETE ON material_history_members BEGIN SELECT RAISE(ABORT,'history cleanup ownership is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_history_members_update BEFORE UPDATE ON material_history_members BEGIN SELECT RAISE(ABORT,'history cleanup ownership is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_history_members_valid BEFORE INSERT ON material_history_members WHEN NOT EXISTS(SELECT 1 FROM material_history_prunes p JOIN material_versions v ON v.material_id=p.material_id,json_each(p.selection) j WHERE p.operation_id=NEW.operation_id AND p.status='pending' AND v.id=NEW.version_id AND CAST(v.id AS TEXT)=j.value AND v.status='published' AND (SELECT count(*) FROM material_versions newer WHERE newer.material_id=v.material_id AND newer.status='published' AND newer.number>v.number AND NOT EXISTS(SELECT 1 FROM material_history_members retired WHERE retired.version_id=newer.id))>=p.keep_latest) BEGIN SELECT RAISE(ABORT,'history cannot prune protected learning versions'); END;
--> statement-breakpoint
CREATE TRIGGER material_history_prunes_identity BEFORE UPDATE ON material_history_prunes
WHEN NEW.operation_id IS NOT OLD.operation_id OR NEW.material_id IS NOT OLD.material_id OR NEW.keep_latest IS NOT OLD.keep_latest OR NEW.token IS NOT OLD.token OR NEW.selection IS NOT OLD.selection OR NEW.created_at IS NOT OLD.created_at OR OLD.status='completed'
OR NOT ((NEW.attempt=OLD.attempt AND NEW.status IN ('failed','completed')) OR (NEW.attempt=OLD.attempt+1 AND NEW.status='pending' AND OLD.status IN ('pending','failed')))
BEGIN SELECT RAISE(ABORT,'history intent and completion are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_history_prunes_retained BEFORE DELETE ON material_history_prunes BEGIN SELECT RAISE(ABORT,'history cleanup is retained'); END;
--> statement-breakpoint
CREATE TRIGGER material_history_prunes_valid BEFORE INSERT ON material_history_prunes
WHEN NEW.status!='pending' OR NEW.attempt!=1 OR EXISTS(SELECT 1 FROM material_deletion_members WHERE material_id=NEW.material_id)
OR EXISTS(SELECT 1 FROM material_history_prunes WHERE material_id=NEW.material_id AND status!='completed')
OR EXISTS(SELECT 1 FROM json_each(NEW.selection) j LEFT JOIN material_versions v ON CAST(v.id AS TEXT)=j.value WHERE v.id IS NULL OR v.material_id!=NEW.material_id)
BEGIN SELECT RAISE(ABORT,'history requires available exact scope'); END;
--> statement-breakpoint
CREATE TRIGGER material_history_requests_delete BEFORE DELETE ON material_history_requests BEGIN SELECT RAISE(ABORT,'history cleanup ownership is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_history_requests_update BEFORE UPDATE ON material_history_requests BEGIN SELECT RAISE(ABORT,'history cleanup ownership is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_history_requests_owned BEFORE INSERT ON material_history_requests
WHEN NOT EXISTS(SELECT 1 FROM material_history_prunes p WHERE p.operation_id=NEW.operation_id AND p.status='pending') OR NOT(
(NEW.kind='generation' AND EXISTS(SELECT 1 FROM material_versions v JOIN material_history_members m ON m.version_id=v.id WHERE v.generation_request_id=NEW.request_id AND m.operation_id=NEW.operation_id))
OR (NEW.kind='publication' AND EXISTS(SELECT 1 FROM workflow_events e JOIN material_versions v ON CAST(v.id AS TEXT)=json_extract(e.payload,'$.materialVersionId') JOIN material_history_members m ON m.version_id=v.id WHERE e.correlation_id=NEW.request_id AND e.type='MaterialPublished' AND m.operation_id=NEW.operation_id))
OR (NEW.kind='learning' AND (EXISTS(SELECT 1 FROM learning_practice_slots p JOIN material_versions v ON v.id=p.version_id JOIN material_history_members m ON m.version_id=v.id WHERE p.id=NEW.request_id AND m.operation_id=NEW.operation_id) OR EXISTS(SELECT 1 FROM workflow_events e JOIN material_quiz_attempts a ON CAST(a.id AS TEXT)=json_extract(e.payload,'$.attemptId') JOIN material_versions v ON v.id=a.version_id JOIN material_history_members m ON m.version_id=v.id WHERE e.correlation_id=NEW.request_id AND e.type='QuizAnswerSubmitted' AND m.operation_id=NEW.operation_id))))
BEGIN SELECT RAISE(ABORT,'retirement requires exact learning ownership'); END;
--> statement-breakpoint
CREATE TRIGGER material_identity_update BEFORE UPDATE ON materials
WHEN new.id IS NOT old.id OR new.kind IS NOT old.kind
BEGIN SELECT RAISE(ABORT, 'material ownership and kind are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_publish_flashcards BEFORE UPDATE OF status ON material_versions
WHEN new.status='published' AND new.kind='flashcards' AND NOT EXISTS(SELECT 1 FROM material_flashcard_entries WHERE version_id=new.id)
BEGIN SELECT RAISE(ABORT, 'published flashcards require at least one card'); END;
--> statement-breakpoint
CREATE TRIGGER material_publish_quiz BEFORE UPDATE OF status ON material_versions
WHEN new.status='published' AND new.kind='quiz' AND (
      NOT EXISTS(SELECT 1 FROM material_quiz_questions WHERE version_id=new.id)
      OR EXISTS(SELECT 1 FROM material_quiz_questions q WHERE q.version_id=new.id AND (
        (q.kind='open' AND NOT EXISTS(SELECT 1 FROM material_quiz_open_answers a WHERE a.question_id=q.id))
        OR (q.kind IN ('single_choice','multiple_choice') AND (
          (SELECT count(*) FROM material_quiz_choices c WHERE c.question_id=q.id) NOT BETWEEN 2 AND 100
          OR (q.kind='single_choice' AND (SELECT count(*) FROM material_quiz_choices c WHERE c.question_id=q.id AND c.is_correct=1) != 1)
          OR (q.kind='multiple_choice' AND NOT EXISTS(SELECT 1 FROM material_quiz_choices c WHERE c.question_id=q.id AND c.is_correct=1))
        ))
      )))
BEGIN SELECT RAISE(ABORT, 'published quizzes require complete questions and correct answers'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_attempts_history_insert BEFORE INSERT ON material_quiz_attempts WHEN EXISTS(SELECT 1 FROM material_history_members WHERE version_id=NEW.version_id) BEGIN SELECT RAISE(ABORT,'pruned practice content is unavailable'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_choices_delete_draft BEFORE DELETE ON material_quiz_choices
WHEN ((EXISTS(SELECT 1 FROM material_versions v WHERE v.id=(SELECT version_id FROM material_quiz_questions WHERE id=old.question_id) AND v.status='published')) AND NOT (EXISTS(SELECT 1 FROM material_deletion_members dm JOIN material_deletions d ON d.material_id=dm.deletion_id WHERE dm.material_id=(SELECT material_id FROM material_versions WHERE id=(SELECT version_id FROM material_quiz_questions WHERE id=OLD.question_id)) AND d.status IN ('pending','failed')))) AND NOT (EXISTS(SELECT 1 FROM material_history_members h JOIN material_history_prunes p ON p.operation_id=h.operation_id WHERE h.version_id=(SELECT version_id FROM material_quiz_questions WHERE id=OLD.question_id) AND p.status IN ('pending','failed')))
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_choices_insert_draft BEFORE INSERT ON material_quiz_choices
WHEN EXISTS(SELECT 1 FROM material_versions v WHERE v.id=(SELECT version_id FROM material_quiz_questions WHERE id=new.question_id) AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_choices_update_draft BEFORE UPDATE ON material_quiz_choices
WHEN EXISTS(SELECT 1 FROM material_versions v WHERE v.id=(SELECT version_id FROM material_quiz_questions WHERE id=old.question_id) AND v.status='published') OR EXISTS(SELECT 1 FROM material_versions v WHERE v.id=(SELECT version_id FROM material_quiz_questions WHERE id=new.question_id) AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_open_answers_delete_draft BEFORE DELETE ON material_quiz_open_answers
WHEN ((EXISTS(SELECT 1 FROM material_versions v WHERE v.id=(SELECT version_id FROM material_quiz_questions WHERE id=old.question_id) AND v.status='published')) AND NOT (EXISTS(SELECT 1 FROM material_deletion_members dm JOIN material_deletions d ON d.material_id=dm.deletion_id WHERE dm.material_id=(SELECT material_id FROM material_versions WHERE id=(SELECT version_id FROM material_quiz_questions WHERE id=OLD.question_id)) AND d.status IN ('pending','failed')))) AND NOT (EXISTS(SELECT 1 FROM material_history_members h JOIN material_history_prunes p ON p.operation_id=h.operation_id WHERE h.version_id=(SELECT version_id FROM material_quiz_questions WHERE id=OLD.question_id) AND p.status IN ('pending','failed')))
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_open_answers_insert_draft BEFORE INSERT ON material_quiz_open_answers
WHEN EXISTS(SELECT 1 FROM material_versions v WHERE v.id=(SELECT version_id FROM material_quiz_questions WHERE id=new.question_id) AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_open_answers_update_draft BEFORE UPDATE ON material_quiz_open_answers
WHEN EXISTS(SELECT 1 FROM material_versions v WHERE v.id=(SELECT version_id FROM material_quiz_questions WHERE id=old.question_id) AND v.status='published') OR EXISTS(SELECT 1 FROM material_versions v WHERE v.id=(SELECT version_id FROM material_quiz_questions WHERE id=new.question_id) AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_questions_delete_draft BEFORE DELETE ON material_quiz_questions
WHEN ((EXISTS(SELECT 1 FROM material_versions v WHERE v.id=old.version_id AND v.status='published')) AND NOT (EXISTS(SELECT 1 FROM material_deletion_members dm JOIN material_deletions d ON d.material_id=dm.deletion_id WHERE dm.material_id=(SELECT material_id FROM material_versions WHERE id=OLD.version_id) AND d.status IN ('pending','failed')))) AND NOT (EXISTS(SELECT 1 FROM material_history_members h JOIN material_history_prunes p ON p.operation_id=h.operation_id WHERE h.version_id=OLD.version_id AND p.status IN ('pending','failed')))
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_questions_deletion_insert BEFORE INSERT ON material_quiz_questions WHEN EXISTS(SELECT 1 FROM material_versions v JOIN material_deletion_members d ON d.material_id=v.material_id WHERE v.id=NEW.version_id) BEGIN SELECT RAISE(ABORT,'deleted Material cannot restore content'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_questions_history_insert BEFORE INSERT ON material_quiz_questions WHEN EXISTS(SELECT 1 FROM material_history_members WHERE version_id=NEW.version_id) BEGIN SELECT RAISE(ABORT,'pruned version cannot restore content'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_questions_history_update BEFORE UPDATE ON material_quiz_questions WHEN EXISTS(SELECT 1 FROM material_history_members WHERE version_id=NEW.version_id) BEGIN SELECT RAISE(ABORT,'pruned version cannot restore content'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_questions_insert_draft BEFORE INSERT ON material_quiz_questions
WHEN EXISTS(SELECT 1 FROM material_versions v WHERE v.id=new.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_questions_update_draft BEFORE UPDATE ON material_quiz_questions
WHEN EXISTS(SELECT 1 FROM material_versions v WHERE v.id=old.version_id AND v.status='published') OR EXISTS(SELECT 1 FROM material_versions v WHERE v.id=new.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_responses_completed_delete BEFORE DELETE ON material_quiz_responses
WHEN ((EXISTS(SELECT 1 FROM material_quiz_attempts a JOIN material_versions v ON v.id=a.version_id WHERE a.id=old.attempt_id AND a.status='completed')) AND NOT (EXISTS(SELECT 1 FROM material_deletion_members dm JOIN material_deletions d ON d.material_id=dm.deletion_id WHERE dm.material_id=(SELECT material_id FROM material_versions WHERE id=OLD.version_id) AND d.status IN ('pending','failed')))) AND NOT (EXISTS(SELECT 1 FROM material_history_members m JOIN material_history_prunes p ON p.operation_id=m.operation_id WHERE m.version_id=OLD.version_id AND p.status IN ('pending','failed')))
BEGIN SELECT RAISE(ABORT, 'completed quiz answers are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_responses_completed_insert BEFORE INSERT ON material_quiz_responses
WHEN EXISTS(SELECT 1 FROM material_quiz_attempts a JOIN material_versions v ON v.id=a.version_id WHERE a.id=new.attempt_id AND a.status='completed')
BEGIN SELECT RAISE(ABORT, 'completed quiz answers are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_responses_completed_update BEFORE UPDATE ON material_quiz_responses
WHEN EXISTS(SELECT 1 FROM material_quiz_attempts a JOIN material_versions v ON v.id=a.version_id WHERE a.id=old.attempt_id AND a.status='completed') OR EXISTS(SELECT 1 FROM material_quiz_attempts a JOIN material_versions v ON v.id=a.version_id WHERE a.id=new.attempt_id AND a.status='completed')
BEGIN SELECT RAISE(ABORT, 'completed quiz answers are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_selections_completed_delete BEFORE DELETE ON material_quiz_selections
WHEN ((EXISTS(SELECT 1 FROM material_quiz_attempts a JOIN material_versions v ON v.id=a.version_id WHERE a.id=old.attempt_id AND a.status='completed')) AND NOT (EXISTS(SELECT 1 FROM material_deletion_members dm JOIN material_deletions d ON d.material_id=dm.deletion_id WHERE dm.material_id=(SELECT material_id FROM material_versions WHERE id=(SELECT version_id FROM material_quiz_attempts WHERE id=OLD.attempt_id)) AND d.status IN ('pending','failed')))) AND NOT (EXISTS(SELECT 1 FROM material_history_members m JOIN material_history_prunes p ON p.operation_id=m.operation_id WHERE m.version_id=(SELECT version_id FROM material_quiz_attempts WHERE id=OLD.attempt_id) AND p.status IN ('pending','failed')))
BEGIN SELECT RAISE(ABORT, 'completed quiz answers are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_selections_completed_insert BEFORE INSERT ON material_quiz_selections
WHEN EXISTS(SELECT 1 FROM material_quiz_attempts a JOIN material_versions v ON v.id=a.version_id WHERE a.id=new.attempt_id AND a.status='completed')
BEGIN SELECT RAISE(ABORT, 'completed quiz answers are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_selections_completed_update BEFORE UPDATE ON material_quiz_selections
WHEN EXISTS(SELECT 1 FROM material_quiz_attempts a JOIN material_versions v ON v.id=a.version_id WHERE a.id=old.attempt_id AND a.status='completed') OR EXISTS(SELECT 1 FROM material_quiz_attempts a JOIN material_versions v ON v.id=a.version_id WHERE a.id=new.attempt_id AND a.status='completed')
BEGIN SELECT RAISE(ABORT, 'completed quiz answers are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_versions_delete_draft BEFORE DELETE ON material_quiz_versions
WHEN ((EXISTS(SELECT 1 FROM material_versions v WHERE v.id=old.version_id AND v.status='published')) AND NOT (EXISTS(SELECT 1 FROM material_deletion_members dm JOIN material_deletions d ON d.material_id=dm.deletion_id WHERE dm.material_id=(SELECT material_id FROM material_versions WHERE id=OLD.version_id) AND d.status IN ('pending','failed')))) AND NOT (EXISTS(SELECT 1 FROM material_history_members h JOIN material_history_prunes p ON p.operation_id=h.operation_id WHERE h.version_id=OLD.version_id AND p.status IN ('pending','failed')))
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_versions_deletion_insert BEFORE INSERT ON material_quiz_versions WHEN EXISTS(SELECT 1 FROM material_versions v JOIN material_deletion_members d ON d.material_id=v.material_id WHERE v.id=NEW.version_id) BEGIN SELECT RAISE(ABORT,'deleted Material cannot restore content'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_versions_history_insert BEFORE INSERT ON material_quiz_versions WHEN EXISTS(SELECT 1 FROM material_history_members WHERE version_id=NEW.version_id) BEGIN SELECT RAISE(ABORT,'pruned version cannot restore content'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_versions_history_update BEFORE UPDATE ON material_quiz_versions WHEN EXISTS(SELECT 1 FROM material_history_members WHERE version_id=NEW.version_id) BEGIN SELECT RAISE(ABORT,'pruned version cannot restore content'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_versions_insert_draft BEFORE INSERT ON material_quiz_versions
WHEN EXISTS(SELECT 1 FROM material_versions v WHERE v.id=new.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_versions_update_draft BEFORE UPDATE ON material_quiz_versions
WHEN EXISTS(SELECT 1 FROM material_versions v WHERE v.id=old.version_id AND v.status='published') OR EXISTS(SELECT 1 FROM material_versions v WHERE v.id=new.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_review_delete BEFORE DELETE ON material_card_reviews
WHEN ((EXISTS(SELECT 1 FROM material_versions v WHERE v.id=old.version_id AND v.status='published')) AND NOT (EXISTS(SELECT 1 FROM material_deletion_members dm JOIN material_deletions d ON d.material_id=dm.deletion_id WHERE dm.material_id=(SELECT material_id FROM material_versions WHERE id=OLD.version_id) AND d.status IN ('pending','failed')))) AND NOT (EXISTS(SELECT 1 FROM material_history_members m JOIN material_history_prunes p ON p.operation_id=m.operation_id WHERE m.version_id=OLD.version_id AND p.status IN ('pending','failed')))
BEGIN SELECT RAISE(ABORT, 'card reviews are append only'); END;
--> statement-breakpoint
CREATE TRIGGER material_review_published BEFORE INSERT ON material_card_reviews
WHEN NOT EXISTS(SELECT 1 FROM material_versions v WHERE v.id=new.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'card reviews require a published deck'); END;
--> statement-breakpoint
CREATE TRIGGER material_review_update BEFORE UPDATE ON material_card_reviews
WHEN EXISTS(SELECT 1 FROM material_versions v WHERE v.id=old.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'card reviews are append only'); END;
--> statement-breakpoint
CREATE TRIGGER material_selection_single_insert BEFORE INSERT ON material_quiz_selections
WHEN (SELECT question_kind FROM material_quiz_responses WHERE attempt_id=new.attempt_id AND question_id=new.question_id)='single_choice'
          AND EXISTS(SELECT 1 FROM material_quiz_selections s WHERE s.attempt_id=new.attempt_id AND s.question_id=new.question_id )
BEGIN SELECT RAISE(ABORT, 'single choice answers may select exactly one choice'); END;
--> statement-breakpoint
CREATE TRIGGER material_selection_single_update BEFORE UPDATE ON material_quiz_selections
WHEN (SELECT question_kind FROM material_quiz_responses WHERE attempt_id=new.attempt_id AND question_id=new.question_id)='single_choice'
          AND EXISTS(SELECT 1 FROM material_quiz_selections s WHERE s.attempt_id=new.attempt_id AND s.question_id=new.question_id AND (s.attempt_id != old.attempt_id OR s.question_id != old.question_id OR s.choice_id != old.choice_id))
BEGIN SELECT RAISE(ABORT, 'single choice answers may select exactly one choice'); END;
--> statement-breakpoint
CREATE TRIGGER material_version_parents_delete_draft BEFORE DELETE ON material_version_parents
WHEN EXISTS(SELECT 1 FROM material_versions v WHERE v.id=old.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_version_parents_history_capture BEFORE INSERT ON material_version_parents WHEN EXISTS(SELECT 1 FROM material_history_members WHERE version_id=NEW.parent_version_id) BEGIN SELECT RAISE(ABORT,'pruned version cannot be linked as new input'); END;
--> statement-breakpoint
CREATE TRIGGER material_version_parents_history_insert BEFORE INSERT ON material_version_parents WHEN EXISTS(SELECT 1 FROM material_history_members WHERE version_id=NEW.version_id) BEGIN SELECT RAISE(ABORT,'pruned version cannot restore content'); END;
--> statement-breakpoint
CREATE TRIGGER material_version_parents_history_update BEFORE UPDATE ON material_version_parents WHEN EXISTS(SELECT 1 FROM material_history_members WHERE version_id=NEW.version_id) BEGIN SELECT RAISE(ABORT,'pruned version cannot restore content'); END;
--> statement-breakpoint
CREATE TRIGGER material_version_parents_insert_draft BEFORE INSERT ON material_version_parents
WHEN EXISTS(SELECT 1 FROM material_versions v WHERE v.id=new.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_version_parents_target_insert BEFORE INSERT ON material_version_parents
WHEN NOT EXISTS(SELECT 1 FROM material_versions v WHERE v.id=new.parent_version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'version dependencies must already be published'); END;
--> statement-breakpoint
CREATE TRIGGER material_version_parents_target_update BEFORE UPDATE ON material_version_parents
WHEN NOT EXISTS(SELECT 1 FROM material_versions v WHERE v.id=new.parent_version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'version dependencies must already be published'); END;
--> statement-breakpoint
CREATE TRIGGER material_version_parents_update_draft BEFORE UPDATE ON material_version_parents
WHEN EXISTS(SELECT 1 FROM material_versions v WHERE v.id=old.version_id AND v.status='published') OR EXISTS(SELECT 1 FROM material_versions v WHERE v.id=new.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_versions_delete_frozen BEFORE DELETE ON material_versions
WHEN EXISTS(SELECT 1 FROM material_versions v WHERE v.id=old.id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published versions cannot be deleted'); END;
--> statement-breakpoint
CREATE TRIGGER material_versions_frozen BEFORE UPDATE ON material_versions WHEN (OLD.status='published' OR NEW.id IS NOT OLD.id OR NEW.material_id IS NOT OLD.material_id OR NEW.kind IS NOT OLD.kind OR NEW.number IS NOT OLD.number OR NEW.created_at IS NOT OLD.created_at)
AND NOT(NEW.id IS OLD.id AND NEW.material_id IS OLD.material_id AND NEW.kind IS OLD.kind AND NEW.number IS OLD.number AND NEW.status IS OLD.status AND NEW.operation IS OLD.operation AND NEW.creator IS OLD.creator AND NEW.generation_request_id IS OLD.generation_request_id AND NEW.created_at IS OLD.created_at AND NEW.published_at IS OLD.published_at AND ((NEW.instruction IS NULL AND NEW.language IS NULL AND (EXISTS(SELECT 1 FROM material_deletion_members m JOIN material_deletions d ON d.material_id=m.deletion_id WHERE m.material_id=OLD.material_id AND d.status IN('pending','failed')) OR EXISTS(SELECT 1 FROM material_history_members m JOIN material_history_prunes p ON p.operation_id=m.operation_id WHERE m.version_id=OLD.id AND p.status IN('pending','failed')))) OR (NEW.instruction IS NULL AND NEW.language IS OLD.language AND EXISTS(SELECT 1 FROM (SELECT request_id,kind FROM material_deletion_requests UNION ALL SELECT request_id,kind FROM material_history_requests) d JOIN material_generation_requests r ON r.id=d.request_id WHERE d.request_id=OLD.generation_request_id AND d.kind='generation' AND OLD.instruction IS json_extract(r.payload,'$.instruction'))))) BEGIN SELECT RAISE(ABORT,'published versions and version identities are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_versions_publish_payload BEFORE UPDATE OF status ON material_versions WHEN NEW.status='published' AND CASE NEW.kind WHEN 'diagram' THEN NOT EXISTS(SELECT 1 FROM material_diagram_versions WHERE version_id=NEW.id) WHEN 'quiz' THEN NOT EXISTS(SELECT 1 FROM material_quiz_versions WHERE version_id=NEW.id) WHEN 'flashcards' THEN NOT EXISTS(SELECT 1 FROM material_flashcard_versions WHERE version_id=NEW.id) ELSE 1 END BEGIN SELECT RAISE(ABORT,'published learning artifacts require their typed payload'); END;
--> statement-breakpoint
CREATE TRIGGER material_versions_start_draft BEFORE INSERT ON material_versions
WHEN new.status != 'draft'
BEGIN SELECT RAISE(ABORT, 'material versions must start as drafts'); END;
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
CREATE TRIGGER recording_chunks_captured_delete BEFORE DELETE ON recording_chunks
WHEN EXISTS(SELECT 1 FROM recording_posts p JOIN sessions sess ON sess.id=p.session_id WHERE p.recording_id=OLD.recording_id)

BEGIN SELECT RAISE(ABORT,'captured recording PCM is retained'); END;
--> statement-breakpoint
CREATE TRIGGER recording_chunks_captured_insert BEFORE INSERT ON recording_chunks
WHEN EXISTS(SELECT 1 FROM recording_posts WHERE recording_id=NEW.recording_id) OR (SELECT COALESCE(SUM(length(pcm)),0) FROM recording_chunks WHERE recording_id=NEW.recording_id)+length(NEW.pcm)>115200000
BEGIN SELECT RAISE(ABORT,'recording is captured or exceeds its size limit'); END;
--> statement-breakpoint
CREATE TRIGGER recording_chunks_captured_update BEFORE UPDATE ON recording_chunks
WHEN EXISTS(SELECT 1 FROM recording_posts WHERE recording_id IN(OLD.recording_id,NEW.recording_id))
BEGIN SELECT RAISE(ABORT,'captured recording PCM is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER recording_posts_immutable BEFORE UPDATE ON recording_posts
WHEN (NEW.request_id IS NOT OLD.request_id OR NEW.recording_id IS NOT OLD.recording_id OR NEW.session_id IS NOT OLD.session_id OR NEW.name IS NOT OLD.name OR NEW.wav IS NOT OLD.wav OR NEW.duration_ms IS NOT OLD.duration_ms OR NEW.created_at IS NOT OLD.created_at OR (OLD.message_id IS NOT NULL AND (NEW.message_id IS NOT OLD.message_id OR NEW.source_id IS NOT OLD.source_id)))
BEGIN SELECT RAISE(ABORT,'recording snapshot and receipt are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER recording_posts_result_valid BEFORE UPDATE OF source_id,message_id ON recording_posts
WHEN NEW.message_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM source_recording_imports src JOIN conversation_recording_posts p ON p.request_id=src.request_id WHERE src.request_id=NEW.request_id AND src.source_id=NEW.source_id AND src.project_id IS NEW.project_id AND src.session_id=NEW.session_id AND p.session_id=NEW.session_id AND p.message_id=NEW.message_id)
BEGIN SELECT RAISE(ABORT,'recording receipt does not identify its output'); END;
--> statement-breakpoint
CREATE TRIGGER recording_posts_retain BEFORE DELETE ON recording_posts
WHEN EXISTS(SELECT 1 FROM sessions s WHERE s.id=OLD.session_id)
BEGIN SELECT RAISE(ABORT,'recording intent is retained'); END;
--> statement-breakpoint
CREATE TRIGGER recording_posts_validate_insert BEFORE INSERT ON recording_posts
WHEN NEW.source_id IS NOT NULL OR NEW.message_id IS NOT NULL OR NOT EXISTS(SELECT 1 FROM recordings r JOIN sessions s ON s.id=r.session_id WHERE r.id=NEW.recording_id AND r.session_id=NEW.session_id) OR NEW.duration_ms != CAST((length(NEW.wav)-44+16)/32 AS INTEGER)
BEGIN SELECT RAISE(ABORT,'invalid recording snapshot'); END;
--> statement-breakpoint
CREATE TRIGGER recordings_captured_update BEFORE UPDATE ON recordings
WHEN EXISTS(SELECT 1 FROM recording_posts WHERE recording_id IN(OLD.id,NEW.id))
BEGIN SELECT RAISE(ABORT,'captured recording identity is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER retired_event_insert BEFORE INSERT ON workflow_events
WHEN EXISTS(SELECT 1 FROM workflow_retired_correlations WHERE correlation_id=NEW.correlation_id AND event_type=NEW.type)
BEGIN SELECT RAISE(ABORT, 'retired workflow cannot emit'); END;
--> statement-breakpoint
CREATE TRIGGER retired_event_payload BEFORE UPDATE ON workflow_events
WHEN OLD.payload='{}' AND EXISTS(SELECT 1 FROM workflow_retired_correlations WHERE correlation_id=OLD.correlation_id AND event_type=OLD.type)
 AND NEW.payload!='{}'
BEGIN SELECT RAISE(ABORT, 'retired event cannot restore content'); END;
--> statement-breakpoint
CREATE TRIGGER retired_execution_insert BEFORE INSERT ON workflow_executions
WHEN EXISTS(SELECT 1 FROM workflow_retired_correlations WHERE correlation_id=json_extract(NEW.payload,'$.event.correlationId') AND event_type=json_extract(NEW.payload,'$.event.type'))
BEGIN SELECT RAISE(ABORT, 'retired workflow cannot restart'); END;
--> statement-breakpoint
CREATE TRIGGER retired_execution_payload BEFORE UPDATE ON workflow_executions
WHEN OLD.payload='{}' AND EXISTS(SELECT 1 FROM workflow_retired_executions WHERE execution_id=OLD.execution_id)
 AND (NEW.payload!='{}' OR NEW.result IS NOT NULL OR NEW.owner_token IS NOT NULL OR NEW.status NOT IN ('completed','cancelled'))
BEGIN SELECT RAISE(ABORT, 'retired workflow cannot restore checkpoints'); END;
--> statement-breakpoint
CREATE TRIGGER session_deletion_correlations_delete_retained BEFORE DELETE ON session_deletion_correlations
BEGIN SELECT RAISE(ABORT, 'retirement identities are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER session_deletion_correlations_update_retained BEFORE UPDATE ON session_deletion_correlations
BEGIN SELECT RAISE(ABORT, 'retirement identities are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER session_deletion_identity BEFORE UPDATE ON session_deletions
WHEN NEW.session_id IS NOT OLD.session_id OR NEW.operation_id IS NOT OLD.operation_id OR NEW.created_at IS NOT OLD.created_at
 OR (OLD.status='completed' AND (NEW.status!='completed' OR NEW.completed_at IS NOT OLD.completed_at OR NEW.error_kind IS NOT OLD.error_kind))
BEGIN SELECT RAISE(ABORT, 'deletion identity and completion are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER session_deletion_retained BEFORE DELETE ON session_deletions
BEGIN SELECT RAISE(ABORT, 'deletion barriers are retained'); END;
--> statement-breakpoint
CREATE TRIGGER session_id_not_reusable BEFORE INSERT ON sessions
WHEN EXISTS(SELECT 1 FROM session_deletions WHERE session_id=NEW.id)
BEGIN SELECT RAISE(ABORT, 'deleted session identity cannot be reused'); END;
--> statement-breakpoint
CREATE TRIGGER session_retired_intent_recapture BEFORE INSERT ON session_run_contexts
WHEN EXISTS(SELECT 1 FROM session_retired_intents r WHERE r.session_id=NEW.session_id AND r.intent_key=NEW.intent_key)
BEGIN SELECT RAISE(ABORT,'retired intent cannot capture newer content'); END;
--> statement-breakpoint
CREATE TRIGGER session_retired_intents_delete BEFORE DELETE ON session_retired_intents BEGIN SELECT RAISE(ABORT,'retired intent identity is retained'); END;
--> statement-breakpoint
CREATE TRIGGER session_retired_intents_owner BEFORE INSERT ON session_retired_intents
WHEN NOT EXISTS(SELECT 1 FROM session_run_contexts c WHERE c.request_id=NEW.request_id AND c.session_id=NEW.session_id AND c.intent_key=NEW.intent_key)
BEGIN SELECT RAISE(ABORT,'retired intent requires its exact captured identity'); END;
--> statement-breakpoint
CREATE TRIGGER session_retired_intents_update BEFORE UPDATE ON session_retired_intents BEGIN SELECT RAISE(ABORT,'retired intent identity is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER session_run_contexts_history_insert BEFORE INSERT ON session_run_contexts
WHEN EXISTS(SELECT 1 FROM material_history_requests WHERE request_id=NEW.request_id)
OR EXISTS(SELECT 1 FROM json_each(NEW.snapshot,'$.inputs') j JOIN material_history_members m ON CAST(m.version_id AS TEXT)=json_extract(j.value,'$.versionId'))
BEGIN SELECT RAISE(ABORT,'pruned input cannot be captured'); END;
--> statement-breakpoint
CREATE TRIGGER session_run_contexts_history_update BEFORE UPDATE ON session_run_contexts WHEN EXISTS(SELECT 1 FROM material_history_requests WHERE request_id=OLD.request_id) BEGIN SELECT RAISE(ABORT,'retired context cannot restore content'); END;
--> statement-breakpoint
CREATE TRIGGER session_run_contexts_immutable BEFORE UPDATE ON session_run_contexts BEGIN SELECT RAISE(ABORT,'captured session context is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER sessions_history_selection BEFORE UPDATE OF selection ON sessions WHEN EXISTS(SELECT 1 FROM json_each(NEW.selection) j JOIN material_history_members m ON CAST(m.version_id AS TEXT)=json_extract(j.value,'$.versionId')) BEGIN SELECT RAISE(ABORT,'pruned version cannot be selected'); END;
--> statement-breakpoint
CREATE TRIGGER source_extraction_revision_owner BEFORE INSERT ON source_extraction_revisions
WHEN NOT EXISTS(SELECT 1 FROM content_snapshots WHERE id=NEW.snapshot_id AND source_id=NEW.source_id)
BEGIN SELECT RAISE(ABORT,'exact extraction must belong to its source'); END;
--> statement-breakpoint
CREATE TRIGGER source_extraction_revisions_insert AFTER INSERT ON source_processing
 WHEN NEW.document_id IS NOT NULL AND NEW.published_request_id=NEW.request_id AND EXISTS(SELECT 1 FROM source_snapshots WHERE source_id=NEW.source_id AND revision=NEW.revision)
 BEGIN INSERT OR IGNORE INTO source_extraction_revisions(source_id,revision,snapshot_id) VALUES(NEW.source_id,NEW.revision,NEW.document_id); END;
--> statement-breakpoint
CREATE TRIGGER source_extraction_revisions_update AFTER UPDATE ON source_processing
 WHEN NEW.document_id IS NOT NULL AND NEW.published_request_id=NEW.request_id AND EXISTS(SELECT 1 FROM source_snapshots WHERE source_id=NEW.source_id AND revision=NEW.revision)
 BEGIN INSERT OR IGNORE INTO source_extraction_revisions(source_id,revision,snapshot_id) VALUES(NEW.source_id,NEW.revision,NEW.document_id); END;
--> statement-breakpoint
CREATE TRIGGER source_recording_bytes_frozen BEFORE UPDATE ON source_blobs
WHEN EXISTS(SELECT 1 FROM source_recording_imports WHERE source_id IN(OLD.source_id,NEW.source_id))
BEGIN SELECT RAISE(ABORT,'imported recording bytes are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER source_recording_bytes_retained BEFORE DELETE ON source_blobs
WHEN (EXISTS(SELECT 1 FROM source_recording_imports r JOIN sources src ON src.id=r.source_id WHERE r.source_id=OLD.source_id))
BEGIN SELECT RAISE(ABORT,'imported recording bytes are retained'); END;
--> statement-breakpoint
CREATE TRIGGER source_recording_capture_frozen BEFORE UPDATE ON sources
WHEN (EXISTS(SELECT 1 FROM source_recording_imports WHERE source_id=OLD.id) AND (
 NEW.id IS NOT OLD.id OR NEW.origin IS NOT OLD.origin OR NEW.kind IS NOT OLD.kind OR NEW.mime IS NOT OLD.mime OR NEW.name IS NOT OLD.name OR NEW.size_bytes IS NOT OLD.size_bytes OR NEW.sha256 IS NOT OLD.sha256 OR NEW.uri IS NOT OLD.uri OR NEW.created_at IS NOT OLD.created_at))
BEGIN SELECT RAISE(ABORT,'imported recording metadata is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER source_recording_imports_immutable BEFORE UPDATE ON source_recording_imports
WHEN NEW.request_id IS NOT OLD.request_id OR NEW.session_id IS NOT OLD.session_id OR NEW.source_id IS NOT OLD.source_id OR NEW.input_hash IS NOT OLD.input_hash OR NEW.duration_ms IS NOT OLD.duration_ms
BEGIN SELECT RAISE(ABORT,'recording source receipt is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER source_recording_imports_retain BEFORE DELETE ON source_recording_imports
WHEN EXISTS(SELECT 1 FROM projects WHERE id=OLD.project_id)
BEGIN SELECT RAISE(ABORT,'recording source receipt is retained'); END;
--> statement-breakpoint
CREATE TRIGGER source_recording_imports_validate_insert BEFORE INSERT ON source_recording_imports
WHEN NOT EXISTS(SELECT 1 FROM sources src JOIN source_blobs b ON b.source_id=src.id JOIN sessions s ON s.id=NEW.session_id WHERE src.id=NEW.source_id AND src.project_id IS NEW.project_id AND src.origin='recording' AND src.kind='audio' AND src.mime='audio/wav' AND NEW.duration_ms=CAST((length(b.bytes)-44+16)/32 AS INTEGER))
BEGIN SELECT RAISE(ABORT,'invalid recording source receipt'); END;
--> statement-breakpoint
CREATE TRIGGER source_snapshots_published_delete BEFORE DELETE ON source_snapshots WHEN EXISTS(SELECT 1 FROM (SELECT source_id,revision,snapshot_id FROM conversation_reply_sources UNION ALL SELECT source_id,revision,snapshot_id FROM session_context_sources UNION ALL SELECT source_id,source_revision,source_snapshot_id FROM study_document_inputs WHERE source_id IS NOT NULL UNION ALL SELECT source_id,source_revision,source_snapshot_id FROM material_evidence_inputs WHERE source_id IS NOT NULL UNION ALL SELECT source_id,source_revision,source_snapshot_id FROM learning_practice_inputs WHERE source_id IS NOT NULL) p WHERE p.source_id=OLD.source_id AND p.revision=OLD.revision) BEGIN SELECT RAISE(ABORT,'exact input pins source revision'); END;
--> statement-breakpoint
CREATE TRIGGER source_snapshots_published_update BEFORE UPDATE ON source_snapshots WHEN EXISTS(SELECT 1 FROM source_extraction_revisions e WHERE e.source_id=OLD.source_id AND e.revision=OLD.revision) OR EXISTS(SELECT 1 FROM (SELECT source_id,revision,snapshot_id FROM conversation_reply_sources UNION ALL SELECT source_id,revision,snapshot_id FROM session_context_sources UNION ALL SELECT source_id,source_revision,source_snapshot_id FROM study_document_inputs WHERE source_id IS NOT NULL UNION ALL SELECT source_id,source_revision,source_snapshot_id FROM material_evidence_inputs WHERE source_id IS NOT NULL UNION ALL SELECT source_id,source_revision,source_snapshot_id FROM learning_practice_inputs WHERE source_id IS NOT NULL) p WHERE p.source_id=OLD.source_id AND p.revision=OLD.revision) BEGIN SELECT RAISE(ABORT,'retained source revision is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_annotation_head BEFORE UPDATE ON study_document_annotations
WHEN NEW.id!=OLD.id OR NEW.document_id!=OLD.document_id OR NEW.revision!=OLD.revision+1 OR NOT EXISTS(SELECT 1 FROM study_document_annotation_revisions WHERE annotation_id=NEW.id AND revision=NEW.revision)
BEGIN SELECT RAISE(ABORT,'annotation head requires exact next revision'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_annotation_revision_owner BEFORE INSERT ON study_document_annotation_revisions
WHEN NOT EXISTS(SELECT 1 FROM study_document_annotations a JOIN study_document_versions v ON v.id=NEW.version_id AND v.document_id=a.document_id WHERE a.id=NEW.annotation_id AND a.document_id=NEW.document_id AND v.status='published' AND (NEW.revision=a.revision+1 OR (NEW.revision=1 AND a.revision=1))
AND CAST(json_extract(NEW.payload,'$.id') AS INTEGER)=NEW.annotation_id AND CAST(json_extract(NEW.payload,'$.revision') AS INTEGER)=NEW.revision AND CAST(json_extract(NEW.payload,'$.target.documentId') AS INTEGER)=NEW.document_id AND CAST(json_extract(NEW.payload,'$.target.range.versionId') AS INTEGER)=NEW.version_id AND CAST(json_extract(NEW.payload,'$.target.range.snapshotId') AS INTEGER)=NEW.snapshot_id)
BEGIN SELECT RAISE(ABORT,'annotation revision requires exact published ownership'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_annotation_revisions_delete BEFORE DELETE ON study_document_annotation_revisions BEGIN SELECT RAISE(ABORT,'annotation history is append-only'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_annotation_revisions_update BEFORE UPDATE ON study_document_annotation_revisions BEGIN SELECT RAISE(ABORT,'annotation revisions are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_annotation_snapshot BEFORE INSERT ON study_document_annotation_revisions
WHEN NOT EXISTS(SELECT 1 FROM study_document_versions WHERE id=NEW.version_id AND document_id=NEW.document_id AND content_snapshot_id=NEW.snapshot_id)
BEGIN SELECT RAISE(ABORT,'annotation target must match exact authored version'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_annotations_delete BEFORE DELETE ON study_document_annotations BEGIN SELECT RAISE(ABORT,'annotation identity is retained'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_blocks_delete BEFORE DELETE ON blocks WHEN EXISTS(SELECT 1 FROM study_document_versions v WHERE v.status='published' AND (v.content_snapshot_id=OLD.document_id) AND NOT EXISTS(SELECT 1 FROM study_document_retirements r WHERE r.version_id=v.id)) BEGIN SELECT RAISE(ABORT,'published document content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_blocks_insert BEFORE INSERT ON blocks
WHEN EXISTS (SELECT 1 FROM study_document_versions v WHERE v.status='published' AND (v.content_snapshot_id=NEW.document_id))
BEGIN SELECT RAISE(ABORT, 'published document content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_blocks_update BEFORE UPDATE ON blocks WHEN EXISTS(SELECT 1 FROM study_document_versions v WHERE v.status='published' AND (v.content_snapshot_id=OLD.document_id OR v.content_snapshot_id=NEW.document_id) AND NOT EXISTS(SELECT 1 FROM study_document_retirements r WHERE r.version_id=v.id)) BEGIN SELECT RAISE(ABORT,'published document content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_citation_assessments_immutable_update BEFORE UPDATE ON study_document_citation_assessments BEGIN SELECT RAISE(ABORT,'document evidence is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_citations_delete BEFORE DELETE ON study_document_citations WHEN (EXISTS(SELECT 1 FROM study_document_versions WHERE id=OLD.version_id AND status='published')) AND NOT EXISTS(SELECT 1 FROM study_document_retirements WHERE version_id=OLD.version_id) BEGIN SELECT RAISE(ABORT,'published document evidence is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_citations_insert BEFORE INSERT ON study_document_citations WHEN EXISTS(SELECT 1 FROM study_document_versions WHERE id=NEW.version_id AND status='published') BEGIN SELECT RAISE(ABORT,'published document evidence is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_citations_update BEFORE UPDATE ON study_document_citations WHEN EXISTS(SELECT 1 FROM study_document_versions WHERE id IN(OLD.version_id,NEW.version_id) AND status='published') BEGIN SELECT RAISE(ABORT,'published document evidence is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_content_snapshots_delete BEFORE DELETE ON content_snapshots WHEN EXISTS(SELECT 1 FROM study_document_versions v WHERE v.status='published' AND (v.content_snapshot_id=OLD.id) AND NOT EXISTS(SELECT 1 FROM study_document_retirements r WHERE r.version_id=v.id)) BEGIN SELECT RAISE(ABORT,'published document content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_content_snapshots_update BEFORE UPDATE ON content_snapshots WHEN EXISTS(SELECT 1 FROM study_document_versions v WHERE v.status='published' AND (v.content_snapshot_id=OLD.id OR v.content_snapshot_id=NEW.id) AND NOT EXISTS(SELECT 1 FROM study_document_retirements r WHERE r.version_id=v.id)) BEGIN SELECT RAISE(ABORT,'published document content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_document_assets_delete BEFORE DELETE ON document_assets WHEN EXISTS(SELECT 1 FROM study_document_versions v WHERE v.status='published' AND (v.content_snapshot_id=OLD.document_id) AND NOT EXISTS(SELECT 1 FROM study_document_retirements r WHERE r.version_id=v.id)) BEGIN SELECT RAISE(ABORT,'published document content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_document_assets_insert BEFORE INSERT ON document_assets
WHEN EXISTS (SELECT 1 FROM study_document_versions v WHERE v.status='published' AND (v.content_snapshot_id=NEW.document_id))
BEGIN SELECT RAISE(ABORT, 'published document content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_document_assets_update BEFORE UPDATE ON document_assets WHEN EXISTS(SELECT 1 FROM study_document_versions v WHERE v.status='published' AND (v.content_snapshot_id=OLD.document_id OR v.content_snapshot_id=NEW.document_id) AND NOT EXISTS(SELECT 1 FROM study_document_retirements r WHERE r.version_id=v.id)) BEGIN SELECT RAISE(ABORT,'published document content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_edit_receipts_delete BEFORE DELETE ON study_document_edit_receipts
BEGIN SELECT RAISE(ABORT, 'document edit receipts are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_edit_receipts_update BEFORE UPDATE ON study_document_edit_receipts
BEGIN SELECT RAISE(ABORT, 'document edit receipts are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_generation_intent BEFORE UPDATE ON study_document_generation_requests
WHEN NEW.id IS NOT OLD.id OR NEW.document_id IS NOT OLD.document_id OR NEW.expected_version_id IS NOT OLD.expected_version_id OR NEW.intent_hash IS NOT OLD.intent_hash OR NEW.created_at IS NOT OLD.created_at OR (NEW.session_id IS NOT OLD.session_id AND NEW.session_id IS NOT NULL) OR (OLD.result_version_id IS NOT NULL AND NEW.result_version_id IS NOT OLD.result_version_id)
BEGIN SELECT RAISE(ABORT,'generation publication intent and result are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_input_message BEFORE INSERT ON study_document_inputs
WHEN NEW.exact_message_version_id IS NOT NULL AND NOT (
 (NEW.message_version_id=NEW.exact_message_version_id AND EXISTS(SELECT 1 FROM message_versions WHERE id=NEW.message_version_id AND status='complete')) OR
 (NEW.message_version_id IS NULL AND EXISTS(SELECT 1 FROM study_document_inputs i JOIN study_document_versions old ON old.id=i.version_id JOIN study_document_versions child ON child.id=NEW.version_id AND child.document_id=old.document_id WHERE i.exact_message_version_id=NEW.exact_message_version_id AND old.status='published')))
BEGIN SELECT RAISE(ABORT,'message input requires exact complete or inherited message version'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_input_publication BEFORE UPDATE OF status ON study_document_versions
WHEN NEW.status='published' AND EXISTS(SELECT 1 FROM study_document_inputs i JOIN study_document_versions target ON target.id=i.document_version_id WHERE i.version_id=NEW.id AND (target.status!='published' OR target.id=NEW.id OR EXISTS(SELECT 1 FROM study_document_retirements r WHERE r.version_id=target.id)))
BEGIN SELECT RAISE(ABORT,'authored publication requires retained published exact document inputs'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_inputs_delete BEFORE DELETE ON study_document_inputs WHEN (EXISTS(SELECT 1 FROM study_document_versions WHERE id=OLD.version_id AND status='published')) AND NOT EXISTS(SELECT 1 FROM study_document_retirements WHERE version_id=OLD.version_id) BEGIN SELECT RAISE(ABORT,'published document evidence is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_inputs_insert BEFORE INSERT ON study_document_inputs WHEN EXISTS(SELECT 1 FROM study_document_versions WHERE id=NEW.version_id AND status='published') BEGIN SELECT RAISE(ABORT,'published document evidence is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_inputs_update BEFORE UPDATE ON study_document_inputs WHEN (EXISTS(SELECT 1 FROM study_document_versions WHERE id=NEW.version_id AND status='published') OR EXISTS(SELECT 1 FROM study_document_versions WHERE id=OLD.version_id AND status='published')) AND NOT (OLD.message_version_id IS NOT NULL AND NEW.message_version_id IS NULL AND NEW.id IS OLD.id AND NEW.version_id IS OLD.version_id AND NEW.request_id IS OLD.request_id AND NEW.position IS OLD.position AND NEW.document_version_id IS OLD.document_version_id AND NEW.source_id IS OLD.source_id AND NEW.source_revision IS OLD.source_revision AND NEW.source_snapshot_id IS OLD.source_snapshot_id AND NEW.exact_message_version_id IS OLD.exact_message_version_id) BEGIN SELECT RAISE(ABORT,'published document evidence is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_parents_delete BEFORE DELETE ON study_document_version_parents
WHEN EXISTS (SELECT 1 FROM study_document_versions WHERE id=OLD.version_id AND status='published')
BEGIN SELECT RAISE(ABORT, 'published document ancestry is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_parents_insert BEFORE INSERT ON study_document_version_parents
WHEN NOT EXISTS (SELECT 1 FROM study_document_versions child JOIN study_document_versions parent
 ON parent.id=NEW.parent_version_id WHERE child.id=NEW.version_id AND child.status='draft'
 AND parent.status='published' AND child.document_id=NEW.document_id AND parent.document_id=NEW.document_id
 AND parent.number<child.number)
BEGIN SELECT RAISE(ABORT, 'document ancestry requires an earlier published version of the same document'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_parents_update BEFORE UPDATE ON study_document_version_parents
BEGIN SELECT RAISE(ABORT, 'document ancestry cannot be rewritten'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_proposal_receipts_immutable_update BEFORE UPDATE ON study_document_proposal_receipts BEGIN SELECT RAISE(ABORT,'document evidence is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_proposals_immutable_update BEFORE UPDATE ON study_document_proposals BEGIN SELECT RAISE(ABORT,'document evidence is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_retirement_dependencies BEFORE INSERT ON study_document_retirements
WHEN EXISTS(SELECT 1 FROM study_document_inputs i JOIN study_document_versions v ON v.id=i.version_id JOIN study_document_versions target ON target.id=NEW.version_id WHERE i.document_version_id=NEW.version_id AND v.document_id!=target.document_id AND NOT EXISTS(SELECT 1 FROM study_document_retirements r WHERE r.version_id=v.id))
 OR EXISTS(SELECT 1 FROM study_document_inputs WHERE document_version_id=NEW.version_id AND request_id IS NOT NULL)
 OR EXISTS(SELECT 1 FROM session_context_documents WHERE version_id=NEW.version_id)
 OR EXISTS(SELECT 1 FROM material_evidence_inputs WHERE document_version_id=NEW.version_id)
 OR EXISTS(SELECT 1 FROM learning_practice_inputs WHERE document_version_id=NEW.version_id)
BEGIN SELECT RAISE(ABORT,'exact authored inputs protect referenced bodies'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_retirements_delete BEFORE DELETE ON study_document_retirements BEGIN SELECT RAISE(ABORT,'document retirement is permanent'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_retirements_update BEFORE UPDATE ON study_document_retirements BEGIN SELECT RAISE(ABORT,'document retirement is permanent'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_source_input BEFORE INSERT ON study_document_inputs
WHEN NEW.source_snapshot_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM content_snapshots WHERE id=NEW.source_snapshot_id AND source_id=NEW.source_id)
BEGIN SELECT RAISE(ABORT,'source snapshot must belong to exact source'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_transform_intent_immutable BEFORE UPDATE ON study_document_transform_requests WHEN NEW.id IS NOT OLD.id OR NEW.context_request_id IS NOT OLD.context_request_id OR NEW.request IS NOT OLD.request OR NEW.intent_hash IS NOT OLD.intent_hash OR NEW.instruction IS NOT OLD.instruction OR NEW.created_at IS NOT OLD.created_at OR (NEW.session_id IS NOT OLD.session_id AND NEW.session_id IS NOT NULL) OR (OLD.cancelled=1 AND NEW.cancelled!=1) OR (OLD.result_version_id IS NOT NULL AND (NEW.result_version_id IS NOT OLD.result_version_id OR NEW.report IS NOT OLD.report OR NEW.result_hash IS NOT OLD.result_hash OR NEW.event_id IS NOT OLD.event_id)) BEGIN SELECT RAISE(ABORT,'document transform intent and publication are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_transform_publication_owner BEFORE UPDATE OF result_version_id ON study_document_transform_requests WHEN NEW.result_version_id IS NOT NULL AND (NEW.report IS NULL OR NEW.result_hash IS NULL OR NOT EXISTS(SELECT 1 FROM study_document_generation_requests p WHERE p.id=NEW.id AND p.result_version_id=NEW.result_version_id)) BEGIN SELECT RAISE(ABORT,'document transform requires its exact authored publication receipt'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_versions_draft_identity BEFORE UPDATE ON study_document_versions
WHEN NEW.id!=OLD.id OR NEW.document_id!=OLD.document_id OR NEW.number!=OLD.number
 OR NEW.content_snapshot_id!=OLD.content_snapshot_id OR NEW.created_at!=OLD.created_at
BEGIN SELECT RAISE(ABORT, 'document version identity is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_versions_draft_insert BEFORE INSERT ON study_document_versions
WHEN NEW.status != 'draft' BEGIN SELECT RAISE(ABORT, 'document versions must begin as drafts'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_versions_publish BEFORE UPDATE OF status ON study_document_versions
WHEN NEW.status='published' AND (
 NOT EXISTS (SELECT 1 FROM blocks WHERE document_id=NEW.content_snapshot_id)
 OR NOT EXISTS (SELECT 1 FROM content_snapshots WHERE id=NEW.content_snapshot_id AND source_id IS NULL)
 OR EXISTS (SELECT 1 FROM study_document_version_parents p JOIN study_document_versions v ON v.id=p.parent_version_id
  WHERE p.version_id=NEW.id AND (v.status!='published' OR v.number>=NEW.number OR v.document_id!=NEW.document_id))
) BEGIN SELECT RAISE(ABORT, 'document publication requires complete owned content and published ancestry'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_versions_sealed_delete BEFORE DELETE ON study_document_versions
WHEN OLD.status='published' BEGIN SELECT RAISE(ABORT, 'published document versions are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_versions_sealed_update BEFORE UPDATE ON study_document_versions
WHEN OLD.status='published' BEGIN SELECT RAISE(ABORT, 'published document versions are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_versions_snapshot_owner BEFORE INSERT ON study_document_versions
WHEN NOT EXISTS (SELECT 1 FROM content_snapshots c WHERE c.id=NEW.content_snapshot_id AND c.source_id IS NULL)
BEGIN SELECT RAISE(ABORT, 'authored document snapshot ownership is invalid'); END;
--> statement-breakpoint
CREATE TRIGGER workflow_activities_retired_insert BEFORE INSERT ON workflow_activities
WHEN EXISTS(SELECT 1 FROM workflow_retired_executions WHERE execution_id=NEW.execution_id)
BEGIN SELECT RAISE(ABORT, 'retired workflow cannot checkpoint'); END;
--> statement-breakpoint
CREATE TRIGGER workflow_clocks_retired_insert BEFORE INSERT ON workflow_clocks
WHEN EXISTS(SELECT 1 FROM workflow_retired_executions WHERE execution_id=NEW.execution_id)
BEGIN SELECT RAISE(ABORT, 'retired workflow cannot checkpoint'); END;
--> statement-breakpoint
CREATE TRIGGER workflow_configuration_waits_retired_insert BEFORE INSERT ON workflow_configuration_waits
WHEN EXISTS(SELECT 1 FROM workflow_retired_executions WHERE execution_id=NEW.execution_id)
BEGIN SELECT RAISE(ABORT, 'retired workflow cannot checkpoint'); END;
--> statement-breakpoint
CREATE TRIGGER workflow_deferreds_retired_insert BEFORE INSERT ON workflow_deferreds
WHEN EXISTS(SELECT 1 FROM workflow_retired_executions WHERE execution_id=NEW.execution_id)
BEGIN SELECT RAISE(ABORT, 'retired workflow cannot checkpoint'); END;
--> statement-breakpoint
CREATE TRIGGER workflow_retired_correlations_delete_retained BEFORE DELETE ON workflow_retired_correlations
BEGIN SELECT RAISE(ABORT, 'retirement identities are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER workflow_retired_correlations_update_retained BEFORE UPDATE ON workflow_retired_correlations
BEGIN SELECT RAISE(ABORT, 'retirement identities are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER workflow_retired_executions_delete_retained BEFORE DELETE ON workflow_retired_executions
BEGIN SELECT RAISE(ABORT, 'retirement identities are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER workflow_retired_executions_update_retained BEFORE UPDATE ON workflow_retired_executions
BEGIN SELECT RAISE(ABORT, 'retirement identities are immutable'); END;
--> statement-breakpoint
DELETE FROM catalog_fts WHERE kind='material' AND target_id NOT IN(SELECT id FROM materials);
--> statement-breakpoint
DELETE FROM catalog_fts WHERE kind='source';
--> statement-breakpoint
INSERT INTO catalog_fts SELECT name,'source',id,project_id FROM sources;
--> statement-breakpoint
INSERT INTO chunks_fts(chunks_fts) VALUES('rebuild');
--> statement-breakpoint
INSERT INTO message_fts(message_fts) VALUES('rebuild');
--> statement-breakpoint
DROP TABLE cutover_retired_contexts;
--> statement-breakpoint
DROP TABLE cutover_retired_requests;
--> statement-breakpoint
DROP TABLE cutover_pending_replies;
--> statement-breakpoint
DROP TABLE cutover_obsolete_events;
--> statement-breakpoint
DROP TABLE cutover_old_materials;
--> statement-breakpoint
DROP TABLE cutover_old_versions;
--> statement-breakpoint
DROP TABLE cutover_old_snapshots;
