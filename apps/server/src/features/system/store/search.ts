/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Builds bounded SQLite full-text search across feature records and returns typed    │
 * │ internal targets with passage anchors.                                                   │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Feature stores own SQLite access and map rows to typed contracts.                      │
 * │ - Queries or mutates feature-owned database records.                                     │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Keeps SQL and schema mapping behind typed store operations.                              │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts/errors';
import type {
  ContentSnapshotId,
  PageId,
  ProjectId,
  SourceId,
  ChunkId,
  MessageId,
  NoteId
} from '@study/contracts/ids';
import { NoteMode } from '@study/contracts/notes/schemas';
import type { searchHitSchema } from '@study/contracts/system/schemas';

type PublicTarget = typeof searchHitSchema.Type.target;

type MaterialTarget = Extract<PublicTarget, { type: 'material' }>;

type QuestionTarget = Extract<PublicTarget, { type: 'question' }>;

type SearchTarget =
  | { type: 'project'; id: ProjectId }
  | { type: 'note'; id: NoteId }
  | { type: 'source'; id: SourceId }
  | { type: 'message'; id: MessageId }
  | {
      type: 'passage';
      id: ChunkId;
      documentId: ContentSnapshotId;
      sourceId: SourceId;
      anchor: typeof anchorSchema.Type;
    }
  | { type: 'page'; id: PageId }
  | { type: 'material'; id: MaterialTarget['materialId'] }
  | { type: 'question'; id: QuestionTarget['questionId'] };

type SearchHit = { target: SearchTarget; projectId: ProjectId | null; text: string; rank: number };

type SearchKind = SearchTarget['type'];

type SearchOptions = { projectId?: ProjectId; kinds?: readonly SearchKind[]; limit?: number };

import { anchorSchema } from '@study/contracts/sources/schemas';
import { sql } from '@study/db';
import * as schema from '@study/db/schema';
import { Schema } from 'effect';

import type { StoreResources } from '#server/platform/definitions/define-store';

export function makeSearch({ db }: StoreResources) {
  function search(query: string, options: SearchOptions = {}): SearchHit[] {
    const tokens = query.match(/[\p{L}\p{N}_]+/gu);

    if (!tokens?.length) return [];

    const expression = tokens.map((t) => `"${t.replaceAll('"', '""')}"*`).join(' AND ');
    const limit = options.limit ?? 30;

    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      throw new StudyError('invalid_input', 'invalid search limit');

    const kinds = options.kinds ?? [
      'project',
      'note',
      'source',
      'passage',
      'message',
      'material',
      'page',
      'question'
    ];
    const project = options.projectId ?? null;
    const hits: SearchHit[] = [];

    searchPassages(expression, kinds, project, limit, hits);
    searchMessages(expression, kinds, project, limit, hits);
    searchCatalog(expression, kinds, project, limit, hits);
    searchNames(query, kinds, project, limit, hits);
    searchPages(tokens, kinds, project, limit, hits);

    return hits.sort((a, b) => a.rank - b.rank).slice(0, limit);
  }

  function searchPassages(
    expression: string,
    kinds: readonly SearchKind[],
    project: ProjectId | null,
    limit: number,
    hits: SearchHit[]
  ) {
    if (kinds.includes('passage')) {
      const rows = db.orm.all(
        sql`SELECT c.id,c.document_id,c.anchor,c.text,d.source_id,s.project_id,bm25(chunks_fts) AS rank FROM chunks_fts JOIN chunks c ON c.id=chunks_fts.rowid JOIN content_snapshots d ON d.id=c.document_id JOIN sources s ON s.id=d.source_id WHERE chunks_fts MATCH ${expression} AND d.id=(SELECT published.document_id FROM source_processing published WHERE published.source_id=d.source_id) AND (${project} IS NULL OR s.project_id=${project}) ORDER BY rank LIMIT ${limit}`
      );

      for (const r of rows)
        hits.push({
          target: {
            type: 'passage',
            id: r.id as ChunkId,
            documentId: r.document_id as ContentSnapshotId,
            sourceId: r.source_id as SourceId,
            anchor: Schema.decodeUnknownSync(anchorSchema)(JSON.parse(r.anchor as string))
          },
          projectId: r.project_id as ProjectId | null,
          text: r.text as string,
          rank: r.rank as number
        });
    }
  }

  function searchMessages(
    expression: string,
    kinds: readonly SearchKind[],
    project: ProjectId | null,
    limit: number,
    hits: SearchHit[]
  ) {
    if (kinds.includes('message')) {
      const rows = db.orm.all(
        sql`SELECT m.id,m.note_id,NULL AS project_id,v.text,bm25(message_fts) AS rank FROM message_fts JOIN message_versions v ON v.id=message_fts.rowid JOIN messages m ON m.active_version_id=v.id JOIN notes s ON s.id=m.note_id WHERE message_fts MATCH ${expression} AND s.mode = ${NoteMode.Notebook} AND (${project} IS NULL OR EXISTS(SELECT 1 FROM project_notes ps WHERE ps.note_id=s.id AND ps.project_id=${project})) ORDER BY rank LIMIT ${limit}`
      );

      for (const r of rows)
        hits.push({
          target: {
            type: 'message',
            id: r.id as MessageId
          },
          projectId: r.project_id as ProjectId,
          text: r.text as string,
          rank: r.rank as number
        });
    }
  }

  function searchCatalog(
    expression: string,
    kinds: readonly SearchKind[],
    project: ProjectId | null,
    limit: number,
    hits: SearchHit[]
  ) {
    const catalog: SearchKind[] = kinds.filter((k) =>
      ['project', 'note', 'source', 'material', 'question'].includes(k)
    );

    if (catalog.length) {
      const rows = db.orm.all(
        sql`SELECT kind,target_id,project_id,text,bm25(catalog_fts) AS rank FROM catalog_fts WHERE catalog_fts MATCH ${expression} AND kind IN (${sql.join(
          catalog.map((kind) => sql`${kind}`),
          sql`, `
        )}) AND (kind != 'note' OR EXISTS(SELECT 1 FROM notes s WHERE s.id=CAST(target_id AS INTEGER) AND s.mode=${NoteMode.Notebook})) AND (kind NOT IN ('material','question') OR EXISTS(SELECT 1 FROM materials m WHERE m.archived_at IS NULL AND NOT EXISTS(SELECT 1 FROM material_deletion_members d WHERE d.material_id=m.id) AND EXISTS(SELECT 1 FROM material_versions v WHERE v.material_id=m.id AND v.status='published' AND v.number=(SELECT max(latest.number) FROM material_versions latest WHERE latest.material_id=m.id AND latest.status='published') AND NOT EXISTS(SELECT 1 FROM material_history_members h WHERE h.version_id=v.id) AND (catalog_fts.kind='material' AND m.id=CAST(target_id AS INTEGER) OR catalog_fts.kind='question' AND EXISTS(SELECT 1 FROM material_quiz_questions q WHERE q.version_id=v.id AND q.id=CAST(target_id AS INTEGER)))))) AND (${project} IS NULL OR
 (kind='material' AND EXISTS(SELECT 1 FROM project_materials pm WHERE pm.material_id=CAST(target_id AS INTEGER) AND pm.project_id=${project})) OR
 (kind='question' AND EXISTS(SELECT 1 FROM project_materials pm JOIN material_versions v ON v.material_id=pm.material_id JOIN material_quiz_questions q ON q.version_id=v.id WHERE q.id=CAST(target_id AS INTEGER) AND pm.project_id=${project})) OR
 (kind='note' AND EXISTS(SELECT 1 FROM project_notes ps WHERE ps.note_id=CAST(target_id AS INTEGER) AND ps.project_id=${project})) OR
 (kind NOT IN ('material','question','note') AND CAST(project_id AS INTEGER)=${project})) ORDER BY rank,kind,CAST(target_id AS INTEGER) LIMIT ${limit}`
      );

      for (const r of rows) {
        const id = BigInt(r.target_id as string | number | bigint);

        const target = catalogTarget(r.kind, id);

        if (!target) continue;

        hits.push({
          target,
          projectId:
            r.project_id === null
              ? null
              : (BigInt(r.project_id as string | number | bigint) as ProjectId),
          text: r.text as string,
          rank: r.rank as number
        });
      }
    }
  }

  function searchPages(
    tokens: string[],
    kinds: readonly SearchKind[],
    project: ProjectId | null,
    limit: number,
    hits: SearchHit[]
  ) {
    if (!kinds.includes('page')) return;

    const body = sql`coalesce((SELECT group_concat(b.text,char(10)) FROM blocks b WHERE b.document_id=v.content_snapshot_id),'')`;
    const searchable = sql`d.title || char(10) || coalesce(d.description,'') || char(10) || ${body}`;
    const rows = db.orm.all(sql`SELECT d.id,substr(${searchable},1,400) AS text
      FROM pages d JOIN page_versions v ON v.page_id=d.id
      AND v.status='published' AND v.number=(SELECT max(h.number) FROM page_versions h
        WHERE h.page_id=d.id AND h.status='published')
      WHERE d.archived_at IS NULL AND NOT EXISTS(SELECT 1 FROM page_deletions x WHERE x.page_id=d.id)
      AND NOT EXISTS(SELECT 1 FROM page_retirements x WHERE x.version_id=v.id)
      AND (${project} IS NULL OR EXISTS(SELECT 1 FROM project_pages p WHERE p.page_id=d.id AND p.project_id=${project}))
      AND ${sql.join(
        tokens.map((token) => sql`instr(lower(${searchable}),lower(${token}))>0`),
        sql` AND `
      )}
      ORDER BY d.updated_at DESC,d.id DESC LIMIT ${limit}`);

    for (const row of rows)
      hits.push({
        target: { type: 'page', id: row.id as PageId },
        projectId: project,
        text: row.text as string,
        rank: 0
      });
  }

  function searchNames(
    query: string,
    kinds: readonly SearchKind[],
    project: ProjectId | null,
    limit: number,
    hits: SearchHit[]
  ) {
    for (const kind of ['project', 'note', 'source'] as const) {
      if (!kinds.includes(kind)) continue;

      for (const row of nameRows(kind, query, project, limit)) {
        if (hits.some((hit) => hit.target.type === kind && hit.target.id === row.id)) continue;

        hits.push({
          target: catalogTarget(kind, row.id)!,
          projectId: project,
          text: row.text,
          rank: 0
        });
      }
    }
  }

  function nameRows(
    kind: 'project' | 'note' | 'source',
    query: string,
    project: ProjectId | null,
    limit: number
  ) {
    const table =
      kind === 'project' ? schema.projects : kind === 'note' ? schema.notes : schema.sources;
    const label =
      kind === 'note'
        ? schema.notes.title
        : kind === 'project'
          ? schema.projects.name
          : schema.sources.name;
    const scope =
      kind === 'project'
        ? schema.projects.id
        : kind === 'note'
          ? schema.notes.id
          : schema.sources.project_id;
    const pattern = `%${query.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;

    return db.orm
      .select({ id: table.id, projectId: scope, text: label })
      .from(table)
      .where(
        sql`${label} LIKE ${pattern} ESCAPE ${'\\'} AND ${kind === 'note' ? sql`${schema.notes.mode} = ${NoteMode.Notebook}` : sql`1`} AND (${project} IS NULL OR ${kind === 'note' ? sql`EXISTS (SELECT 1 FROM project_notes ps WHERE ps.note_id = ${schema.notes.id} AND ps.project_id = ${project})` : sql`${scope}=${project}`})`
      )
      .limit(limit)
      .all();
  }

  return { search };
}

function catalogTarget(kind: unknown, id: bigint): SearchTarget | undefined {
  return kind === 'project'
    ? { type: 'project', id: id as ProjectId }
    : kind === 'note'
      ? { type: 'note', id: id as NoteId }
      : kind === 'source'
        ? { type: 'source', id: id as SourceId }
        : kind === 'material'
          ? { type: 'material', id: id as MaterialTarget['materialId'] }
          : kind === 'question'
            ? { type: 'question', id: id as QuestionTarget['questionId'] }
            : undefined;
}
