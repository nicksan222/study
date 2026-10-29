import { cancelJob as dbCancelJob } from '#server/procedures/jobs/operations/cancel-job';
import { listJobs as dbListJobs } from '#server/procedures/jobs/operations/job-overviews';
import { claimJob as dbClaimJob } from '#server/procedures/jobs/worker';
import { finishMaterial as dbFinishMaterial } from '#server/procedures/material/finish-material';
import { cards as dbCards } from '#server/procedures/material/operations/artifact';
import { requestMaterial as dbRequestMaterial } from '#server/procedures/material/operations/update-material';
import { finishQuestion as dbFinishQuestion } from '#server/procedures/practice/finish-question';
import { createPractice as dbCreatePractice } from '#server/procedures/practice/operations/project-practice';
import { requestQuestion as dbRequestQuestion } from '#server/procedures/practice/request-question';
import type { ServerContext } from '#server/runtime/context';
import type { ProjectId } from '#server/shared/ids';
import type { Document } from '#server/shared/sources/document';

export function completeMaterial(store: ServerContext, project: ProjectId) {
  const request = dbRequestMaterial(store, project, 'flashcards', 'Cards', []);
  const job = dbClaimJob(store, ['artifact'])!;

  if (
    !dbFinishMaterial(
      store,
      request.artifactId,
      job.id,
      job.attempts,
      {
        type: 'flashcards',
        cards: [
          {
            front: 'Gravity?',
            back: 'Attraction',
            cites: []
          }
        ]
      },
      []
    )
  )
    throw new Error('Material fixture failed');

  return {
    ...request,
    card: dbCards(store, request.artifactId)[0]!
  };
}

export function completeQuestion(
  store: ServerContext,
  project: ProjectId,
  kind: 'choice' | 'open' = 'choice'
) {
  const practice = dbCreatePractice(store, project);

  for (const job of dbListJobs(store)) if (job.kind === 'question') dbCancelJob(store, job.id);

  const request = dbRequestQuestion(store, practice.id, kind);
  const job = dbClaimJob(store, ['question'])!;
  const body =
    kind === 'choice'
      ? {
          type: 'choice' as const,
          question: 'Gravity is?',
          choices: ['Attraction', 'Heat'],
          answer: 0,
          explanation: 'Mass attracts mass',
          cites: []
        }
      : {
          type: 'open' as const,
          question: 'Explain gravity',
          reference: 'Mass attracts mass',
          cites: []
        };

  if (!dbFinishQuestion(store, request.questionId, job.id, job.attempts, body, 'Gravity', []))
    throw new Error('Question fixture failed');

  return {
    ...request,
    practice
  };
}

export const document: Document = {
  blocks: [
    {
      kind: 'paragraph',
      text: 'Gravity attracts masses',
      anchor: {
        type: 'paragraph',
        index: 0
      }
    }
  ],
  meta: {
    extractor: 'text',
    extractorVersion: 1,
    provider: null,
    durationMs: null,
    pageCount: null,
    refiners: [],
    waitingFor: [],
    corrected: false
  }
};
