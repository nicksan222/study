/** Canonical endpoint classification and bounded database dependency declarations. */
import { Context, Schema } from 'effect';
import { Rpc, RpcGroup } from 'effect/rpc';

export const dependency = {
  sources: 'sources',
  materials: 'materials',
  pages: 'pages',
  projects: 'projects',
  notes: 'notes',
  learning: 'learning',
  recordings: 'recordings',
  settings: 'settings',
  auth: 'auth',
  themes: 'themes',
  system: 'system',
  integrations: 'integrations',
  workflows: 'workflows'
} as const;

export const allDependencies = [
  dependency.sources,
  dependency.materials,
  dependency.pages,
  dependency.projects,
  dependency.notes,
  dependency.learning,
  dependency.recordings,
  dependency.settings,
  dependency.auth,
  dependency.themes,
  dependency.system,
  dependency.integrations,
  dependency.workflows
] as const;

export type DependencyScope = (typeof dependency)[keyof typeof dependency];

const endpointBrand = Symbol('EndpointDefinition');

const dependencyScopeSchema = Schema.Literals(allDependencies);

const dependencySetSchema = Schema.NonEmptyArray(dependencyScopeSchema);

const queryPolicySchema = Schema.Struct({
  dependencies: dependencySetSchema,
  refresh: Schema.Literals(['database', 'external'])
});

const mutationPolicySchema = Schema.Union([
  Schema.Struct({ changes: dependencySetSchema }),
  Schema.Struct({ changes: Schema.Literal('external') })
]);

const policySchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('query'), ...queryPolicySchema.fields }),
  Schema.Struct({
    kind: Schema.Literal('mutation'),
    changes: Schema.Union([dependencySetSchema, Schema.Literal('external')])
  }),
  Schema.Struct({ kind: Schema.Literal('event') })
]);

export type QueryPolicy = typeof queryPolicySchema.Type;

export type MutationPolicy = typeof mutationPolicySchema.Type;

export type Policy = typeof policySchema.Type;

export const EndpointPolicy = Context.Service<never, Policy>('study/EndpointPolicy');

interface EndpointSchemas<
  P extends Schema.Top | Schema.Struct.Fields,
  S extends Schema.Top,
  E extends Schema.Top
> {
  readonly payload: P;
  readonly success: S;
  readonly error: E;
}

/** Heartbeats establish transport liveness without pretending an old snapshot became fresh. */
export type LiveFrame<A, E> = ReturnType<
  typeof liveFrameSchema<Schema.Schema<A>, Schema.Schema<E>>
>['Type'];

export function liveFrameSchema<A extends Schema.Top, E extends Schema.Top>(success: A, error: E) {
  return Schema.Union([
    Schema.TaggedStruct('Snapshot', { result: Schema.Result(success, error) }),
    Schema.TaggedStruct('Heartbeat', {}),
    Schema.TaggedStruct('Refreshing', {})
  ]);
}

export function liveQuery<
  const T extends string,
  P extends Schema.Top | Schema.Struct.Fields,
  S extends Schema.Top,
  E extends Schema.Top
>(tag: T, schemas: EndpointSchemas<P, S, E>, policy: QueryPolicy) {
  const rpc = Rpc.make(tag, {
    payload: schemas.payload,
    success: schemas.success,
    error: schemas.error
  }).annotate(EndpointPolicy, { kind: 'query', ...policy });
  const liveRpc = Rpc.make(`${tag}.live`, {
    payload: schemas.payload,
    success: liveFrameSchema(schemas.success, schemas.error),
    error: schemas.error,
    stream: true
  }).annotate(EndpointPolicy, {
    kind: 'query',
    ...policy
  });

  return {
    [endpointBrand]: true as const,
    kind: 'query' as const,
    rpc,
    liveRpc,
    successSchema: schemas.success,
    errorSchema: schemas.error,
    policy
  };
}

export function mutation<
  const T extends string,
  P extends Schema.Top | Schema.Struct.Fields,
  S extends Schema.Top,
  E extends Schema.Top
>(tag: T, schemas: EndpointSchemas<P, S, E>, policy: MutationPolicy) {
  const rpc = Rpc.make(tag, {
    payload: schemas.payload,
    success: schemas.success,
    error: schemas.error
  }).annotate(EndpointPolicy, { kind: 'mutation', ...policy });

  return {
    [endpointBrand]: true as const,
    kind: 'mutation' as const,
    rpc,
    successSchema: schemas.success,
    errorSchema: schemas.error,
    policy
  };
}

export function eventStream<
  const T extends string,
  P extends Schema.Top | Schema.Struct.Fields,
  S extends Schema.Top,
  E extends Schema.Top
>(tag: T, schemas: EndpointSchemas<P, S, E>) {
  const rpc = Rpc.make(tag, {
    payload: schemas.payload,
    success: schemas.success,
    error: schemas.error,
    stream: true
  }).annotate(EndpointPolicy, {
    kind: 'event'
  });

  return {
    [endpointBrand]: true as const,
    kind: 'event' as const,
    rpc,
    successSchema: schemas.success,
    errorSchema: schemas.error
  };
}

type EndpointDefinition = {
  readonly [endpointBrand]: true;
  readonly rpc: Rpc.Any;
  readonly liveRpc?: Rpc.Any;
};

type EndpointRpcs<E extends EndpointDefinition> =
  | E['rpc']
  | (E extends { readonly liveRpc: infer R extends Rpc.Any } ? R : never);

export function endpointGroup<const E extends Readonly<Record<string, EndpointDefinition>>>(
  endpoints: E
): RpcGroup.RpcGroup<EndpointRpcs<E[keyof E]>> {
  // Object.values erases the correlation with E; constructors supply exactly these RPCs.
  return RpcGroup.make(
    ...Object.values(endpoints).flatMap((endpoint) =>
      endpoint.liveRpc ? [endpoint.rpc, endpoint.liveRpc] : [endpoint.rpc]
    )
  ) as RpcGroup.RpcGroup<EndpointRpcs<E[keyof E]>>;
}
