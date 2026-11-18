import { StudyRpc } from '@study/contracts';
import { workflow_executions } from '@study/db';
import { test } from '@study/testing';
import { Effect } from 'effect';

import { makeStudyClient } from '#server/client/index';
import { writtenExamAgent } from '#server/features/materials/agents/written-exam';
import { deletionDocument } from '#testing/material-deletion';

test.server.stable(
  'a written exam keeps its concept, probes an incomplete explanation and returns a recap',
  async ({ resources, createAiMock, expect }) => {
    using model = createAiMock();
    const { app, server } = await resources.openRpc({ ai: model.runtime });
    const concept = 'Mitosis';
    const text = 'Mitosis preserves chromosome number and separates sister chromatids.';
    const first = 'Explain how mitosis preserves chromosome number.';
    const followup = 'What separates during anaphase?';
    const evidence = [{ name: 'Cell division', preview: text }];

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const client = yield* makeStudyClient(StudyRpc, { baseUrl: server.url });
          const { id: projectId } = yield* client['projects.createProject']({ name: 'Biology' });
          const page = yield* client['pages.create']({
            createKey: crypto.randomUUID(),
            projectId,
            title: 'Cell division',
            inputs: [],
            citations: [],
            document: deletionDocument(text)
          });
          const request = {
            projectId,
            inputs: [{ kind: 'page', versionId: page.version!.id }] as const
          };
          const exam = client['materials.writtenExam'];
          const start = { kind: 'start' as const, topic: concept };
          const opened = { kind: 'opening' as const, concept, question: first };

          model.next(writtenExamAgent, {
            input: { step: start, evidence },
            output: { next: opened }
          });
          expect(yield* exam({ ...request, step: start })).toEqual(opened);

          const hintStep = {
            kind: 'hint' as const,
            concept,
            history: [],
            current: { question: first },
            draft: 'I think it has to do with DNA.'
          };
          const hint = {
            kind: 'hint' as const,
            message: 'Think about the copies of each chromosome just before division.'
          };

          model.next(writtenExamAgent, {
            input: { step: hintStep, evidence },
            output: { next: hint }
          });
          expect(yield* exam({ ...request, step: hintStep })).toEqual(hint);

          const history = [
            { question: first, hint: hint.message, answer: 'The cell divides in two.' }
          ] as const;
          const answer = { kind: 'answer' as const, concept, history };
          const next = {
            kind: 'question' as const,
            reply: 'Right, there are two cells. Let’s look at what each cell receives.',
            question: followup
          };

          model.next(writtenExamAgent, { input: { step: answer, evidence }, output: { next } });
          expect(yield* exam({ ...request, step: answer })).toEqual(next);

          const finish = { kind: 'finish' as const, concept, history };

          model.next(writtenExamAgent, {
            input: { step: finish, evidence },
            output: { next: { kind: 'summary', understood: true, feedback: 'Review anaphase.' } }
          });
          expect(yield* exam({ ...request, step: finish })).toEqual({
            kind: 'summary',
            understood: false,
            feedback: 'Review anaphase.'
          });

          const complete = {
            ...answer,
            history: [
              ...history,
              { question: followup, reply: next.reply, answer: 'Sister chromatids separate.' }
            ] as const
          };
          const summary = {
            kind: 'summary' as const,
            understood: true,
            feedback: 'You explained how separating sister chromatids preserves chromosome number.'
          };

          model.next(writtenExamAgent, {
            input: { step: complete, evidence },
            output: { next: summary }
          });
          expect(yield* exam({ ...request, step: complete })).toEqual(summary);

          const other = yield* client['projects.createProject']({ name: 'Other subject' });

          expect(
            yield* Effect.flip(exam({ ...request, projectId: other.id, step: start }))
          ).toMatchObject({ kind: 'invalid_input' });
        })
      )
    );

    const privateRows = app.store.db.orm
      .select({ payload: workflow_executions.payload, result: workflow_executions.result })
      .from(workflow_executions)
      .all();

    expect(privateRows.length).toBeGreaterThan(0);
    expect(JSON.stringify(privateRows)).not.toContain(concept);
    expect(JSON.stringify(privateRows)).not.toContain(first);
    expect(JSON.stringify(privateRows)).not.toContain('The cell divides in two.');
  }
);
