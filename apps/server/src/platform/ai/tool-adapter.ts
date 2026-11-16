/** @file Builds native Effect toolkits for feature tools and their durable JSON receipts. */

import type { agentUpdateSchema } from '@study/contracts';
import { StudyError } from '@study/contracts';
import { Cause, Effect, Exit, Fiber, Option, Schema } from 'effect';
import { Tool, Toolkit } from 'effect/ai';
import { WorkflowEngine } from 'effect/workflow';

import { ProcedureTraceScope, traceDetail } from '#server/platform/ai/trace';
import type { AgentEnvironment, AgentTool } from '#server/platform/definitions/define-agent';

/** Native handlers retain caller services and cancellation without leaving Effect. */
export function makeAgentToolkit<Requirements>(
  availableTools: readonly (readonly [
    string,
    AgentTool<Schema.ConstraintDecoder<unknown>, unknown, Requirements>
  ])[],
  environment: AgentEnvironment,
  emit: (event: typeof agentUpdateSchema.Type) => Effect.Effect<void, StudyError>,
  providerTools: readonly Tool.Any[] = []
): Effect.Effect<Toolkit.WithHandler<Record<string, Tool.Any>>, never, Requirements> {
  return Effect.gen(function* () {
    // The native toolkit captures these services when registering its handlers.
    yield* Effect.context<Requirements>();
    const tools: Tool.Any[] = [...providerTools];
    const handlers: Record<
      string,
      (
        input: unknown,
        context: Toolkit.HandlerContext<Tool.Any>
      ) => Effect.Effect<unknown, StudyError, Requirements>
    > = {};

    for (const [name, definition] of availableTools) {
      tools.push(
        Tool.make(name, {
          description: definition.description,
          parameters: Schema.toEncoded(Schema.toCodecJson(definition.input)),
          success: Schema.toCodecJson(definition.output),
          failure: Schema.instanceOf(StudyError)
        })
      );
      handlers[name] = makeHandler(name, definition, environment, emit);
    }

    const toolkit = Toolkit.make(...tools);

    return yield* toolkit.pipe(Effect.provide(toolkit.toLayer(handlers)));
  });
}

function makeHandler<Requirements>(
  name: string,
  definition: AgentTool<Schema.ConstraintDecoder<unknown>, unknown, Requirements>,
  environment: AgentEnvironment,
  emit: (event: typeof agentUpdateSchema.Type) => Effect.Effect<void, StudyError>
) {
  let ordinal = 0;

  return (input: unknown, { toolCallId = crypto.randomUUID() }: Toolkit.HandlerContext<Tool.Any>) =>
    Effect.gen(function* () {
      const scope = yield* ProcedureTraceScope;
      const callOrdinal = ++ordinal;
      const identity = { toolCallId, toolName: name };

      const execution = Effect.gen(function* () {
        const jsonInput = yield* Schema.decodeUnknownEffect(Schema.Json)(input).pipe(
          Effect.mapError(
            (cause) => new StudyError('invalid_input', 'Invalid JSON tool input', { cause })
          )
        );
        const decoded = yield* Schema.decodeUnknownEffect(Schema.toCodecJson(definition.input))(
          input
        ).pipe(
          Effect.mapError(
            (cause) => new StudyError('invalid_input', 'Invalid tool input', { cause })
          )
        );
        const context = yield* Effect.context<Requirements>();

        yield* emit({ type: 'tool-start', ...identity, input: traceDetail(jsonInput) });

        const execute = Effect.suspend(() => {
          const actual = () =>
            definition.execute(decoded, environment).pipe(Effect.provideContext(context));

          return environment.executeTool
            ? environment.executeTool({ definition, input: decoded }, actual)
            : actual();
        }).pipe(
          Effect.flatMap(Schema.encodeUnknownEffect(Schema.toCodecJson(definition.output))),
          Effect.flatMap(Schema.decodeUnknownEffect(Schema.Json)),
          Effect.mapError((cause) =>
            cause instanceof StudyError
              ? cause
              : new StudyError('internal', 'Invalid tool result', { cause })
          )
        );
        const result = environment.runTool
          ? environment.runTool(
              {
                name,
                ordinal: callOrdinal,
                input: jsonInput,
                mutates: definition.mutates
              },
              execute
            )
          : execute;

        const json = yield* result;
        const value = yield* Schema.decodeUnknownEffect(Schema.toCodecJson(definition.output))(
          json
        ).pipe(
          Effect.mapError((error) =>
            error instanceof StudyError
              ? error
              : new StudyError('internal', 'Invalid tool result', { cause: error })
          )
        );

        return { value, json };
      }).pipe(
        Effect.onExit((exit) =>
          Exit.isFailure(exit)
            ? keepToolFailureProgress(
                emit({
                  type: 'tool-finish',
                  ...identity,
                  outcome: toolFailureKind(exit.cause) === 'cancelled' ? 'cancelled' : 'failure',
                  errorKind: toolFailureKind(exit.cause)
                }).pipe(Effect.ignore)
              )
            : Effect.void
        ),
        Effect.tap(({ json }) =>
          emit({
            type: 'tool-finish',
            ...identity,
            outcome: 'success',
            output: traceDetail(json)
          })
        ),
        Effect.provideService(ProcedureTraceScope, {
          ...scope,
          parentToolCallId: toolCallId,
          toolKey: `${name}:${callOrdinal}`
        }),
        Effect.withSpan('agent.tool')
      );

      // Isolate native workflow self-interruption so Toolkit can publish its queue failure.
      return (yield* execution.pipe(Effect.forkChild, Effect.flatMap(Fiber.join))).value;
    });
}

function toolFailureKind(cause: Cause.Cause<StudyError>) {
  if (Cause.hasInterruptsOnly(cause)) return 'cancelled' as const;

  const failure = Cause.findErrorOption(cause);

  return Option.isSome(failure) ? failure.value.kind : ('internal' as const);
}

/** Native retry suspension keeps a pending tool pending; cancellation has its own owner. */
function keepToolFailureProgress(report: Effect.Effect<void>) {
  return Effect.gen(function* () {
    const instance = yield* Effect.serviceOption(WorkflowEngine.WorkflowInstance);

    if (Option.isSome(instance) && instance.value.suspended) return;

    yield* report;
  });
}
