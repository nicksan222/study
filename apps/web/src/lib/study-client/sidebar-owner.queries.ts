import type { ProjectId } from '@study/contracts/ids';
import type { UseQueryOptions, QueryFunction, QueryKey } from '@tanstack/react-query';
import { Schema } from 'effect';

type OwnedItem = { projectIds: readonly ProjectId[] };

type RouteParams = Record<string, string | bigint | undefined>;

type OwnerOptions = Pick<UseQueryOptions<OwnedItem>, 'queryKey' | 'queryFn'>;

export type SidebarOwnerResolver = (params: RouteParams) => OwnerOptions | undefined;

/** Preserve the canonical cache and adapt only the query key's static type. */
function ownerQuery<T extends OwnedItem, K extends QueryKey>(options: {
  queryKey: K;
  queryFn?: QueryFunction<T, K>;
}): OwnerOptions {
  const run = options.queryFn;

  return {
    queryKey: options.queryKey,
    queryFn: run ? (context) => run({ ...context, queryKey: options.queryKey }) : undefined
  };
}

function routeIdentity<S extends Schema.ConstraintDecoder<unknown>>(schema: S, value: unknown) {
  let input = value;

  if (typeof input === 'string') {
    const integer = Schema.decodeUnknownOption(Schema.BigIntFromString)(input);

    if (integer._tag === 'None') return undefined;

    input = integer.value;
  }

  const id = Schema.decodeUnknownOption(schema)(input);

  return id._tag === 'Some' ? id.value : undefined;
}

/** Invalid raw URLs never start owner queries or interrupt the router's recovery. */
export function sidebarOwner<
  S extends Schema.ConstraintDecoder<unknown>,
  T extends OwnedItem,
  K extends QueryKey
>(
  schema: S,
  select: (params: RouteParams) => unknown,
  options: (id: S['Type']) => { queryKey: K; queryFn?: QueryFunction<T, K> }
): SidebarOwnerResolver {
  return (params) => {
    const id = routeIdentity(schema, select(params));

    return id === undefined ? undefined : ownerQuery(options(id));
  };
}
