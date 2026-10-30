import { StudyError } from '@study/contracts/errors';
import type {
  DocumentId,
  ProjectId,
  SourceId,
  ChunkId,
  MessageId,
  SessionId
} from '@study/contracts/ids';
import type { searchHitSchema } from '@study/contracts/system/schemas';

type PublicTarget = typeof searchHitSchema.Type.target;

type MaterialTarget = Extract<PublicTarget, { type: 'material' }>;

type QuestionTarget = Extract<PublicTarget, { type: 'question' }>;

type SearchTarget =
  | { type: 'project'; id: ProjectId }
  | { type: 'session'; id: SessionId }
  | { type: 'source'; id: SourceId }
  | { type: 'message'; id: MessageId }
  | {
      type: 'passage';
      id: ChunkId;
      documentId: DocumentId;
      sourceId: SourceId;
      anchor: typeof anchorSchema.Type;
    }
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
      'session',
      'source',
      'passage',
      'message',
      'material',
      'question'
    ];
    const project = options.projectId ?? null;
    const hits: SearchHit[] = [];

    if (kinds.includes('passage')) {
      const rows = db.orm.all(
        sql`SELECT c.id,c.document_id,c.anchor,c.text,d.source_id,s.project_id,bm25(chunks_fts) AS rank FROM chunks_fts JOIN chunks c ON c.id=chunks_fts.rowid JOIN documents d ON d.id=c.document_id JOIN sources s ON s.id=d.source_id WHERE chunks_fts MATCH ${expression} AND d.id=(SELECT published.document_id FROM source_processing published WHERE published.source_id=d.source_id) AND (${project} IS NULL OR s.project_id=${project}) ORDER BY rank LIMIT ${limit}`
      );

      for (const r of rows)
        hits.push({
          target: {
            type: 'passage',
            id: r.id as ChunkId,
            documentId: r.document_id as DocumentId,
            sourceId: r.source_id as SourceId,
            anchor: Schema.decodeUnknownSync(anchorSchema)(JSON.parse(r.anchor as string))
          },
          projectId: r.project_id as ProjectId | null,
          text: r.text as string,
          rank: r.rank as number
        });
    }

    if (kinds.includes('message')) {
      const rows = db.orm.all(
        sql`SELECT m.id,m.session_id,s.project_id,v.text,bm25(message_fts) AS rank FROM message_fts JOIN message_versions v ON v.id=message_fts.rowid JOIN messages m ON m.active_version_id=v.id JOIN sessions s ON s.id=m.session_id WHERE message_fts MATCH ${expression} AND (${project} IS NULL OR s.project_id=${project}) ORDER BY rank LIMIT ${limit}`
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

    const catalog: SearchKind[] = kinds.filter((k) =>
      ['project', 'session', 'source', 'material', 'question'].includes(k)
    );

    if (catalog.length) {
      const rows = db.orm.all(
        sql`SELECT kind,target_id,project_id,text,bm25(catalog_fts) AS rank FROM catalog_fts WHERE catalog_fts MATCH ${expression} AND kind IN (${sql.join(
          catalog.map((kind) => sql`${kind}`),
          sql`, `
        )}) AND (${project} IS NULL OR CAST(project_id AS INTEGER)=${project}) ORDER BY rank LIMIT ${limit}`
      );

      for (const r of rows) {
        const id = BigInt(r.target_id as string | number | bigint);

        const target: SearchTarget | undefined =
          r.kind === 'project'
            ? { type: 'project', id: id as ProjectId }
            : r.kind === 'session'
              ? { type: 'session', id: id as SessionId }
              : r.kind === 'source'
                ? { type: 'source', id: id as SourceId }
                : r.kind === 'material'
                  ? { type: 'material', id: id as MaterialTarget['materialId'] }
                  : r.kind === 'question'
                    ? { type: 'question', id: id as QuestionTarget['questionId'] }
                    : undefined;

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

    // Names also support fragments inside a word; FTS only matches token prefixes.
    const pattern = `%${query.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;

    if (kinds.includes('project'))
      for (const row of db.orm
        .select()
        .from(schema.projects)
        .where(sql`name LIKE ${pattern} ESCAPE ${'\\'} AND (${project} IS NULL OR id=${project})`)
        .limit(limit)
        .all())
        if (!hits.some((hit) => hit.target.type === 'project' && hit.target.id === row.id))
          hits.push({
            target: {
              type: 'project',
              id: row.id as ProjectId
            },
            projectId: row.id as ProjectId,
            text: row.name,
            rank: 0
          });

    if (kinds.includes('session'))
      for (const row of db.orm
        .select()
        .from(schema.sessions)
        .where(
          sql`title LIKE ${pattern} ESCAPE ${'\\'} AND (${project} IS NULL OR project_id=${project})`
        )
        .limit(limit)
        .all())
        if (!hits.some((hit) => hit.target.type === 'session' && hit.target.id === row.id))
          hits.push({
            target: {
              type: 'session',
              id: row.id as SessionId
            },
            projectId: row.project_id as ProjectId,
            text: row.title,
            rank: 0
          });

    if (kinds.includes('source'))
      for (const row of db.orm
        .select()
        .from(schema.sources)
        .where(
          sql`name LIKE ${pattern} ESCAPE ${'\\'} AND (${project} IS NULL OR project_id=${project})`
        )
        .limit(limit)
        .all())
        if (!hits.some((hit) => hit.target.type === 'source' && hit.target.id === row.id))
          hits.push({
            target: {
              type: 'source',
              id: row.id as SourceId
            },
            projectId: row.project_id as ProjectId | null,
            text: row.name,
            rank: 0
          });

    return hits.sort((a, b) => a.rank - b.rank).slice(0, limit);
  }

  return { search };
}
