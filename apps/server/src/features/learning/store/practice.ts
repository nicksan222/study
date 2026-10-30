import { randomUUID } from 'node:crypto';

import { errorKindSchema, failureSchema } from '@study/contracts/errors';
import type { ErrorKind } from '@study/contracts/errors';
import {
  materialVersionIdSchema,
  projectIdSchema,
  quizQuestionIdSchema
} from '@study/contracts/ids';
import type { MaterialVersionId, ProjectId } from '@study/contracts/ids';
import {
  practiceInputSchema,
  startPracticeInputSchema,
  answerPracticeQuestionInputSchema,
  publishPracticeSlotInputSchema,
  practiceSchema,
  practiceSlotSchema,
  retryPracticeQuestionInputSchema
} from '@study/contracts/learning/rpc';
import { quizAttemptSchema } from '@study/contracts/learning/schemas';
import { materialGenerationPayloadSchema } from '@study/contracts/materials/schemas';
import { and, desc, eq, inArray, sql } from '@study/db';
import * as s from '@study/db/schema';
import { Cause, Exit, Schema, Option } from 'effect';
import { Workflow } from 'effect/workflow';

import { requireRow } from '#server/platform/database/rows';
import type { StoreResources } from '#server/platform/definitions/define-store';
import { defineStore, storeMutation, storeQuery } from '#server/platform/definitions/define-store';
import { invalid } from '#server/platform/errors/domain-error';

import { makeAnswerQuestion } from './answer-question.ts';
import { makeQuiz } from './quiz.ts';
import { makeStartQuiz } from './start-quiz.ts';

const controls = s.learning_practice_controls;

const slots = s.learning_practice_slots;

type Slot = typeof slots.$inferSelect;

const generationEventId = (row: Slot) =>
  row.generation_attempt === 0n ? row.id : `${row.id}/retry/${row.generation_attempt}`;

const resultCodec = Schema.toCodecJson(
  Workflow.Result({ success: Schema.Unknown, error: failureSchema })
);

function makePractice(resources: StoreResources) {
  const { db } = resources;
  const { answerQuestion } = makeAnswerQuestion(resources);
  const { attemptView } = makeQuiz(resources);
  const { startQuiz } = makeStartQuiz(resources);

  function receiptExecutions() {
    return db.orm
      .select({ status: s.workflow_executions.status, result: s.workflow_executions.result })
      .from(s.workflowReceipts)
      .innerJoin(
        s.workflow_executions,
        eq(s.workflow_executions.execution_id, s.workflowReceipts.executionId)
      );
  }

  function failureKind(row: Slot): ErrorKind | null {
    if (row.status !== 'pending') return null;

    if (row.failure_kind) return row.failure_kind;

    const execution = receiptExecutions()
      .where(
        and(
          eq(s.workflowReceipts.eventId, generationEventId(row)),
          eq(s.workflowReceipts.subscription, 'material-generation')
        )
      )
      .get();

    if (!execution) {
      // A committed child event is still durable work even before dispatcher delivery.
      const queued = db.orm
        .select({ id: s.workflowEvents.eventId })
        .from(s.workflowEvents)
        .where(eq(s.workflowEvents.eventId, generationEventId(row)))
        .get();

      if (queued) return null;

      const preparation = receiptExecutions()
        .innerJoin(s.workflowEvents, eq(s.workflowEvents.eventId, s.workflowReceipts.eventId))
        .where(
          and(
            eq(s.workflowReceipts.subscription, 'practice-slot'),
            eq(s.workflowEvents.correlationId, row.id),
            sql`COALESCE(json_extract(${s.workflowEvents.payload}, '$.generationAttempt'), 0) = ${row.generation_attempt}`
          )
        )
        .orderBy(desc(s.workflowEvents.createdAt), desc(s.workflowEvents.eventId))
        .limit(1)
        .get();

      return terminalFailure(preparation);
    }

    return terminalFailure(execution);
  }

  function terminalFailure(
    execution: { status: string; result: string | null } | undefined
  ): ErrorKind | null {
    if (!execution) return null;

    if (execution.status === 'cancelled') return 'cancelled';

    if (execution.status !== 'completed' || !execution.result) return null;

    const result = Schema.decodeUnknownSync(resultCodec)(JSON.parse(execution.result));

    if (result._tag !== 'Complete' || !Exit.isFailure(result.exit)) return null;

    const failure = Cause.findErrorOption(result.exit.cause);

    return Option.isSome(failure) && Schema.is(errorKindSchema)(failure.value.kind)
      ? failure.value.kind
      : 'internal';
  }

  const view = (row: Slot, failure: ErrorKind | null = row.failure_kind) => ({
    slotId: row.id,
    projectId: row.project_id,
    epoch: row.epoch,
    ordinal: row.ordinal,
    kind: row.kind,
    status: row.status === 'pending' && failure ? ('failed' as const) : row.status,
    generationAttempt: row.generation_attempt,
    failureKind: row.status === 'pending' ? failure : null,
    inputVersionIds: Schema.decodeUnknownSync(
      Schema.fromJsonString(
        Schema.toCodecJson(Schema.mutable(Schema.Array(materialVersionIdSchema)))
      )
    )(row.input_version_ids),
    versionId: row.version_id,
    attemptId: row.attempt_id
  });

  const control = (projectId: ProjectId) =>
    db.orm.select().from(controls).where(eq(controls.project_id, projectId)).get();

  function practice(projectId: ProjectId) {
    const current = control(projectId);
    const rows = current
      ? db.orm
          .select()
          .from(slots)
          .where(
            and(
              eq(slots.project_id, projectId),
              eq(slots.epoch, current.epoch),
              inArray(slots.status, ['pending', 'ready'])
            )
          )
          .orderBy(slots.ordinal)
          .limit(2)
          .all()
      : [];

    return {
      projectId,
      enabled: current?.enabled ?? false,
      epoch: current?.epoch ?? null,
      slots: rows.map((row) => view(row, failureKind(row)))
    };
  }

  function activeSlot(id: string) {
    const row = db.orm.select().from(slots).where(eq(slots.id, id)).get();

    if (!row) return null;

    const current = control(row.project_id);

    return current?.enabled && current.epoch === row.epoch && row.status === 'pending'
      ? view(row, failureKind(row))
      : null;
  }

  function reserve(
    projectId: ProjectId,
    epoch: string,
    ordinal: bigint,
    inputVersionIds: readonly MaterialVersionId[]
  ) {
    const id = randomUUID();

    db.orm
      .insert(slots)
      .values({
        id,
        project_id: projectId,
        epoch,
        ordinal,
        kind: ordinal % 3n === 2n ? 'open' : 'choice',
        status: 'pending',
        input_version_ids: JSON.stringify(inputVersionIds.map(String))
      })
      .run();

    return id;
  }

  function assertPracticeInputs(
    projectId: ProjectId,
    inputVersionIds: readonly MaterialVersionId[]
  ) {
    for (const id of inputVersionIds) {
      const row = db.orm
        .select()
        .from(s.material_versions)
        .where(
          and(
            eq(s.material_versions.id, id),
            eq(s.material_versions.project_id, projectId),
            eq(s.material_versions.kind, 'document'),
            eq(s.material_versions.status, 'published')
          )
        )
        .get();
      const material =
        row && db.orm.select().from(s.materials).where(eq(s.materials.id, row.material_id)).get();
      const document = db.orm
        .select()
        .from(s.material_document_versions)
        .where(eq(s.material_document_versions.version_id, id))
        .get();

      if (!row || !material || material.archived_at !== null || !document)
        invalid('practice input must be an active published project document');
    }
  }

  function start(projectId: ProjectId, inputVersionIds: readonly MaterialVersionId[]) {
    const existing = control(projectId);

    if (existing?.enabled) return [];

    if (
      !inputVersionIds.length ||
      inputVersionIds.length > 20 ||
      new Set(inputVersionIds).size !== inputVersionIds.length
    )
      invalid('invalid practice inputs');

    assertPracticeInputs(projectId, inputVersionIds);

    const epoch = randomUUID();

    db.orm
      .insert(controls)
      .values({ project_id: projectId, epoch, enabled: true })
      .onConflictDoUpdate({ target: controls.project_id, set: { epoch, enabled: true } })
      .run();

    return [
      reserve(projectId, epoch, 0n, inputVersionIds),
      reserve(projectId, epoch, 1n, inputVersionIds)
    ];
  }

  function stop(projectId: ProjectId, epoch: string) {
    db.orm
      .update(controls)
      .set({ enabled: false })
      .where(and(eq(controls.project_id, projectId), eq(controls.epoch, epoch)))
      .run();
    db.orm
      .update(slots)
      .set({ status: 'cancelled' })
      .where(
        and(
          eq(slots.project_id, projectId),
          eq(slots.epoch, epoch),
          inArray(slots.status, ['pending', 'ready'])
        )
      )
      .run();
  }

  function assertPublicationIntent(row: typeof slots.$inferSelect, slotId: string) {
    const request = db.orm
      .select()
      .from(s.material_generation_requests)
      .where(eq(s.material_generation_requests.id, slotId))
      .get();

    if (!request || request.project_id !== row.project_id)
      invalid('invalid practice generation intent');

    const intent = Schema.decodeUnknownSync(
      Schema.fromJsonString(Schema.toCodecJson(materialGenerationPayloadSchema))
    )(request.payload);
    const captured = view(row).inputVersionIds;

    if (
      intent.kind !== 'quiz' ||
      intent.scopeId !== row.epoch ||
      intent.questionSpec?.count !== 1 ||
      intent.questionSpec.kind !== row.kind ||
      intent.inputVersionIds.length !== captured.length ||
      intent.inputVersionIds.some((id, i) => id !== captured[i])
    )
      invalid('invalid practice generation intent');
  }

  function assertRetrySlot(row: typeof slots.$inferSelect | undefined) {
    if (
      !row ||
      !control(row.project_id)?.enabled ||
      control(row.project_id)?.epoch !== row.epoch ||
      row.status !== 'pending'
    )
      invalid('practice slot is inactive');

    return row;
  }

  function publish(slotId: string, versionId: MaterialVersionId) {
    const row = db.orm.select().from(slots).where(eq(slots.id, slotId)).get();

    if (!row) return null;

    if (row.version_id !== null) {
      if (row.version_id !== versionId || row.attempt_id === null)
        invalid('practice publication conflict');

      return attemptView(row.attempt_id);
    }

    if (!activeSlot(slotId)) return null;

    const version = db.orm
      .select()
      .from(s.material_versions)
      .where(
        and(
          eq(s.material_versions.id, versionId),
          eq(s.material_versions.project_id, row.project_id),
          eq(s.material_versions.kind, 'quiz'),
          eq(s.material_versions.status, 'published'),
          eq(s.material_versions.generation_request_id, slotId)
        )
      )
      .get();

    assertPublicationIntent(row, slotId);

    const questions = db.orm
      .select()
      .from(s.material_quiz_questions)
      .where(eq(s.material_quiz_questions.version_id, versionId))
      .all();

    if (
      !version ||
      questions.length !== 1 ||
      (questions[0]!.kind === 'open') !== (row.kind === 'open')
    )
      invalid('invalid practice quiz publication');

    const attempt = startQuiz({ versionId });

    db.orm
      .update(slots)
      .set({ status: 'ready', version_id: versionId, attempt_id: attempt.id })
      .where(eq(slots.id, slotId))
      .run();

    return attempt;
  }

  function answerSlot(id: string) {
    const row = db.orm.select().from(slots).where(eq(slots.id, id)).get();

    if (!row || row.attempt_id === null || row.version_id === null)
      invalid('practice slot is not ready');

    const current = control(row.project_id);

    if (
      row.status !== 'answered' &&
      (!current?.enabled || current.epoch !== row.epoch || row.status !== 'ready')
    )
      invalid('practice slot is inactive');

    return row;
  }

  function refill(row: Slot) {
    db.orm.update(slots).set({ status: 'answered' }).where(eq(slots.id, row.id)).run();
    const last = requireRow(
      db.orm
        .select()
        .from(slots)
        .where(and(eq(slots.project_id, row.project_id), eq(slots.epoch, row.epoch)))
        .orderBy(desc(slots.ordinal))
        .limit(1)
        .get()
    );

    return reserve(row.project_id, row.epoch, last.ordinal + 1n, view(row).inputVersionIds);
  }

  return {
    practice,
    start,
    stop,
    publish,
    answerSlot,
    assertRetrySlot,
    refill,
    control,
    failureKind,
    activeSlot,
    attemptView,
    answerQuestion,
    view
  };
}

const controlSchema = Schema.Struct({
  projectId: projectIdSchema,
  epoch: Schema.String,
  enabled: Schema.Boolean
});

const practiceSlotLookupSchema = Schema.Struct({ slotId: Schema.String });

export const PracticeStore = defineStore({
  name: 'study/LearningPracticeStore',
  entity: { singular: 'practice', plural: 'practices' },
  make: (resources) => {
    const { db } = resources;
    const {
      practice,
      start,
      stop,
      publish,
      answerSlot,
      assertRetrySlot,
      refill,
      control,
      failureKind,
      attemptView,
      answerQuestion,
      view
    } = makePractice(resources);

    return {
      queries: {
        practice: storeQuery({
          role: 'required',
          input: practiceInputSchema,
          output: practiceSchema,
          run: (input) => practice(input.projectId)
        })
      },
      mutations: {
        start: storeMutation({
          input: startPracticeInputSchema,
          output: Schema.Array(Schema.String),
          run: (input) => start(input.projectId, input.inputVersionIds)
        }),
        stop: storeMutation({
          input: Schema.Struct({ ...practiceInputSchema.fields, epoch: Schema.String }),
          output: Schema.Void,
          run: (input) => stop(input.projectId, input.epoch)
        }),
        publish: storeMutation({
          input: publishPracticeSlotInputSchema,
          output: Schema.NullOr(quizAttemptSchema),
          run: (input) => publish(input.slotId, input.versionId)
        }),
        answer: storeMutation({
          input: answerPracticeQuestionInputSchema,
          output: Schema.Struct({
            attempt: quizAttemptSchema,
            slotId: Schema.NullOr(Schema.String),
            projectId: projectIdSchema,
            epoch: Schema.String,
            questionId: quizQuestionIdSchema
          }),
          run: (input) => {
            const row = answerSlot(input.slotId);
            const attempt = attemptView(row.attempt_id!);

            if (!attempt.questions[0]) invalid('invalid practice attempt');

            const questionId = attempt.questions[0].id;

            if (row.status === 'answered') {
              const same = sameAnswer(attempt.questions[0].answer, input.answer);

              if (!same) invalid('practice answer differs from the committed response');

              return {
                attempt,
                slotId: null,
                projectId: row.project_id,
                epoch: row.epoch,
                questionId
              };
            }

            if (attempt.status !== 'in_progress') invalid('invalid practice attempt');

            const result = answerQuestion(
              {
                attemptId: row.attempt_id!,
                questionId,
                answer: input.answer
              },
              row.id
            );

            return {
              attempt: result,
              slotId: refill(row),
              projectId: row.project_id,
              epoch: row.epoch,
              questionId
            };
          }
        }),
        retry: storeMutation({
          input: retryPracticeQuestionInputSchema,
          output: Schema.Struct({ slot: practiceSlotSchema, requested: Schema.Boolean }),
          run: (input) => {
            const found = db.orm.select().from(slots).where(eq(slots.id, input.slotId)).get();

            const row = assertRetrySlot(found);

            const scope = db.orm
              .select()
              .from(s.material_generation_scopes)
              .where(eq(s.material_generation_scopes.id, row.epoch))
              .get();

            if (scope && (!scope.enabled || scope.project_id !== row.project_id))
              invalid('practice generation scope is closed');

            const failure = failureKind(row);

            if (!failure) {
              if (row.generation_attempt > 0n) return { slot: view(row, null), requested: false };

              invalid('practice slot has not failed');
            }

            if (!row.failure_kind)
              db.orm.update(slots).set({ failure_kind: failure }).where(eq(slots.id, row.id)).run();

            const updated = requireRow(
              db.orm
                .update(slots)
                .set({ generation_attempt: row.generation_attempt + 1n, failure_kind: null })
                .where(eq(slots.id, row.id))
                .returning()
                .get()
            );

            return { slot: view(updated, null), requested: true };
          }
        }),
        fail: storeMutation({
          input: Schema.Struct({
            slotId: Schema.String,
            projectId: projectIdSchema,
            generationEventId: Schema.String,
            errorKind: errorKindSchema
          }),
          output: Schema.Boolean,
          run: (input) => {
            const row = db.orm.select().from(slots).where(eq(slots.id, input.slotId)).get();

            if (
              !row ||
              row.project_id !== input.projectId ||
              row.status !== 'pending' ||
              generationEventId(row) !== input.generationEventId
            )
              return false;

            const current = control(row.project_id);

            if (!current?.enabled || current.epoch !== row.epoch) return false;

            db.orm
              .update(slots)
              .set({ failure_kind: input.errorKind })
              .where(eq(slots.id, row.id))
              .run();

            return true;
          }
        })
      }
    };
  }
});

export const PracticeSlotStore = defineStore({
  name: 'study/LearningPracticeSlotStore',
  entity: { singular: 'practiceSlot', plural: 'practiceSlots' },
  make: (resources) => {
    const { activeSlot } = makePractice(resources);

    return {
      queries: {
        findPracticeSlot: storeQuery({
          role: 'optional',
          input: practiceSlotLookupSchema,
          output: Schema.Option(practiceSlotSchema),
          run: (input) => Option.fromNullishOr(activeSlot(input.slotId))
        })
      },
      mutations: {}
    };
  }
});

export const PracticeControlStore = defineStore({
  name: 'study/LearningPracticeControlStore',
  entity: { singular: 'practiceControl', plural: 'practiceControls' },
  make: (resources) => {
    const { control } = makePractice(resources);

    return {
      queries: {
        findPracticeControl: storeQuery({
          role: 'optional',
          input: practiceInputSchema,
          output: Schema.Option(controlSchema),
          run: (input) => {
            const row = control(input.projectId);

            return row
              ? Option.some({ projectId: row.project_id, epoch: row.epoch, enabled: row.enabled })
              : Option.none();
          }
        })
      },
      mutations: {}
    };
  }
});

function sameAnswer(
  previous: (typeof quizAttemptSchema.Type)['questions'][number]['answer'],
  answer: (typeof answerPracticeQuestionInputSchema.Type)['answer']
) {
  return previous?.type === 'open' && answer.type === 'open'
    ? previous.answer === answer.answer
    : previous?.type === 'choice' && answer.type === 'choice'
      ? previous.choiceIds.length === answer.choiceIds.length &&
        previous.choiceIds.every((id) => answer.type === 'choice' && answer.choiceIds.includes(id))
      : false;
}
