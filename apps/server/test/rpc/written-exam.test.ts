import { StudyRpc, plainBlock, writtenExamTurnLimit } from '@study/contracts';
import type { WrittenExamInput } from '@study/contracts';
import { eq, workflow_executions } from '@study/db';
import { test } from '@study/testing';
import { Effect, Layer, Stream } from 'effect';
import { AiError, LanguageModel, Model } from 'effect/ai';

import { makeStudyClient } from '#server/client/index';
import { writtenExamAgent } from '#server/features/materials/agents/written-exam';
import { writtenExamWorkflow } from '#server/features/materials/service/written-exam';
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
          expect(
            yield* Effect.flip(
              exam({
                ...request,
                step: { ...hintStep, current: { question: first, hint: hint.message } }
              })
            )
          ).toMatchObject({ kind: 'invalid_input' });

          const history = [
            { question: first, hint: hint.message, answer: 'The cell divides in two.' }
          ] as const;
          const answer = { kind: 'answer' as const, concept, history };
          const next = {
            kind: 'question' as const,
            reply: 'Right, there are two cells. Let’s look at what each cell receives.',
            question: followup
          };

          const premature = {
            kind: 'summary' as const,
            understood: true,
            feedback: 'You have mastered mitosis.'
          };

          model.next(writtenExamAgent, {
            input: { step: answer, evidence },
            output: { next: premature }
          });
          expect(yield* Effect.flip(exam({ ...request, step: answer }))).toMatchObject({
            kind: 'transient'
          });

          model.next(writtenExamAgent, { input: { step: answer, evidence }, output: { next } });
          expect(yield* exam({ ...request, step: answer })).toEqual(next);

          const finish = { kind: 'finish' as const, concept, history };

          model.next(writtenExamAgent, {
            input: { step: finish, evidence },
            output: { next: premature }
          });
          model.next(writtenExamAgent, {
            input: { step: finish, evidence },
            output: { next: { kind: 'summary', understood: false, feedback: 'Review anaphase.' } }
          });
          expect(yield* exam({ ...request, step: finish })).toEqual({
            kind: 'summary',
            understood: false,
            feedback: 'Review anaphase.'
          });

          const finishWithoutAnswer = { kind: 'finish' as const, concept, history: [] };
          const review = {
            kind: 'summary' as const,
            understood: false,
            feedback: 'Review anaphase.'
          };

          model.next(writtenExamAgent, {
            input: { step: finishWithoutAnswer, evidence },
            output: { next: premature }
          });
          model.next(writtenExamAgent, {
            input: { step: finishWithoutAnswer, evidence },
            output: { next: review }
          });
          expect(yield* exam({ ...request, step: finishWithoutAnswer })).toEqual(review);

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
      .where(eq(workflow_executions.workflow_tag, writtenExamWorkflow._tag))
      .all();

    expect(privateRows.length).toBeGreaterThan(0);
    expect(JSON.stringify(privateRows)).not.toContain(concept);
    expect(JSON.stringify(privateRows)).not.toContain(first);
    expect(JSON.stringify(privateRows)).not.toContain('The cell divides in two.');
  }
);

function rawExamModel() {
  const replies: (string | AiError.AiError)[] = [];
  const calls: LanguageModel.ProviderOptions[] = [];
  const model = Model.make(
    'test' as string,
    'written-exam',
    Layer.effect(
      LanguageModel.LanguageModel,
      LanguageModel.make({
        generateText: () => Effect.die('Streaming is required'),
        streamText: (options) => {
          calls.push(options);
          const reply = replies.shift();

          if (reply === undefined) return Stream.die('Unexpected model call');

          if (typeof reply !== 'string') return Stream.fail(reply);

          return Stream.make(
            { type: 'text-start', id: 'reply' },
            { type: 'text-delta', id: 'reply', delta: reply },
            { type: 'text-end', id: 'reply' },
            {
              type: 'finish',
              reason: 'stop',
              usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } }
            }
          );
        }
      })
    )
  );

  return { replies, calls, ai: { model: () => Effect.succeed(model) } };
}

test.server.stable(
  'the written exam repairs only invalid finish output and spends at most one repair',
  async ({ resources, expect }) => {
    const provider = rawExamModel();
    const { server } = await resources.openRpc({ ai: provider.ai });
    const finish = {
      kind: 'finish' as const,
      concept: 'Mitosis',
      history: [{ question: 'What separates during anaphase?', answer: 'Chromosomes.' }] as const
    };
    const summary = { kind: 'summary', understood: false, feedback: 'Review anaphase.' };
    const valid = JSON.stringify({ next: summary });
    const blank = JSON.stringify({ next: { ...summary, feedback: ' ' } });
    const providerFailure = AiError.make({
      module: 'test',
      method: 'streamText',
      reason: new AiError.UnknownError({ description: 'Provider connection failed' })
    });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const exam = yield* examFixture(server.url);

          provider.replies.push(blank, valid);
          expect(yield* exam(finish)).toEqual(summary);
          expect(provider.calls).toHaveLength(2);

          provider.replies.push(valid);
          expect(yield* exam(finish)).toEqual(summary);
          expect(provider.calls).toHaveLength(3);

          provider.replies.push(providerFailure);
          expect(yield* Effect.flip(exam(finish))).toMatchObject({ kind: 'transient' });
          expect(provider.calls).toHaveLength(4);

          provider.replies.push(blank, blank);
          expect(yield* Effect.flip(exam(finish))).toMatchObject({ kind: 'transient' });
          expect(provider.calls).toHaveLength(6);
        })
      )
    );
  }
);

test.server.stable(
  'the exam provider can search selected passages without being instructed to cite markers',
  async ({ resources, expect }) => {
    const provider = rawExamModel();
    const { server } = await resources.openRpc({ ai: provider.ai });
    const opening = { kind: 'opening', concept: 'Cell division', question: 'Why do cells divide?' };

    provider.replies.push(JSON.stringify({ next: opening }));

    const result = await Effect.runPromise(
      Effect.scoped(examFixture(server.url).pipe(Effect.flatMap((exam) => exam({ kind: 'start' }))))
    );

    expect(result).toEqual(opening);
    expect(
      provider.calls[0]?.tools.map(({ name, description }) => ({ name, description }))
    ).toEqual([
      { name: 'sources', description: expect.stringMatching(/without.*citation markers/i) }
    ]);
  }
);

const title = 'Cell division';

const preview = 'Cells make more cells through division.';

const laterPassage = 'During anaphase, sister chromatids move to opposite poles.';

const evidence = [{ name: title, preview }];

const examFixture = Effect.fnUntraced(function* (baseUrl: string) {
  const client = yield* makeStudyClient(StudyRpc, { baseUrl });
  const { id: projectId } = yield* client['projects.createProject']({ name: 'Biology' });
  const document = deletionDocument(preview);
  const page = yield* client['pages.create']({
    createKey: crypto.randomUUID(),
    projectId,
    title,
    inputs: [],
    citations: [],
    document: {
      ...document,
      blocks: [...document.blocks, plainBlock('paragraph', laterPassage, { type: 'authored' })]
    }
  });
  const inputs = [{ kind: 'page', versionId: page.version!.id }] as const;

  return (step: WrittenExamInput['step']) =>
    client['materials.writtenExam']({ projectId, inputs, step });
});

test.server.stable(
  'a written exam rejects a repeated question with different trailing punctuation',
  async ({ resources, createAiMock, expect }) => {
    using model = createAiMock();
    const { server } = await resources.openRpc({ ai: model.runtime });
    const step = {
      kind: 'answer' as const,
      concept: 'Mitosis',
      history: [{ question: 'What separates during anaphase?', answer: 'Chromosomes.' }] as const
    };

    model.next(writtenExamAgent, {
      input: { step, evidence },
      output: {
        next: { kind: 'question', question: 'What separates during anaphase', reply: 'Try again.' }
      }
    });

    const failure = await Effect.runPromise(
      Effect.scoped(examFixture(server.url).pipe(Effect.flatMap((exam) => Effect.flip(exam(step)))))
    );

    expect(failure).toMatchObject({ kind: 'transient' });
  }
);

test.server.stable(
  'the written exam requests a recap at the tenth answer and repairs one follow-up',
  async ({ resources, createAiMock, expect }) => {
    using model = createAiMock();
    const { server } = await resources.openRpc({ ai: model.runtime });
    const exchange = { question: 'What separates during anaphase?', answer: 'Chromosomes.' };
    const history = [
      exchange,
      ...Array.from({ length: writtenExamTurnLimit - 1 }, (_, index) => ({
        question: `What else can you say about this step, part ${index + 1}?`,
        answer: 'I am still unsure.'
      }))
    ] as const;
    const step = { kind: 'answer' as const, concept: 'Mitosis', history };
    const finish = { ...step, kind: 'finish' as const };
    const wrong = { kind: 'question' as const, question: 'What moves it?', reply: 'Think bigger.' };
    const summary = {
      kind: 'summary' as const,
      understood: false,
      feedback: 'Review where the sister chromatids move after separating.'
    };

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const exam = yield* examFixture(server.url);

          model.next(writtenExamAgent, {
            input: { step: finish, evidence },
            output: { next: wrong }
          });
          model.next(writtenExamAgent, {
            input: { step: finish, evidence },
            output: { next: summary }
          });
          expect(yield* exam(step)).toEqual(summary);

          model.next(writtenExamAgent, {
            input: { step: finish, evidence },
            output: { next: wrong }
          });
          model.next(writtenExamAgent, {
            input: { step: finish, evidence },
            output: { next: wrong }
          });
          expect(yield* Effect.flip(exam(step))).toMatchObject({ kind: 'transient' });
        })
      )
    );
  }
);

test.server.stable(
  'a written exam reconsiders a topic found beyond the page preview',
  async ({ resources, createAiMock, expect }) => {
    using model = createAiMock();
    const { server } = await resources.openRpc({ ai: model.runtime });
    const step = { kind: 'start' as const, topic: 'Anaphase' };
    const opening = {
      kind: 'opening' as const,
      concept: 'Anaphase',
      question: 'What happens to the sister chromatids during anaphase?'
    };

    model.next(writtenExamAgent, {
      input: { step, evidence },
      output: { next: { kind: 'unavailable' } }
    });
    model.next(writtenExamAgent, {
      input: { step, evidence: [...evidence, { name: title, preview: `[2] ${laterPassage}` }] },
      output: { next: opening }
    });

    const result = await Effect.runPromise(
      Effect.scoped(examFixture(server.url).pipe(Effect.flatMap((exam) => exam(step))))
    );

    expect(result).toEqual(opening);
  }
);
