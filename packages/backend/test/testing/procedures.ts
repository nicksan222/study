import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';

import { cancelJob as dbCancelJob } from '#backend/procedures/jobs/cancel-job';
import { listJobs as dbListJobs } from '#backend/procedures/jobs/job-overviews';
import { claimJob as dbClaimJob } from '#backend/procedures/jobs/worker';
import { cards as dbCards } from '#backend/procedures/material/artifact';
import { finishMaterial as dbFinishMaterial } from '#backend/procedures/material/finish-material';
import { requestMaterial as dbRequestMaterial } from '#backend/procedures/material/update-material';
import { finishQuestion as dbFinishQuestion } from '#backend/procedures/practice/finish-question';
import { createPractice as dbCreatePractice } from '#backend/procedures/practice/project-practice';
import { requestQuestion as dbRequestQuestion } from '#backend/procedures/practice/request-question';
import type { BackendContext } from '#backend/runtime/context';
import { createProcedureContext } from '#backend/runtime/procedure-context';
import { appRouter } from '#backend/runtime/router';
import { App } from '#backend/runtime/service';
import type { ProjectId } from '#backend/shared/ids';
import type { Document } from '#backend/shared/sources/document';

/** Real database and application resources; workers stay idle for deterministic tests. */
export async function fixture(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'study-procedure-'));
  const app = await App.open({
    path: join(dir, 'study.db')
  });

  t.after(async () => {
    try {
      await app.close();
    } finally {
      rmSync(dir, {
        recursive: true,
        force: true
      });
    }
  });
  const store = app.store;
  const wake = () => app.workers.wake();
  const refresh = {
    publish: () => {},
    subscribe: (listener: () => void) => app.subscribe(() => listener())
  };
  const context = createProcedureContext(app, refresh);

  return {
    app,
    store,
    dir,
    wake,
    context,
    caller: appRouter.createCaller(context),
    callerFor: (signal: AbortSignal) =>
      appRouter.createCaller(context, {
        signal
      })
  };
}

export function completeMaterial(store: BackendContext, project: ProjectId) {
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
  store: BackendContext,
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
