import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createProject as opCreateProject } from '#server/procedures/projects/operations/create-project';
import { completeQuestion } from '#testing/procedures';
import { createServerTest } from '#testing/server-test';

import { inputValidator } from './input.ts';

test('answerQuestion grades choices, queues open answers, and rejects absent input or question', async (t) => {
  const f = await createServerTest(t);
  const project = opCreateProject(f.store, 'Physics');
  const q = completeQuestion(f.store, project.id);
  const result = await f.caller.practice.answerQuestion({
    id: BigInt(q.questionId),
    answer: {
      type: 'choice',
      choice: 0
    }
  });

  assert.equal(result.type, 'graded');
  assert.equal(result.verdict, 'correct');
  const open = completeQuestion(f.store, project.id, 'open');
  const queued = await f.caller.practice.answerQuestion({
    id: BigInt(open.questionId),
    answer: {
      type: 'open',
      answer: 'Mass attracts mass'
    }
  });

  assert.equal(queued.type, 'grading');
  await assert.rejects(
    f.caller.practice.answerQuestion({
      id: 999999n,
      answer: {
        type: 'choice',
        choice: 0
      }
    }),
    {
      kind: 'not_found'
    }
  );
  const invalid = completeQuestion(f.store, project.id);

  await assert.rejects(
    f.caller.practice.answerQuestion({
      id: invalid.questionId,
      answer: {
        type: 'choice',
        choice: 99
      }
    }),
    {
      kind: 'invalid_input'
    }
  );
});

test('answerQuestion input validator rejects a missing answer', async () => {
  const result = await inputValidator['~standard'].validate({ id: 1n });

  assert.ok(result.issues && result.issues.length > 0);
});
