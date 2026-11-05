import type { ProjectId } from '@study/contracts/ids';
import type { UseQueryOptions, QueryFunction, QueryKey } from '@tanstack/react-query';
import { Option, Schema } from 'effect';

import type { PageMetadata } from './route-contract';

export type SidebarContent = 'workspace' | 'documents' | 'library' | 'practice';
export type SidebarRouteParams = Record<string, string | bigint | undefined>;
type OwnedItem = { projectIds: readonly ProjectId[] };

/** Routes provide their canonical owner query; the shell only consumes membership. */
export type SidebarRouteConfig = {
  content?: SidebarContent;
  owner?: (
    params: SidebarRouteParams
  ) => Pick<UseQueryOptions<OwnedItem>, 'queryKey' | 'queryFn'> | undefined;
};

const sectionContent: Record<PageMetadata['section'], SidebarContent> = {
  sessions: 'workspace',
  documents: 'documents',
  pipelines: 'workspace',
  library: 'library',
  practice: 'practice'
};

export function sidebarContent(metadata: PageMetadata): SidebarContent {
  return metadata.sidebar?.content ?? sectionContent[metadata.section];
}

/** Adapts a canonical query's key type without copying its data contract or cache. */
function ownerQuery<T extends OwnedItem, K extends QueryKey>(options: {
  queryKey: K;
  queryFn?: QueryFunction<T, K>;
}): Pick<UseQueryOptions<OwnedItem>, 'queryKey' | 'queryFn'> {
  const run = options.queryFn;
  return {
    queryKey: options.queryKey,
    queryFn: run ? (context) => run({ ...context, queryKey: options.queryKey }) : undefined
  };
}

/** Resolve only valid canonical identities, including while the router rejects a raw URL. */
export function sidebarOwner<
  S extends Schema.ConstraintDecoder<unknown>,
  T extends OwnedItem,
  K extends QueryKey
>(
  schema: S,
  select: (params: SidebarRouteParams) => unknown,
  options: (id: S['Type']) => { queryKey: K; queryFn?: QueryFunction<T, K> }
): NonNullable<SidebarRouteConfig['owner']> {
  const decode = Schema.decodeUnknownOption(schema);
  const integer = Schema.decodeUnknownOption(Schema.BigIntFromString);
  return (params) => {
    const input = select(params);
    const id = Option.flatMap(
      typeof input === 'string' ? integer(input) : Option.some(input),
      decode
    );
    return Option.isSome(id) ? ownerQuery(options(id.value)) : undefined;
  };
}

const contentRoutes = {
  workspace: '/sessions',
  documents: '/documents',
  library: '/library',
  practice: '/practice'
} as const;

export function sidebarIndex(metadata: PageMetadata) {
  return contentRoutes[sidebarContent(metadata)];
}
