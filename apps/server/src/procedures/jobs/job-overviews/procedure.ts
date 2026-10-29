import { text } from '@study/localization';

import { message as opMessage } from '#server/procedures/conversations/operations/messages';
import { session as opSession } from '#server/procedures/conversations/operations/session';
import { listJobs } from '#server/procedures/jobs/operations/job-overviews';
import { artifact as opArtifact } from '#server/procedures/material/operations/artifact';
import { question as opQuestion } from '#server/procedures/practice/operations/practice';
import { listPractices as opListPractices } from '#server/procedures/practice/operations/practices';
import { project as opProject } from '#server/procedures/projects/operations/read-projects';
import { source as opSource } from '#server/procedures/sources/operations/source';
import { sourceOfDocument as opSourceOfDocument } from '#server/procedures/sources/operations/source-document';
import { publicProcedure } from '#server/runtime/trpc';

import { inputValidator } from './input.ts';
import { outputValidator } from './output.ts';

export const run = publicProcedure
  .input(inputValidator)
  .output(outputValidator)
  .query(({ ctx, input }) => {
    const overview = (job: ReturnType<typeof listJobs>[number]) => {
      const source =
        job.target.type === 'source'
          ? opSource(ctx.store, job.target.id)
          : job.target.type === 'document'
            ? (() => {
                const id = opSourceOfDocument(ctx.store, job.target.id);

                return id ? opSource(ctx.store, id) : null;
              })()
            : null;
      const msg = job.target.type === 'message' ? opMessage(ctx.store, job.target.id) : null;
      const session =
        job.target.type === 'session'
          ? opSession(ctx.store, job.target.id)
          : msg
            ? opSession(ctx.store, msg.sessionId)
            : null;
      const material = job.target.type === 'artifact' ? opArtifact(ctx.store, job.target.id) : null;
      const question = job.target.type === 'question' ? opQuestion(ctx.store, job.target.id) : null;
      const practice = question
        ? opListPractices(ctx.store).find((item) => item.id === question.practiceId)
        : null;
      const projectId =
        source?.projectId ?? session?.projectId ?? material?.projectId ?? practice?.projectId;
      const project = projectId ? opProject(ctx.store, projectId) : null;

      return {
        job,
        subject:
          source?.name ??
          session?.title ??
          material?.title ??
          question?.gist ??
          text(ctx.language(), 'Practice'),
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
      items: listJobs(ctx.store)
        .slice(0, input.limit || 100)
        .map(overview)
    };
  });
