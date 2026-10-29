import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TestContext } from 'node:test';

import { sql } from '@study/db';

import { job as opJob } from '#server/procedures/jobs/operations/job';
import { listJobs as opListJobs } from '#server/procedures/jobs/operations/job-overviews';
import {
  finishJob as opFinishJob,
  claimJob as opClaimJob,
  recoverJobs as opRecoverJobs,
  failJob as opFailJob,
  enqueueJob as opEnqueueJob
} from '#server/procedures/jobs/worker';
import { artifact as opArtifact } from '#server/procedures/material/operations/artifact';
import { finishGrade as opFinishGrade } from '#server/procedures/practice/finish-grade';
import { finishQuestion as opFinishQuestion } from '#server/procedures/practice/finish-question';
import { addMistakeCard as opAddMistakeCard } from '#server/procedures/practice/operations/add-to-flashcards';
import { answerQuestion as opAnswerQuestion } from '#server/procedures/practice/operations/answer-question';
import { deletePractice as opDeletePractice } from '#server/procedures/practice/operations/delete-practice';
import {
  practiceScore as opPracticeScore,
  listQuestions as opListQuestions,
  question as opQuestion,
  ensurePracticeQuestions as opEnsurePracticeQuestions
} from '#server/procedures/practice/operations/practice';
import { listPractices as opListPractices } from '#server/procedures/practice/operations/practices';
import { createPractice as opCreatePractice } from '#server/procedures/practice/operations/project-practice';
import { requestQuestion as opRequestQuestion } from '#server/procedures/practice/request-question';
import { createProject as opCreateProject } from '#server/procedures/projects/operations/create-project';
import { ServerContext } from '#server/runtime/context';
import type { ProjectId as ImportedProjectId } from '#server/shared/ids';
import type { SourceId as ImportedSourceId } from '#server/shared/ids';
import type { PracticeId, QuestionId } from '#server/shared/ids';
import { createServerTest } from '#testing/server-test';

test('choice practice validates answers, grades, and keeps mistakes', (t) => {
  const testDatabase = createServerTest(t, { app: false }),
    store = createServerTest(t, { app: false }).manage(ServerContext.open(testDatabase.path));

  try {
    const project = opCreateProject(store, 'P'),
      practice = opCreatePractice(store, project.id),
      req = opRequestQuestion(store, practice.id, 'choice');

    claimQuestion(store, req.questionId);
    assert.equal(opFinishJob(store, req.jobId, 1n), false);
    const body = {
      type: 'choice' as const,
      question: 'Q?',
      choices: ['one', 'two'],
      answer: 1,
      explanation: 'why',
      cites: []
    };

    assert.equal(opFinishQuestion(store, req.questionId, req.jobId, 1n, body, 'gist', []), true);
    assert.throws(() => opAnswerQuestion(store, req.questionId, { type: 'choice', choice: 7 }));
    assert.equal(
      opAnswerQuestion(store, req.questionId, { type: 'choice', choice: 0 })?.question.verdict,
      'incorrect'
    );
    const card = opAddMistakeCard(store, req.questionId, 'Q?', 'two', 'Mistakes');

    assert.equal(card.front, 'Q?');
    assert.equal(opListQuestions(store, practice.id).length, 3);
  } finally {
    store.close();
  }
});
test('open grade is fenced to the current job attempt', (t) => {
  const testDatabase = createServerTest(t, { app: false }),
    store = createServerTest(t, { app: false }).manage(ServerContext.open(testDatabase.path));

  try {
    const p = opCreateProject(store, 'P'),
      practice = opCreatePractice(store, p.id),
      req = opRequestQuestion(store, practice.id, 'open');

    claimQuestion(store, req.questionId);
    opFinishQuestion(
      store,
      req.questionId,
      req.jobId,
      1n,
      { type: 'open', question: 'Q', reference: 'A', cites: [] },
      'gist',
      []
    );
    const result = opAnswerQuestion(store, req.questionId, {
      type: 'open',
      answer: 'student'
    })!;

    opClaimJob(store, ['grade']);
    opRecoverJobs(store);
    opClaimJob(store, ['grade']);
    assert.equal(opFinishGrade(store, req.questionId, result.jobId!, 1n, 'correct', 'yes'), false);
    assert.equal(opFinishGrade(store, req.questionId, result.jobId!, 2n, 'correct', 'yes'), true);
    assert.equal(opQuestion(store, req.questionId)?.verdict, 'correct');
  } finally {
    store.close();
  }
});
test('practice maintains two unanswered questions and recovers failed generation', (t) => {
  const testDatabase = createServerTest(t, { app: false }),
    store = createServerTest(t, { app: false }).manage(ServerContext.open(testDatabase.path));

  try {
    const p = opCreateProject(store, 'P'),
      practice = opCreatePractice(store, p.id);
    const first = opEnsurePracticeQuestions(store, practice.id);

    assert.equal(first.length, 2);
    assert.deepEqual(
      opListQuestions(store, practice.id).map((q) => q.kind),
      ['choice', 'choice']
    );
    const claim = opClaimJob(store, ['question'])!;

    opFailJob(store, claim.id, claim.attempts, {
      kind: 'invalid_input',
      message: 'bad',
      retryAfterMs: null
    });
    opEnsurePracticeQuestions(store, practice.id);
    assert.equal(opJob(store, claim.id)?.status, 'queued');
    assert.equal(opListQuestions(store, practice.id).length, 2);
  } finally {
    store.close();
  }
});
test('mistake cards are unique per question and appear in their material', (t) => {
  const testDatabase = createServerTest(t, { app: false }),
    store = createServerTest(t, { app: false }).manage(ServerContext.open(testDatabase.path));

  try {
    const p = opCreateProject(store, 'P'),
      practice = opCreatePractice(store, p.id),
      req = opRequestQuestion(store, practice.id, 'choice');

    claimQuestion(store, req.questionId);
    opFinishQuestion(
      store,
      req.questionId,
      req.jobId,
      1n,
      {
        type: 'choice',
        question: 'Q',
        choices: ['a', 'b'],
        answer: 1,
        explanation: '',
        cites: []
      },
      'gist',
      []
    );
    opAnswerQuestion(store, req.questionId, { type: 'choice', choice: 0 });
    const card = opAddMistakeCard(store, req.questionId, 'Q', 'b', 'Mistakes');

    assert.throws(() => opAddMistakeCard(store, req.questionId, 'Q', 'b', 'Mistakes'));
    const artifact = opArtifact(store, card.artifactId)!;

    assert.equal(artifact.mistakes, true);
    assert.equal(artifact.practiceId, practice.id);
    assert.equal(artifact.body?.type, 'flashcards');

    if (artifact.body?.type === 'flashcards') assert.equal(artifact.body.cards.length, 1);
  } finally {
    store.close();
  }
});
test('practice recovers orphaned generation and grading jobs', (t) => {
  const testDatabase = createServerTest(t, { app: false }),
    path = testDatabase.path,
    store = createServerTest(t, { app: false }).manage(ServerContext.open(path));

  try {
    const p = opCreateProject(store, 'P'),
      practice = opCreatePractice(store, p.id),
      q = opRequestQuestion(store, practice.id, 'open');

    store.db.orm.run(sql`DELETE FROM jobs WHERE id=${q.jobId}`);
    opEnsurePracticeQuestions(store, practice.id);
    const pending = opListJobs(store).find(
      (j) => j.kind === 'question' && j.target.id === q.questionId
    )!;

    assert.ok(pending);
    const claim = claimQuestion(store, q.questionId);

    assert.equal(claim.id, pending.id);
    opFinishQuestion(
      store,
      q.questionId,
      pending.id,
      claim.attempts,
      { type: 'open', question: 'Q', reference: 'A', cites: [] },
      'gist',
      []
    );
    const answer = opAnswerQuestion(store, q.questionId, {
      type: 'open',
      answer: 'response'
    })!;

    store.db.orm.run(sql`DELETE FROM jobs WHERE id=${answer.jobId!}`);
    opEnsurePracticeQuestions(store, practice.id);
    assert.ok(opListJobs(store).some((j) => j.kind === 'grade' && j.target.id === q.questionId));
  } finally {
    store.close();
  }
});

const choice = {
  type: 'choice' as const,
  question: 'Q',
  choices: ['a', 'b'],
  answer: 0,
  explanation: '',
  cites: []
};

function claimQuestion(store: ServerContext, id: QuestionId) {
  for (;;) {
    const job = opClaimJob(store, ['question'])!;

    assert.ok(job, 'generation should become runnable in ordinal order');

    if (job.target.id === id) return job;

    opFinishQuestion(
      store,
      job.target.id as QuestionId,
      job.id,
      job.attempts,
      choice,
      'earlier',
      []
    );
  }
}

function fixture(
  t: TestContext,
  run: (store: ServerContext, raw: ServerContext['db']['orm'], practice: PracticeId) => void
) {
  const testDatabase = createServerTest(t, { app: false }),
    path = testDatabase.path;
  const store = createServerTest(t, { app: false }).manage(ServerContext.open(path)),
    raw = store.db.orm;

  try {
    run(store, raw, opCreatePractice(store, opCreateProject(store, 'P').id).id);
  } finally {
    store.close();
  }
}

test('creation queues two questions and remains idempotent', (t) =>
  fixture(t, (store, raw, id) => {
    assert.deepEqual(
      opListQuestions(store, id).map((q) => q.kind),
      ['choice', 'choice']
    );
    const project = BigInt(
      raw.get<{ project_id: bigint }>(sql`SELECT project_id FROM practices WHERE id=${id}`)!
        .project_id
    ) as ImportedProjectId;

    assert.equal(opCreatePractice(store, project).id, id);
    assert.equal(opListQuestions(store, id).length, 2);
  }));
test('choice and open answers automatically replenish two unanswered questions', (t) =>
  fixture(t, (store, _raw, id) => {
    opEnsurePracticeQuestions(store, id);

    for (const kind of ['choice', 'choice', 'open'] as const) {
      const job = opClaimJob(store, ['question'])!;

      assert.ok(job);
      const q = opQuestion(store, job.target.id as QuestionId)!;

      assert.equal(q.kind, kind);
      const body =
        kind === 'choice' ? choice : { type: kind, question: 'Q', reference: 'A', cites: [] };

      assert.equal(opFinishQuestion(store, q.id, job.id, job.attempts, body, 'gist', []), true);
      opAnswerQuestion(
        store,
        q.id,
        kind === 'choice' ? { type: kind, choice: 0 } : { type: kind, answer: 'A' }
      );
      assert.equal(
        opListQuestions(store, id).filter((q) => ['pending', 'writing', 'ready'].includes(q.status))
          .length,
        2
      );
    }

    assert.equal(opListQuestions(store, id).length, 5);
  }));
test('finishing a writing question replenishes an undersized buffer', (t) =>
  fixture(t, (store, raw, id) => {
    opEnsurePracticeQuestions(store, id);
    const [first, second] = opListQuestions(store, id);

    raw.run(sql`DELETE FROM practice_questions WHERE id=${second.id}`);
    const job = opClaimJob(store, ['question'])!;

    raw.run(sql`UPDATE practice_questions SET status='writing' WHERE id=${first.id}`);
    assert.equal(opFinishQuestion(store, first.id, job.id, job.attempts, choice, 'gist', []), true);
    assert.equal(opListQuestions(store, id).length, 2);
    assert.ok(opClaimJob(store, ['question']));
  }));
test('generation waits for project source reads and previous generation', (t) =>
  fixture(t, (store, raw, id) => {
    const project = BigInt(
      raw.get<{ project_id: bigint }>(sql`SELECT project_id FROM practices WHERE id=${id}`)!
        .project_id
    ) as ImportedProjectId;
    const source = BigInt(
      raw.run(
        sql`INSERT INTO sources (project_id,origin,kind,mime,name,size_bytes,sha256,created_at) VALUES (${project},'import','text','text/plain','source',1,zeroblob(32),0)`
      ).lastInsertRowid
    ) as ImportedSourceId;
    const read = opEnqueueJob(store, {
      kind: 'extract',
      target: { type: 'source', id: source }
    });

    opDeletePractice(store, id);
    const practice = opCreatePractice(store, project);

    opEnsurePracticeQuestions(store, practice.id);
    assert.equal(opClaimJob(store, ['question']), null);
    const work = opClaimJob(store, ['extract'])!;

    assert.equal(work.id, read);
    opFinishJob(store, read, work.attempts);
    const first = opClaimJob(store, ['question'])!;

    assert.ok(first);
    assert.equal(opClaimJob(store, ['question']), null);
    opFinishQuestion(
      store,
      first.target.id as QuestionId,
      first.id,
      first.attempts,
      choice,
      'gist',
      []
    );
    assert.ok(opClaimJob(store, ['question']));
  }));
test('summaries list practices by recency with practice scores', (t) =>
  fixture(t, (store, raw, id) => {
    assert.deepEqual(opPracticeScore(store, id), {
      asked: 0,
      answered: 0,
      correct: 0,
      partly: 0,
      incorrect: 0
    });
    opEnsurePracticeQuestions(store, id);

    for (const answer of [0, 1]) {
      const job = opClaimJob(store, ['question'])!;

      opFinishQuestion(
        store,
        job.target.id as QuestionId,
        job.id,
        job.attempts,
        choice,
        'gist',
        []
      );
      opAnswerQuestion(store, job.target.id as QuestionId, {
        type: 'choice',
        choice: answer
      });
    }

    const open = opClaimJob(store, ['question'])!;

    opFinishQuestion(
      store,
      open.target.id as QuestionId,
      open.id,
      open.attempts,
      { type: 'open', question: 'Q', reference: 'A', cites: [] },
      'gist',
      []
    );
    const answered = opAnswerQuestion(store, open.target.id as QuestionId, {
      type: 'open',
      answer: 'some'
    })!;

    assert.deepEqual(opPracticeScore(store, id), {
      asked: 3,
      answered: 3,
      correct: 1,
      partly: 0,
      incorrect: 1
    });
    const grade = opClaimJob(store, ['grade'])!;

    assert.equal(grade.id, answered.jobId);
    opFinishGrade(
      store,
      open.target.id as QuestionId,
      grade.id,
      grade.attempts,
      'partly',
      'Almost'
    );
    const second = opCreatePractice(store, opCreateProject(store, 'Second').id);

    assert.deepEqual(
      opListPractices(store).map((p) => p.id),
      [second.id, id]
    );
    raw.run(sql`UPDATE practices SET updated_at=updated_at+10 WHERE id=${id}`);
    assert.deepEqual(
      opListPractices(store).map((p) => p.id),
      [id, second.id]
    );
    assert.deepEqual(opListPractices(store)[0].score, {
      asked: 3,
      answered: 3,
      correct: 1,
      partly: 1,
      incorrect: 1
    });
  }));

test('orphan recovery restores serial dependencies before later generation runs', (t) =>
  fixture(t, (store, raw, id) => {
    opEnsurePracticeQuestions(store, id);
    const first = opListQuestions(store, id)[0];
    const original = opListJobs(store).find(
      (j) => j.kind === 'question' && j.target.id === first.id
    )!;

    raw.run(sql`DELETE FROM jobs WHERE id=${original.id}`);
    opEnsurePracticeQuestions(store, id);
    const recovered = opClaimJob(store, ['question'])!;

    assert.equal(recovered.target.id, first.id);
    assert.equal(opClaimJob(store, ['question']), null);
    opFinishQuestion(store, first.id, recovered.id, recovered.attempts, choice, 'gist', []);
    assert.ok(opClaimJob(store, ['question']));
  }));
