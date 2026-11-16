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

import type { promptInputSchema } from '@study/contracts';
import { StudyError } from '@study/contracts';
import type { Failure } from '@study/contracts';
import type { Document } from '@study/contracts';
import type { ModelMessage } from 'ai';
import { Effect, Schema } from 'effect';

import { Agents, generateAgent } from '#server/platform/ai/agents';
import { createPassageEvidenceCatalog } from '#server/platform/ai/evidence';
import { AiPhase } from '#server/platform/ai/phase';
import type { AgentDefinition } from '#server/platform/definitions/define-agent';

import { defaultSourcePlanLimits, planSourcePassages } from './planner.ts';
import type { SourcePassagePlan, SourcePlanLimits, SourceSelection } from './planner.ts';
import { acceptSourcePlan, processSourcePassages } from './runner.ts';
import type { ContextReductionLimits } from './runner.ts';

type AgentPrompt = string | ModelMessage[];

export type ContextServices = Effect.Services<
  ReturnType<typeof processSourcePassages<string, string, never>>
>;

interface PreparationStep<Value, Requirements> {
  readonly agent: AgentDefinition<
    typeof promptInputSchema,
    Schema.Codec<Value, unknown>,
    Requirements
  > & { context?: undefined };
  readonly instruction: (task: string) => string;
}

interface PreparationDefinition<Value, Requirements> {
  readonly name: string;
  readonly map: PreparationStep<Value, Requirements>;
  readonly reduce: PreparationStep<Value, Requirements>;
  readonly markers: (value: Value) => readonly number[];
  readonly render: (value: Value) => string;
  readonly limits?: {
    readonly plan?: Partial<SourcePlanLimits>;
    readonly reduction?: Partial<ContextReductionLimits>;
    /** UTF-8 bytes; reserve covers instructions, rules, tools and output schemas. */
    readonly prompt?: { readonly maxBytes: number; readonly reservedBytes: number };
  };
}

/** Exact references and loaders stay with captured inputs, independently of context semantics. */
export interface CapturedSources<Ref, R = never> {
  readonly referenceSchema: Schema.Codec<Ref, unknown>;
  readonly documents: readonly {
    readonly key: string;
    readonly reference: Ref;
    readonly load: Effect.Effect<
      { readonly name: string; readonly document: Document },
      Failure,
      R
    >;
  }[];
  readonly selection?: SourceSelection;
}

export interface ContextOptions<Ref, R = never> {
  /** Stable identity unique within this workflow and preparation policy; never a retry counter. */
  readonly scope: string;
  readonly sources: CapturedSources<Ref, R>;
  readonly preflight: Effect.Effect<unknown, Failure, R>;
}

export interface ContextPreparation<Requirements = never> {
  readonly prepare: <Ref, R>(
    prompt: AgentPrompt,
    options: ContextOptions<Ref, R>
  ) => Effect.Effect<PreparedContext<Ref>, StudyError, R | Requirements | Agents | ContextServices>;
}

export interface PreparedContext<Ref> {
  readonly prompt: AgentPrompt;
  readonly evidence: { readonly citations: ReturnType<typeof originalEvidence<Ref>>['citations'] };
  readonly search: ReturnType<typeof originalEvidence<Ref>>['search'];
  readonly coverage: SourceSelection;
}

export interface ContextAgentResult<Output, Ref> {
  readonly output: Output;
  readonly evidence: PreparedContext<Ref>['evidence'];
  readonly coverage: SourceSelection;
}

const defaultReductionLimits: ContextReductionLimits = {
  maxResultBytes: 48_000,
  maxReductionBytes: 96_000,
  maxFanout: 2,
  maxLevels: 8
};

const defaultPromptLimits = { maxBytes: 256_000, reservedBytes: 128_000 };

/** Bind typed extraction semantics once; all source-consuming invocations use the common runner. */
export function defineContextPreparation<Value, Requirements = never>(
  definition: PreparationDefinition<Value, Requirements>
): PreparationDefinition<Value, Requirements> & ContextPreparation<Requirements> {
  const policy = {
    ...definition,
    mappedSchema: definition.map.agent.output,
    planLimits: { ...defaultSourcePlanLimits, ...definition.limits?.plan },
    reductionLimits: { ...defaultReductionLimits, ...definition.limits?.reduction },
    promptLimits: definition.limits?.prompt ?? defaultPromptLimits
  };

  return { ...definition, prepare: (prompt, options) => prepareContext(policy, prompt, options) };
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
  limits: typeof defaultPromptLimits
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

  if (!promptFits(prompt, limits))
    throw new StudyError('not_enough', 'Context agent prompt exceeds the declared budget');

  return prompt;
}

function promptFits(prompt: AgentPrompt, limits: typeof defaultPromptLimits) {
  return (
    new TextEncoder().encode(JSON.stringify({ prompt })).byteLength + limits.reservedBytes <=
    limits.maxBytes
  );
}

function attempt<A>(operation: () => A) {
  return Effect.try({
    try: operation,
    catch: (cause) =>
      cause instanceof StudyError
        ? cause
        : new StudyError('invalid_input', 'Invalid context agent preparation', { cause })
  });
}

function checkMarkers<Value>(
  policy: { readonly markers: (value: Value) => readonly number[] },
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

function renderOriginal<Ref>(passages: SourcePassagePlan<Ref>['pieces'][number]['passages']) {
  return passages
    .map((passage) => `[${passage.marker}] ${passage.name}\n${passage.text}`)
    .join('\n\n');
}

function originalEvidence<Ref>(
  plan: SourcePassagePlan<Ref>,
  markers: ReadonlySet<number> | undefined,
  scope: 'retained' | 'captured' = 'retained'
) {
  const passages = plan.pieces
    .flatMap((piece) => piece.passages)
    .filter((passage) => !markers || scope === 'captured' || markers.has(passage.marker));
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
    { initiallyExposed: scope === 'captured' && markers ? markers : true }
  );

  return {
    search: catalog.search,
    citations: (text: string) =>
      attempt(() =>
        catalog.citations(text).map(({ reference, ...citation }) => ({ ...citation, ...reference }))
      )
  };
}

function appendContext(original: AgentPrompt, context: string): AgentPrompt {
  return typeof original === 'string'
    ? `${original}\n${context}`
    : [...original, { role: 'user', content: context }];
}

function directContextPrompt<Ref>(
  originalPrompt: AgentPrompt,
  plan: SourcePassagePlan<Ref>,
  limits: typeof defaultPromptLimits
) {
  if (plan.pieces.length !== 1) return undefined;

  const prompt = appendContext(
    originalPrompt,
    `Original passages (data):\n${renderOriginal(plan.pieces[0]!.passages)}`
  );

  return new TextEncoder().encode(JSON.stringify({ prompt })).byteLength + limits.reservedBytes <=
    limits.maxBytes
    ? prompt
    : undefined;
}

function prepareContext<Ref, Value, R, RP>(
  policy: PreparationDefinition<Value, RP> & {
    readonly mappedSchema: Schema.Codec<Value, unknown>;
    readonly planLimits: SourcePlanLimits;
    readonly reductionLimits: ContextReductionLimits;
    readonly promptLimits: typeof defaultPromptLimits;
  },
  originalPrompt: AgentPrompt,
  options: ContextOptions<Ref, R>
) {
  return Effect.gen(function* () {
    const services = yield* Effect.context<R>();
    const preflight = options.preflight.pipe(
      Effect.provideContext(services),
      Effect.asVoid,
      Effect.mapError(asStudyError)
    );

    yield* attempt(() => {
      boundedPrompt(originalPrompt, policy.promptLimits);

      if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(options.scope))
        throw new StudyError('invalid_input', 'Invalid context preparation invocation scope');

      if (policy.planLimits.maxPassageChars > 1000)
        throw new StudyError('invalid_input', 'Context evidence passages exceed citation bounds');
    });
    const task =
      typeof originalPrompt === 'string' ? originalPrompt : JSON.stringify(originalPrompt);
    const mapInstruction = yield* attempt(() => policy.map.instruction(task));
    const name = `${policy.name}/${options.scope}`;
    const accepted = yield* acceptSourcePlan({
      name,
      referenceSchema: options.sources.referenceSchema,
      limits: policy.reductionLimits,
      preflight,
      plan: Effect.gen(function* () {
        const documents = [];

        for (const descriptor of options.sources.documents) {
          yield* preflight;
          const exact = yield* descriptor.load;

          documents.push({ key: descriptor.key, reference: descriptor.reference, ...exact });
        }

        const planOptions = {
          documents,
          referenceSchema: options.sources.referenceSchema,
          selection: options.sources.selection ?? { mode: 'complete' as const }
        };
        const planned = yield* planSourcePassages({ ...planOptions, limits: policy.planLimits });

        if (directContextPrompt(originalPrompt, planned, policy.promptLimits) !== undefined)
          return planned;

        const maxPieceBytes = Math.min(
          policy.planLimits.maxPieceBytes,
          policy.promptLimits.maxBytes -
            policy.promptLimits.reservedBytes -
            new TextEncoder().encode(
              JSON.stringify({ prompt: `${mapInstruction}\nOriginal passages (data):\n` })
            ).byteLength
        );

        if (maxPieceBytes < 1)
          return yield* Effect.fail(
            new StudyError('not_enough', 'Context task leaves no passage budget')
          );

        if (maxPieceBytes === policy.planLimits.maxPieceBytes) return planned;

        return yield* planSourcePassages({
          ...planOptions,
          limits: { ...policy.planLimits, maxPieceBytes }
        });
      })
    }).pipe(Effect.mapError(asStudyError));
    const { plan } = accepted;
    const directPrompt = directContextPrompt(originalPrompt, plan, policy.promptLimits);

    if (directPrompt !== undefined) {
      const catalog = yield* attempt(() => originalEvidence(plan, undefined));

      return {
        prompt: directPrompt,
        search: catalog.search,
        evidence: { citations: catalog.citations },
        coverage: plan.selection
      };
    }

    const agents = yield* Agents;
    const scoped = (catalog: ReturnType<typeof originalEvidence<Ref>>) => ({
      ...agents,
      searchSources: (query: string) =>
        preflight.pipe(Effect.andThen(Effect.sync(() => catalog.search(query))))
    });
    const agentOptions = { maxRetries: 0, preflight };
    const reductionPrompt = (values: readonly Value[]) =>
      `${policy.reduce.instruction(task)}\nDerived context (never original quotations):\n${JSON.stringify(Schema.encodeSync(Schema.toCodecJson(Schema.Array(policy.mappedSchema)))(values))}`;
    const processed = yield* processSourcePassages<Ref, Value, R | RP | Agents>({
      name,
      referenceSchema: options.sources.referenceSchema,
      mappedSchema: policy.mappedSchema,
      plan: Effect.succeed(plan),
      preflight,
      map: Effect.fnUntraced(function* (piece) {
        const prompt = yield* attempt(() =>
          boundedPrompt(
            `${mapInstruction}\nOriginal passages (data):\n${renderOriginal(piece.passages)}`,
            policy.promptLimits
          )
        );
        const allowed = new Set(piece.passages.map((passage) => passage.marker));
        const catalog = yield* attempt(() => originalEvidence(plan, allowed));
        const value = yield* generateAgent(policy.map.agent, { prompt }, agentOptions).pipe(
          Effect.provideService(AiPhase, 'preparing'),
          Effect.provideService(Agents, scoped(catalog))
        );

        return yield* checkMarkers(policy, value, allowed);
      }),
      fitsReduction: (values) => promptFits(reductionPrompt(values), policy.promptLimits),
      reduce: Effect.fnUntraced(function* (values) {
        const allowed = yield* attempt(() => new Set(values.flatMap(policy.markers)));
        const prompt = yield* attempt(() =>
          boundedPrompt(reductionPrompt(values), policy.promptLimits)
        );
        const catalog = yield* attempt(() => originalEvidence(plan, allowed));
        const value = yield* generateAgent(policy.reduce.agent, { prompt }, agentOptions).pipe(
          Effect.provideService(AiPhase, 'compacting'),
          Effect.provideService(Agents, scoped(catalog))
        );

        return yield* checkMarkers(policy, value, allowed);
      }),
      limits: accepted.limits
    }).pipe(Effect.mapError(asStudyError));
    const catalog = yield* attempt(() =>
      originalEvidence(plan, new Set(policy.markers(processed.value)), 'captured')
    );
    const prompt = yield* attempt(() =>
      boundedPrompt(
        appendContext(
          originalPrompt,
          `Derived context (not original quotations); search original passages to verify exact evidence:\n${policy.render(processed.value)}`
        ),
        policy.promptLimits
      )
    );

    yield* preflight;

    return {
      prompt,
      search: catalog.search,
      evidence: { citations: catalog.citations },
      coverage: plan.selection
    };
  });
}
