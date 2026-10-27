import * as schema from '@study/db/schema';
import { text } from '@study/localization';
import { eq, desc } from 'drizzle-orm';
import { z } from 'zod';

import { message as opMessage } from '#backend/procedures/conversations/messages';
import { session as opSession } from '#backend/procedures/conversations/session';
import { artifact as opArtifact } from '#backend/procedures/material/artifact';
import { question as opQuestion } from '#backend/procedures/practice/practice';
import { listPractices as opListPractices } from '#backend/procedures/practice/practices';
import { project as opProject } from '#backend/procedures/projects/projects';
import { language } from '#backend/procedures/settings/get-app-settings';
import { source as opSource } from '#backend/procedures/sources/source';
import { sourceOfDocument as opSourceOfDocument } from '#backend/procedures/sources/source-document';
import type { BackendContext } from '#backend/runtime/context';
import { publicProcedure } from '#backend/runtime/trpc';
import type { Job } from '#backend/shared/jobs/types';

import { rowJob } from './worker.ts';

export const run = publicProcedure
  .input(
    z.object({
      limit: z.number().int().min(0).max(10000).default(0)
    })
  )
  .query(({ ctx: context, input: r }) => {
    const { store } = context;
    const overview = (v: Job) => {
      const source =
        v.target.type === 'source'
          ? opSource(store, v.target.id)
          : v.target.type === 'document'
            ? (() => {
                const id = opSourceOfDocument(store, v.target.id);

                return id ? opSource(store, id) : null;
              })()
            : null;
      const msg = v.target.type === 'message' ? opMessage(store, v.target.id) : null;
      const session =
        v.target.type === 'session'
          ? opSession(store, v.target.id)
          : msg
            ? opSession(store, msg.sessionId)
            : null;
      const material = v.target.type === 'artifact' ? opArtifact(store, v.target.id) : null;
      const question = v.target.type === 'question' ? opQuestion(store, v.target.id) : null;
      const practice = question
        ? opListPractices(store).find((p) => p.id === question.practiceId)
        : null;
      const projectId =
        source?.projectId ?? session?.projectId ?? material?.projectId ?? practice?.projectId;
      const project = projectId ? opProject(store, projectId) : null;

      return {
        job: v,
        subject:
          source?.name ??
          session?.title ??
          material?.title ??
          question?.gist ??
          text(language(store), 'Practice'),
        sourceKind: source ? source.kind : undefined,
        sourceId: source?.id ?? null,
        sessionId: session?.id ?? null,
        sessionTitle: session?.title,
        projectId: project?.id ?? null,
        projectName: project?.name,
        practiceId: practice?.id ?? null
      };
    };

    return {
      items: listJobs(store)
        .slice(0, r.limit || 100)
        .map(overview)
    };
  });

export function listJobs(ctx: BackendContext): Job[] {
  return ctx.db.orm.select().from(schema.jobs).orderBy(schema.jobs.id).all().map(rowJob);
}

export function targetJobs(ctx: BackendContext, type: Job['target']['type'], id: bigint): Job[] {
  const column = {
    source: schema.jobs.source_id,
    document: schema.jobs.document_id,
    session: schema.jobs.session_id,
    message: schema.jobs.message_id,
    artifact: schema.jobs.artifact_id,
    question: schema.jobs.question_id
  }[type];

  return ctx.db.orm
    .select()
    .from(schema.jobs)
    .where(eq(column, id))
    .orderBy(desc(schema.jobs.id))
    .all()
    .map(rowJob);
}
