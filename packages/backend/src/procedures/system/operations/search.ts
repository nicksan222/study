import * as schema from '@study/db/schema';
import { sql } from 'drizzle-orm';

import type { BackendContext } from '#backend/runtime/context';
import { StudyError } from '#backend/shared/errors/index';
import type {
  DocumentId,
  ProjectId,
  SourceId,
  ChunkId,
  MessageId,
  SessionId
} from '#backend/shared/ids';
import type {
  SearchOptions,
  SearchHit,
  SearchKind,
  SearchTarget
} from '#backend/shared/search/types';

export function search(
  ctx: BackendContext,
  query: string,
  options: SearchOptions = {}
): SearchHit[] {
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
    const rows = ctx.db.orm.all(
      sql`SELECT c.id,c.document_id,c.anchor,c.text,d.source_id,s.project_id,bm25(chunks_fts) AS rank FROM chunks_fts JOIN chunks c ON c.id=chunks_fts.rowid JOIN documents d ON d.id=c.document_id JOIN sources s ON s.id=d.source_id WHERE chunks_fts MATCH ${expression} AND d.id=(SELECT MAX(latest.id) FROM documents latest WHERE latest.source_id=d.source_id) AND (${project} IS NULL OR s.project_id=${project}) ORDER BY rank LIMIT ${limit}`
    );

    for (const r of rows)
      hits.push({
        target: {
          type: 'passage',
          id: r.id as ChunkId,
          documentId: r.document_id as DocumentId,
          sourceId: r.source_id as SourceId,
          anchor: JSON.parse(r.anchor as string)
        },
        projectId: r.project_id as ProjectId | null,
        text: r.text as string,
        rank: r.rank as number
      });
  }

  if (kinds.includes('message')) {
    const rows = ctx.db.orm.all(
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
    const rows = ctx.db.orm.all(
      sql`SELECT kind,target_id,project_id,text,bm25(catalog_fts) AS rank FROM catalog_fts WHERE catalog_fts MATCH ${expression} AND kind IN (${sql.join(
        catalog.map((kind) => sql`${kind}`),
        sql`, `
      )}) AND (${project} IS NULL OR CAST(project_id AS INTEGER)=${project}) ORDER BY rank LIMIT ${limit}`
    );

    for (const r of rows) {
      const id = BigInt(r.target_id as string | number | bigint);

      hits.push({
        target: {
          type: r.kind as 'project',
          id: id as ProjectId
        } as SearchTarget,
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
    for (const row of ctx.db.orm
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
    for (const row of ctx.db.orm
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
    for (const row of ctx.db.orm
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
