import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TestContext } from 'node:test';

import { job as opJob } from '#server/procedures/jobs/operations/job';
import { claimJob as opClaimJob } from '#server/procedures/jobs/worker';
import { finishMaterial as opFinishMaterial } from '#server/procedures/material/finish-material';
import { artifact as opArtifact } from '#server/procedures/material/operations/artifact';
import { requestMaterial as opRequestMaterial } from '#server/procedures/material/operations/update-material';
import { finishQuestion as opFinishQuestion } from '#server/procedures/practice/finish-question';
import { question as opQuestion } from '#server/procedures/practice/operations/practice';
import { createPractice as opCreatePractice } from '#server/procedures/practice/operations/project-practice';
import { createProject as opCreateProject } from '#server/procedures/projects/operations/create-project';
import { createNote as opCreateNote } from '#server/procedures/sources/operations/create-note';
import { deleteSource as opDeleteSource } from '#server/procedures/sources/operations/delete-source';
import { ServerContext } from '#server/runtime/context';
import type { SourceId, QuestionId } from '#server/shared/ids';
import type { Citation } from '#server/shared/sources/citations';
import { createServerTest } from '#testing/server-test';

function snapshot(sourceId: SourceId | null, marker = 1): Citation {
  return {
    marker,
    sourceId,
    sourceName: 'Deleted lecture',
    anchor: { type: 'page', page: 3 },
    quote: 'Saved evidence'
  };
}

function fixture(
  t: TestContext,
  kind: 'material' | 'question',
  run: (context: {
    store: ServerContext;
    sourceId: SourceId;
    finish: (citations: Citation[]) => boolean;
    citations: () => Citation[];
    status: () => string;
    jobStatus: () => string;
  }) => void
) {
  const testDatabase = createServerTest(t, { app: false });
  const store = createServerTest(t, { app: false }).manage(ServerContext.open(testDatabase.path));

  try {
    const project = opCreateProject(store, 'P');
    const sourceId = opCreateNote(store, 'Lecture', 'evidence', project.id).id;

    if (kind === 'material') {
      const request = opRequestMaterial(store, project.id, 'diagram', 'Diagram', [sourceId]);
      const job = opClaimJob(store, ['artifact'])!;

      run({
        store,
        sourceId,
        finish: (citations) =>
          opFinishMaterial(
            store,
            request.artifactId,
            job.id,
            job.attempts,
            { type: 'diagram', mermaid: 'flowchart TD\nA-->B' },
            citations
          ),
        citations: () => opArtifact(store, request.artifactId)!.citations,
        status: () => opArtifact(store, request.artifactId)!.status,
        jobStatus: () => opJob(store, job.id)!.status
      });
    } else {
      opCreatePractice(store, project.id);
      const job = opClaimJob(store, ['question'])!;
      const id = job.target.id as QuestionId;

      run({
        store,
        sourceId,
        finish: (citations) =>
          opFinishQuestion(
            store,
            id,
            job.id,
            job.attempts,
            {
              type: 'choice',
              question: 'Question?',
              choices: ['A', 'B'],
              answer: 0,
              explanation: 'Evidence',
              cites: citations.map((c) => c.marker)
            },
            'Gist',
            citations
          ),
        citations: () => opQuestion(store, id)!.citations,
        status: () => opQuestion(store, id)!.status,
        jobStatus: () => opJob(store, job.id)!.status
      });
    }
  } finally {
    store.close();
  }
}

for (const kind of ['material', 'question'] as const) {
  test(`${kind} completion preserves citations when published source deletion is forbidden`, (t) =>
    fixture(t, kind, ({ store, sourceId, finish, citations, jobStatus }) => {
      assert.throws(() => opDeleteSource(store, sourceId));
      assert.equal(finish([snapshot(sourceId)]), true);
      assert.deepEqual(citations(), [snapshot(sourceId)]);
      assert.equal(jobStatus(), 'succeeded');
    }));

  test(`${kind} completion validates markers and source IDs before committing any content`, (t) =>
    fixture(t, kind, ({ store, sourceId, finish, citations, status, jobStatus }) => {
      const events: unknown[] = [];
      const unsubscribe = store.subscribe(() => events.push(undefined));
      const before = status();

      for (const invalid of [
        [snapshot(sourceId, 0)],
        [snapshot(sourceId, 1.5)],
        [snapshot(sourceId, Number.NaN)],
        [snapshot(sourceId, 0x1_0000_0000)],
        [snapshot(sourceId), snapshot(sourceId)],
        [snapshot(sourceId), snapshot(-1n as SourceId, 2)],
        [snapshot(0n as SourceId)],
        [snapshot(0x8000_0000_0000_0000n as SourceId)],
        [snapshot(1 as unknown as SourceId)]
      ]) {
        assert.throws(() => finish(invalid), { kind: 'invalid_input' });
        assert.equal(status(), before);
        assert.equal(jobStatus(), 'running');
        assert.deepEqual(citations(), []);
        assert.deepEqual(events, []);
      }

      assert.equal(finish([snapshot(sourceId, 0xffff_ffff)]), true);
      assert.deepEqual(citations(), [snapshot(sourceId, 0xffff_ffff)]);
      unsubscribe();
    }));
}
