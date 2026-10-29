import { sql, eq } from '@study/db';
import * as schema from '@study/db/schema';

import type { ServerContext } from '#server/runtime/context';
import { StudyError } from '#server/shared/errors/index';
import type { MessageId } from '#server/shared/ids';
import type { VersionId, JobId } from '#server/shared/ids';
import type { Citation } from '#server/shared/sources/citations';
import {
  citedMarkers,
  renumberCitations,
  validateCitations
} from '#server/shared/sources/citations';

import { message as opMessage } from './messages.ts';
import { now, normalizeText } from './post-message.ts';

export function writeCitations(
  ctx: ServerContext,
  version: VersionId,
  citations: readonly Citation[]
): void {
  validateCitations(citations);

  for (const citation of citations) {
    ctx.db.orm.run(
      sql`INSERT INTO citations (version_id,marker,source_id,source_name,anchor,quote) VALUES (${version}, ${citation.marker}, (SELECT id FROM sources WHERE id=${citation.sourceId}), ${citation.sourceName}, ${JSON.stringify(citation.anchor)}, ${citation.quote})`
    );
  }
}

export function discardUnfinished(ctx: ServerContext, id: MessageId): void {
  const versions = ctx.db.orm.all<Record<string, unknown>>(
    sql`SELECT id, owner_job_id FROM message_versions WHERE message_id=${id} AND status != 'complete'`
  );

  for (const row of versions) {
    const version = row.id as VersionId;

    ctx.db.orm.run(
      sql`DELETE FROM jobs WHERE message_id=${id} AND kind IN ('reply','rewrite') AND (id=${row.owner_job_id as JobId | null} OR json_extract(args, '$.versionId') = ${version.toString()})`
    );
    ctx.db.orm.delete(schema.message_versions).where(eq(schema.message_versions.id, version)).run();
  }
}

export function editMessage(ctx: ServerContext, id: MessageId, text: string): VersionId | null {
  return ctx.transaction(() => {
    const message = opMessage(ctx, id);

    if (!message) return null;

    text = normalizeText(text);

    if (!text) throw new StudyError('invalid_input', 'message cannot be empty');

    const markers = citedMarkers(text);
    const kept = message.citations.filter((citation) => markers.includes(citation.marker));

    text = renumberCitations(
      text,
      message.citations.map((citation) => citation.marker),
      kept.map((citation) => citation.marker)
    );
    discardUnfinished(ctx, id);
    const v = ctx.db.orm.run(
      sql`INSERT INTO message_versions (message_id,number,origin,status,text,based_on,created_at) VALUES (${id},(SELECT COALESCE(MAX(number),0)+1 FROM message_versions WHERE message_id=${id}),'edited','complete',${text},${message.activeVersionId},${now()})`
    ).lastInsertRowid as VersionId;

    writeCitations(
      ctx,
      v,
      kept.map((citation, index) => ({
        ...citation,
        marker: index + 1
      }))
    );
    ctx.db.orm
      .update(schema.messages)
      .set({
        active_version_id: v
      })
      .where(eq(schema.messages.id, id))
      .run();

    return v;
  });
}
