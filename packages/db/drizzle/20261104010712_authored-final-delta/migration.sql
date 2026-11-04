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
UPDATE conversation_reply_requests SET snapshot=json_set(snapshot,'$.context',json((SELECT c.snapshot FROM session_run_contexts c WHERE c.request_id=json_extract(conversation_reply_requests.snapshot,'$.context.requestId')))) WHERE json_extract(snapshot,'$.context.requestId') IS NOT NULL AND EXISTS(SELECT 1 FROM session_run_contexts c WHERE c.request_id=json_extract(conversation_reply_requests.snapshot,'$.context.requestId') AND NOT EXISTS(SELECT 1 FROM json_each(c.snapshot,'$.inputs') j WHERE json_extract(j.value,'$.input.kind') IS NULL)); AND NOT EXISTS(SELECT 1 FROM session_retired_intents r WHERE r.request_id=conversation_reply_requests.request_id);
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
