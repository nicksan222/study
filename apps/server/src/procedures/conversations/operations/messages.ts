import { eq, and, asc, isNull, sql } from '@study/db';
import * as schema from '@study/db/schema';
import { Schema } from 'effect';

import { targetJobs } from '#server/procedures/jobs/operations/job-overviews';
import { documentOf } from '#server/procedures/sources/operations/source-document';
import type { ServerContext } from '#server/runtime/context';
import type { MessagePart, ChatMessage } from '#server/shared/conversations/messages';
import { requireRow } from '#server/shared/errors/index';
import type { SessionId } from '#server/shared/ids';
import type { MessageId, VersionId } from '#server/shared/ids';
import type { Citation } from '#server/shared/sources/citations';
import { anchorSchema } from '#server/shared/sources/schemas';

export function message(ctx: ServerContext, id: MessageId) {
  const row = ctx.db.orm.select().from(schema.messages).where(eq(schema.messages.id, id)).get();

  if (!row) return null;

  const versions = ctx.db.orm
    .select()
    .from(schema.message_versions)
    .where(eq(schema.message_versions.message_id, id))
    .orderBy(asc(schema.message_versions.number))
    .all()
    .map((v) => ({
      id: v.id,
      number: v.number,
      origin: v.origin,
      status: v.status,
      text: v.text,
      basedOn: v.based_on,
      instruction: v.instruction,
      createdAt: v.created_at
    }));
  const parts = ctx.db.orm
    .select()
    .from(schema.message_parts)
    .where(eq(schema.message_parts.message_id, id))
    .orderBy(asc(schema.message_parts.ordinal))
    .all()
    .map((p) => ({
      id: p.id,
      sourceId: p.source_id,
      sourceName: p.source_name,
      sourceKind: p.source_kind
    }));

  return {
    id,
    sessionId: row.session_id,
    role: row.role,
    threadRoot: row.thread_root,
    replyTo: row.reply_to,
    activeVersionId: row.active_version_id,
    recordingId: row.recording_id,
    recordingMs: row.recording_ms,
    recordedIn: row.recorded_in,
    createdAt: row.created_at,
    versions,
    parts,
    citations: row.active_version_id == null ? [] : versionCitations(ctx, row.active_version_id)
  };
}

export function versionCitations(ctx: ServerContext, version: VersionId): Citation[] {
  return ctx.db.orm
    .select()
    .from(schema.citations)
    .where(eq(schema.citations.version_id, version))
    .orderBy(schema.citations.marker)
    .all()
    .map((row) => ({
      marker: Number(row.marker),
      sourceId: row.source_id,
      sourceName: row.source_name,
      anchor: Schema.decodeUnknownSync(anchorSchema)(JSON.parse(row.anchor)),
      quote: row.quote
    }));
}

export function listMessages(ctx: ServerContext, sessionId: SessionId): ChatMessage[] {
  return ctx.db.orm
    .select({
      id: schema.messages.id
    })
    .from(schema.messages)
    .where(and(eq(schema.messages.session_id, sessionId), isNull(schema.messages.thread_root)))
    .orderBy(asc(schema.messages.id))
    .all()
    .map((r) => message(ctx, r.id)!);
}

export function partView(ctx: ServerContext, value: MessagePart) {
  const doc = value.sourceId ? documentOf(ctx, value.sourceId) : null;
  const thread = requireRow(
    ctx.db.orm
      .select({
        replies: sql<bigint>`count(*)`,
        lastReplyAt: sql<
          bigint | null
        >`(SELECT created_at FROM messages WHERE thread_root = ${value.id} ORDER BY id DESC LIMIT 1)`
      })
      .from(schema.messages)
      .where(eq(schema.messages.thread_root, value.id))
      .get()
  );

  return {
    ...value,
    content: { sourceId: value.sourceId, name: value.sourceName, kind: value.sourceKind },
    document: doc ? { ...doc.document, id: doc.id } : null,
    jobs: value.sourceId ? targetJobs(ctx, 'source', value.sourceId) : [],
    thread
  };
}

export function messageView(ctx: ServerContext, value: ChatMessage) {
  return {
    ...value,
    status:
      value.versions.find((version) => version.id === value.activeVersionId)?.status ?? 'complete',
    parts: value.parts.map((part) => partView(ctx, part)),
    activeVersion: value.activeVersionId,
    reply: targetJobs(ctx, 'message', value.id).find((job) => job.kind === 'reply') ?? null
  };
}
