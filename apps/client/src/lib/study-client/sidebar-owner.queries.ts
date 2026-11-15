import { Schema } from 'effect';

type RouteParams = Record<string, string | bigint | undefined>;

export type SidebarOwnerKind = 'note' | 'page' | 'material';

export type SidebarOwnerResolver = (
  params: RouteParams
) => { kind: SidebarOwnerKind; id: bigint } | undefined;

/** Route identity is validated before a mounted canonical owner read is enabled. */
export function sidebarOwner<S extends Schema.ConstraintDecoder<bigint>>(
  schema: S,
  select: (params: RouteParams) => unknown,
  kind: SidebarOwnerKind
): SidebarOwnerResolver {
  return (params) => {
    const value = select(params);
    const parsed =
      typeof value === 'string'
        ? Schema.decodeUnknownOption(Schema.BigIntFromString)(value)
        : undefined;
    const decoded = Schema.decodeUnknownOption(schema)(
      parsed?._tag === 'Some' ? parsed.value : value
    );

    return decoded._tag === 'Some' ? { kind, id: decoded.value } : undefined;
  };
}
