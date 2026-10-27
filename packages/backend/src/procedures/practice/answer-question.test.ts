import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createProject as opCreateProject } from '#backend/procedures/projects/create-project';
import { fixture, completeQuestion } from '#testing/procedures';
test('answerQuestion grades choices, queues open answers, and rejects absent input or question', async (t) => {
  const f = await fixture(t);
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
      id: BigInt(open.questionId)
    } as never),
    {
      kind: 'invalid_input'
    }
  );
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
