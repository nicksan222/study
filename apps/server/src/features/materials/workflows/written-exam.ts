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

type Evidence = Parameters<typeof writtenExamAgent.prompt>[0]['evidence'];

function unexpectedTurn() {
  return Effect.fail(new StudyError('transient', 'Unexpected written exam response'));
}

function examSummary(
  step: Extract<Step, { kind: 'answer' | 'finish' }>,
  summary: Extract<WrittenExamResult, { kind: 'summary' }>
) {
  if (summary.understood) {
    return step.history.length >= 2 ? Effect.succeed(summary) : unexpectedTurn();
  }

  return step.kind === 'finish' ? Effect.succeed(summary) : unexpectedTurn();
}

const comparableQuestion = (question: string) =>
  question
    .trim()
    .replace(/[.!?…！？。]+$/u, '')
    .trimEnd()
    .toLowerCase();

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

  if (step.kind !== 'answer' || next.kind !== 'question') return unexpectedTurn();

  const nextQuestion = comparableQuestion(next.question);
  const repeated = step.history.some(
    ({ question }) => comparableQuestion(question) === nextQuestion
  );

  return repeated ? unexpectedTurn() : Effect.succeed(next);
}

function resolveExamTurn(
  step: Step,
  evidence: Evidence,
  run: (step: Step, evidence: Evidence) => Effect.Effect<WrittenExamResult, StudyError, Agents>,
  findTopic: (topic: string) => Evidence
) {
  return Effect.gen(function* () {
    const request =
      step.kind === 'answer' && step.history.length === writtenExamTurnLimit
        ? { ...step, kind: 'finish' as const }
        : step;
    const next = yield* run(request, evidence);
    const validate = (response: WrittenExamResult) => examResult(request, response);

    if (next.kind === 'unavailable' && step.kind === 'start' && step.topic) {
      const matches = findTopic(step.topic);

      if (matches.length > 0)
        return yield* run(request, [...evidence, ...matches]).pipe(Effect.flatMap(validate));
    }

    const result = validate(next);

    return yield* request.kind === 'finish'
      ? result.pipe(Effect.catch(() => run(request, evidence).pipe(Effect.flatMap(validate))))
      : result;
  });
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
        const searched = new Set<string>();
        const run = (step: Step, evidence: Evidence) =>
          generateAgent(writtenExamAgent, { step, evidence }, { preflight, maxRetries: 0 }).pipe(
            Effect.tap(preflight),
            Effect.map(({ next }) => next)
          );
        const findTopic = (topic: string) =>
          searched.has(topic.trim().toLowerCase())
            ? []
            : catalog.search(topic).map(({ name, text }) => ({ name, preview: text }));
        const result = yield* resolveExamTurn(step, evidence, run, findTopic).pipe(
          Effect.raceFirst(cancelled),
          Effect.provideService(Agents, {
            ...agents,
            observe: undefined,
            searchSources: (query) =>
              preflight.pipe(
                Effect.map(() => {
                  searched.add(query.trim().toLowerCase());

                  return catalog.search(query);
                })
              )
          })
        );

        yield* Deferred.succeed(reply, result);
      }
    })
});
