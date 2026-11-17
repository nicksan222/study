import { defaultAgentRules } from '@study/contracts';
import type { ChatMessage, noteSectionTitleRequestedSchema } from '@study/contracts';
import { eq, workflow_configuration_waits, workflowEvents } from '@study/db';
import {
  agentsLayer,
  Database,
  decodeEvent,
  WorkflowConfiguration,
  workflowEngineLayer
} from '@study/server';
import type { ServerContext } from '@study/server';
import { Effect, Layer } from 'effect';
import { WorkflowEngine } from 'effect/workflow';

import { Notes } from '#server/features/notes/index';
import { noteSectionTitleRegistration } from '#server/features/notes/workflows/section-title';
import { Settings } from '#server/features/settings/index';
import { withTestAdmission } from '#testing/workflow-admission';

type SectionEvent = typeof noteSectionTitleRequestedSchema.Type;

type Model = Parameters<typeof agentsLayer>[0]['model'];

export function domain(context: ServerContext) {
  return Layer.merge(Notes.layer, Settings.layer).pipe(
    Layer.provideMerge(Layer.succeed(Database, { store: context }))
  );
}

export function services(
  context: ServerContext,
  model: Model,
  language: 'english' | 'italian',
  revision = () => 'configured'
) {
  return noteSectionTitleRegistration.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        domain(context),
        agentsLayer({
          model,
          language,
          rules: Effect.succeed(defaultAgentRules),
          searchSources: () => Effect.succeed([])
        }),
        Layer.succeed(WorkflowConfiguration, { revision: Effect.sync(revision) }),
        workflowEngineLayer(context)
      )
    )
  );
}

export function makeCapture(context: ServerContext, text: string) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const notes = yield* Notes;
      const note = yield* notes.createNote({ title: 'Lesson material' });

      return yield* notes.postMessage({ noteId: note.id, text, requestReply: false });
    }).pipe(Effect.provide(domain(context)))
  );
}

export function eventFor(context: ServerContext, message: ChatMessage) {
  const event = context.db.orm
    .select()
    .from(workflowEvents)
    .all()
    .map((row) => decodeEvent(row.payload))
    .findLast(
      (row) =>
        row.type === 'NoteSectionTitleRequested' &&
        row.messageId === message.id &&
        row.versionId === message.activeVersionId
    );

  if (!event || event.type !== 'NoteSectionTitleRequested')
    throw new Error('Missing committed section-title event');

  return event;
}

export function execute(
  context: ServerContext,
  model: Model,
  language: 'english' | 'italian',
  event: SectionEvent,
  executionId: string
) {
  return Effect.runPromise(
    Effect.scoped(
      Effect.flatMap(WorkflowEngine.WorkflowEngine, (engine) =>
        withTestAdmission(
          context,
          noteSectionTitleRegistration.definition,
          executionId,
          { event },
          engine.execute(noteSectionTitleRegistration.definition, {
            executionId,
            payload: { event }
          })
        )
      ).pipe(Effect.provide(services(context, model, language)))
    )
  );
}

export function configurationWait(context: ServerContext, executionId: string) {
  return new Promise<void>((resolve) => {
    let unsubscribe = () => {};
    const observe = () => {
      if (
        !context.db.orm
          .select()
          .from(workflow_configuration_waits)
          .where(eq(workflow_configuration_waits.execution_id, executionId))
          .get()
      )
        return;

      unsubscribe();
      resolve();
    };

    unsubscribe = context.subscribe(observe);
    observe();
  });
}

export function titleEvents(context: ServerContext) {
  return context.db.orm
    .select()
    .from(workflowEvents)
    .all()
    .map((event) => decodeEvent(event.payload))
    .filter((event) => event.type === 'NoteSectionTitleRequested');
}
