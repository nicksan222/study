/** @file Owns written exam model execution and per-turn source validation. */
import { StudyError, contentInputKey, writtenExamTurnLimit } from '@study/contracts';
import type { WrittenExamInput, WrittenExamResult } from '@study/contracts';
import {
  Agents,
  Database,
  createEvidenceCatalog,
  defineActivity,
  defineWorkflowHandler,
  generateAgent,
  normalizeError,
  transaction
} from '@study/server';
import { Deferred, Effect } from 'effect';

import { writtenExamAgent } from '#server/features/materials/agents/written-exam';
import { assertContentInputs } from '#server/features/materials/service/content-inputs';
import { Materials } from '#server/features/materials/service/index';
import { writtenExamWorkflow } from '#server/features/materials/service/written-exam';

type Step = WrittenExamInput['step'];

function unexpectedTurn() {
  return Effect.fail(new StudyError('transient', 'Unexpected written exam response'));
}

function examSummary(
  step: Extract<Step, { kind: 'answer' | 'finish' }>,
  summary: Extract<WrittenExamResult, { kind: 'summary' }>
) {
  const enoughAnswers = step.history.length >= 2;
  const finished = step.kind === 'finish' || step.history.length === writtenExamTurnLimit;

  if (!finished && !(summary.understood && enoughAnswers)) return unexpectedTurn();

  return Effect.succeed({ ...summary, understood: summary.understood && enoughAnswers });
}

function examResult(
  step: Step,
  next: WrittenExamResult
): Effect.Effect<WrittenExamResult, StudyError> {
  if (step.kind === 'start')
    return next.kind === 'opening' || next.kind === 'unavailable'
      ? Effect.succeed(next)
      : unexpectedTurn();

  if (step.kind === 'hint')
    return next.kind === 'hint' && !step.current.hint ? Effect.succeed(next) : unexpectedTurn();

  return answerResult(step, next);
}

function answerResult(step: Extract<Step, { kind: 'answer' | 'finish' }>, next: WrittenExamResult) {
  if (next.kind === 'summary') return examSummary(step, next);

  if (
    step.kind !== 'answer' ||
    next.kind !== 'question' ||
    step.history.length >= writtenExamTurnLimit
  )
    return unexpectedTurn();

  const repeated = step.history.some(
    ({ question }) => question.trim().toLowerCase() === next.question.trim().toLowerCase()
  );

  return repeated ? unexpectedTurn() : Effect.succeed(next);
}

export const writtenExamRegistration = defineWorkflowHandler(writtenExamWorkflow, {
  triggers: [],
  execute: ({ requestId }) =>
    defineActivity({
      name: 'evaluate-turn',
      execute: function* () {
        const materials = yield* Materials;
        const current = materials.pendingExamTurn(requestId);
        const {
          input: { projectId, inputs, step },
          reply,
          closed
        } = yield* current;
        const load = transaction((tx) => assertContentInputs(tx, inputs, projectId, true));
        const database = yield* Database;
        const pages = yield* load;
        const agents = yield* Agents;
        const catalog = yield* Effect.try({
          try: () =>
            createEvidenceCatalog(
              pages.map(({ input, name, document }) => ({
                key: contentInputKey(input),
                reference: input,
                name,
                blocks: document.blocks
              }))
            ),
          catch: normalizeError
        });
        const evidence = pages.map(({ name, document }) => ({
          name,
          preview: (document.blocks.find(({ text }) => text.trim())?.text ?? '').slice(0, 600)
        }));
        const preflight = current.pipe(
          Effect.andThen(load),
          Effect.provideService(Database, database),
          Effect.asVoid
        );
        const cancelled = Deferred.await(closed).pipe(
          Effect.andThen(Effect.fail(new StudyError('cancelled', 'Written exam request ended')))
        );
        const { next } = yield* generateAgent(
          writtenExamAgent,
          { step, evidence },
          { preflight, maxRetries: 0 }
        ).pipe(
          Effect.raceFirst(cancelled),
          Effect.provideService(Agents, {
            ...agents,
            observe: undefined,
            searchSources: (query) => preflight.pipe(Effect.map(() => catalog.search(query)))
          })
        );

        yield* preflight;

        const result = yield* examResult(step, next);

        yield* Deferred.succeed(reply, result);
      }
    })
});
