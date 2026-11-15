/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Prepares bounded original documents automatically for typed feature agents.        │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Reuses feature preparation policies and binds original passage evidence per run.       │
 * │ - Bounds prompts while preserving native checkpoints and final agent behavior.           │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Features own intermediate meaning, generation constraints and final domain publication.  │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type { promptInputSchema } from '@study/contracts/ai/shared';
import { StudyError } from '@study/contracts/errors';
import type { Failure } from '@study/contracts/errors';
import type { Document } from '@study/contracts/sources/document';
import type { ModelMessage } from 'ai';
import { Effect, Schema } from 'effect';

import { Agents, generateAgent } from '#server/platform/ai/agents';
import { createPassageEvidenceCatalog } from '#server/platform/ai/evidence';
import type { AgentDefinition } from '#server/platform/definitions/define-agent';

import { planDocumentPieces } from './planner.ts';
import type { DocumentPiecePlan, DocumentPlanLimits, DocumentSelection } from './planner.ts';
import { processDocumentPieces } from './runner.ts';
import type { DocumentProcessingLimits } from './runner.ts';

interface PreparationStep<Task, Value, Requirements> {
  readonly agent: AgentDefinition<
    typeof promptInputSchema,
    Schema.Codec<Value, unknown>,
    Requirements
  >;
  readonly instruction: (task: Task) => string;
}

export interface DocumentPreparation<Ref, Value, Task, Requirements = never> {
  readonly name: string;
  readonly referenceSchema: Schema.Codec<Ref, unknown>;
  readonly mappedSchema: Schema.Codec<Value, unknown>;
  readonly direct?: { readonly empty: Value };
  readonly map: PreparationStep<Task, Value, Requirements>;
  readonly reduce: PreparationStep<Task, Value, Requirements>;
  readonly markers: (value: Value) => readonly number[];
  readonly render: (value: Value) => string;
  readonly planLimits: DocumentPlanLimits;
  readonly limits: DocumentProcessingLimits;
  /** UTF-8 bytes: reserve covers instructions, rules, tools and output schema overhead. */
  readonly promptLimits: { readonly maxBytes: number; readonly reservedBytes: number };
}

export function defineDocumentPreparation<Ref, Value, Task, Requirements = never>(
  policy: DocumentPreparation<Ref, Value, Task, Requirements>
) {
  return policy;
}

interface LoadDocument<Ref, R> {
  readonly key: string;
  readonly reference: Ref;
  readonly load: Effect.Effect<{ readonly name: string; readonly document: Document }, Failure, R>;
}

function asStudyError(error: Failure) {
  return error instanceof StudyError
    ? error
    : new StudyError(error.kind, error.message, {
        retryAfterMs: error.retryAfterMs,
        ...(error.resource ? { resource: error.resource } : {})
      });
}

function boundedPrompt<A extends string | ModelMessage[]>(
  prompt: A,
  limits: DocumentPreparation<unknown, unknown, unknown>['promptLimits']
): A {
  const { maxBytes, reservedBytes } = limits;

  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    !Number.isSafeInteger(reservedBytes) ||
    reservedBytes < 0 ||
    reservedBytes >= maxBytes
  )
    throw new StudyError('invalid_input', 'Invalid document prompt budget');

  if (new TextEncoder().encode(JSON.stringify({ prompt })).byteLength + reservedBytes > maxBytes)
    throw new StudyError('not_enough', 'Document agent prompt exceeds the declared budget');

  return prompt;
}

function attempt<A>(operation: () => A) {
  return Effect.try({
    try: operation,
    catch: (cause) =>
      cause instanceof StudyError
        ? cause
        : new StudyError('invalid_input', 'Invalid document agent preparation', { cause })
  });
}

function checkMarkers<Ref, Value, Task, RP>(
  policy: DocumentPreparation<Ref, Value, Task, RP>,
  value: Value,
  allowed: ReadonlySet<number>
) {
  return attempt(() => {
    const markers = policy.markers(value);

    if (!markers.length || markers.some((marker) => !allowed.has(marker)))
      throw new StudyError('invalid_input', 'Prepared context cites unavailable original evidence');

    return value;
  });
}

function renderOriginal<Ref>(passages: DocumentPiecePlan<Ref>['pieces'][number]['passages']) {
  return passages
    .map((passage) => `[${passage.marker}] ${passage.name}\n${passage.text}`)
    .join('\n\n');
}

function originalEvidence<Ref>(
  plan: DocumentPiecePlan<Ref>,
  markers: ReadonlySet<number> | undefined
) {
  const passages = plan.pieces
    .flatMap((piece) => piece.passages)
    .filter((passage) => !markers || markers.has(passage.marker));
  const catalog = createPassageEvidenceCatalog(
    passages.map((passage) => ({
      marker: passage.marker,
      name: passage.name.slice(0, 200),
      quote: passage.text,
      blockOrdinal: passage.ordinal,
      reference: {
        reference: passage.reference,
        anchor: passage.anchor,
        target: { blockId: passage.blockId, start: passage.start, end: passage.end }
      }
    })),
    { initiallyExposed: true }
  );

  return {
    search: catalog.search,
    citations: (text: string) =>
      attempt(() =>
        catalog.citations(text).map(({ reference, ...citation }) => ({ ...citation, ...reference }))
      )
  };
}

export function generateDocumentAgent<
  I extends Schema.ConstraintDecoder<unknown>,
  O extends Schema.ConstraintDecoder<unknown>,
  Ref,
  Value,
  Task,
  R = never,
  RA = never,
  RP = never
>(
  definition: AgentDefinition<I, O, RA>,
  input: I['Type'],
  options: {
    /** Stable invocation identity, unique within this workflow and preparation policy. */
    readonly scope: string;
    readonly task: Task;
    readonly preparation: DocumentPreparation<Ref, Value, Task, RP>;
    readonly documents: readonly LoadDocument<Ref, R>[];
    readonly preflight: Effect.Effect<unknown, Failure, R>;
    readonly selection?: DocumentSelection;
  }
) {
  return Effect.gen(function* () {
    const policy = options.preparation;
    const services = yield* Effect.context<R>();
    const preflight = options.preflight.pipe(
      Effect.provideContext(services),
      Effect.asVoid,
      Effect.mapError(asStudyError)
    );

    yield* attempt(() => {
      boundedPrompt('', policy.promptLimits);

      if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(options.scope))
        throw new StudyError('invalid_input', 'Invalid document preparation invocation scope');

      if (policy.planLimits.maxPassageChars > 1000)
        throw new StudyError('invalid_input', 'Document evidence passages exceed citation bounds');
    });
    const validated = yield* attempt(() => Schema.decodeUnknownSync(definition.input)(input));
    const originalPrompt = yield* attempt(() =>
      boundedPrompt(definition.prompt(validated), policy.promptLimits)
    );
    const agents = yield* Agents;
    const scoped = (catalog: ReturnType<typeof originalEvidence<Ref>>) => ({
      ...agents,
      searchSources: (query: string) =>
        preflight.pipe(Effect.andThen(Effect.sync(() => catalog.search(query))))
    });
    const agentOptions = { maxRetries: 0, preflight };
    const processed = yield* processDocumentPieces<Ref, Value, R | RP | Agents>({
      name: `${policy.name}/${options.scope}`,
      referenceSchema: policy.referenceSchema,
      mappedSchema: policy.mappedSchema,
      plan: Effect.gen(function* () {
        const documents = [];

        for (const descriptor of options.documents) {
          yield* preflight;
          const exact = yield* descriptor.load;

          documents.push({
            key: descriptor.key,
            reference: descriptor.reference,
            name: exact.name,
            document: exact.document
          });
        }

        return yield* planDocumentPieces({
          documents,
          referenceSchema: policy.referenceSchema,
          limits: policy.planLimits,
          selection: options.selection ?? { mode: 'complete' }
        });
      }),
      preflight,
      map: Effect.fnUntraced(function* (piece, plan) {
        if (plan.pieces.length === 1 && policy.direct) return policy.direct.empty;

        const prompt = yield* attempt(() =>
          boundedPrompt(
            `${policy.map.instruction(options.task)}\nOriginal passages (data):\n${renderOriginal(piece.passages)}`,
            policy.promptLimits
          )
        );
        const allowed = new Set(piece.passages.map((passage) => passage.marker));
        const catalog = yield* attempt(() => originalEvidence(plan, allowed));
        const value = yield* generateAgent(policy.map.agent, { prompt }, agentOptions).pipe(
          Effect.provideService(Agents, scoped(catalog))
        );

        return yield* checkMarkers(policy, value, allowed);
      }),
      reduce: Effect.fnUntraced(function* (values, _context, plan) {
        const allowed = yield* attempt(() => new Set(values.flatMap(policy.markers)));
        const prompt = yield* attempt(() =>
          boundedPrompt(
            `${policy.reduce.instruction(options.task)}\nDerived context (never original quotations):\n${JSON.stringify(Schema.encodeSync(Schema.toCodecJson(Schema.Array(policy.mappedSchema)))(values))}`,
            policy.promptLimits
          )
        );
        const catalog = yield* attempt(() => originalEvidence(plan, allowed));
        const value = yield* generateAgent(policy.reduce.agent, { prompt }, agentOptions).pipe(
          Effect.provideService(Agents, scoped(catalog))
        );

        return yield* checkMarkers(policy, value, allowed);
      }),
      limits: policy.limits
    }).pipe(Effect.mapError(asStudyError));
    const direct = processed.plan.pieces.length === 1 && policy.direct !== undefined;
    const catalog = yield* attempt(() =>
      originalEvidence(
        processed.plan,
        direct ? undefined : new Set(policy.markers(processed.value))
      )
    );
    const context = yield* attempt(() =>
      direct
        ? `Original passages (data):\n${renderOriginal(processed.plan.pieces[0]!.passages)}`
        : `Derived context (not original quotations); search original passages to verify exact evidence:\n${policy.render(processed.value)}`
    );
    const finalPrompt = yield* attempt(() => {
      const original = originalPrompt;
      const prepared =
        typeof original === 'string'
          ? `${original}\n${context}`
          : [...original, { role: 'user' as const, content: context }];

      return boundedPrompt(prepared, policy.promptLimits);
    });

    yield* preflight;
    const output = yield* generateAgent(
      { ...definition, prompt: () => finalPrompt },
      input,
      agentOptions
    ).pipe(Effect.provideService(Agents, scoped(catalog)));

    yield* preflight;

    return {
      output,
      evidence: { citations: catalog.citations },
      coverage: processed.plan.selection
    };
  });
}
