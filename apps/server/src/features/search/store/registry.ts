/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Provides typed semantic retrieval and registry integration for local application   │
 * │ content.                                                                                 │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Preserves entity identities and keeps retrieval bounded and scoped.                    │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Feature projections own visibility while injected embedding capabilities provide local   │
 * │ inference.                                                                               │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts/errors';
import { projectIdSchema } from '@study/contracts/ids';
import type {
  SearchProjection,
  SearchProjectionPageInput,
  SearchTarget
} from '@study/contracts/search/schemas';
import {
  searchProjectionPageInputSchema,
  searchProjectionPageSchema,
  registeredEntityKeySchema
} from '@study/contracts/search/schemas';
import { collectSchemaRegistry, getTableColumns, asc, and, eq, isNull, sql } from '@study/db';
import type { RegisteredEntity } from '@study/db';
import * as databaseSchema from '@study/db/schema';
import { Schema } from 'effect';

import { defineStore, storeQuery } from '#server/platform/definitions/define-store';
import type { StoreResources } from '#server/platform/definitions/define-store';

const featureKinds = new Set([
  'project',
  'session',
  'message',
  'source',
  'passage',
  'material',
  'document',
  'question'
]);

/** Encode only scalar stable identities and reject unsafe numeric or structured values. */
function identity(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'bigint') return String(value);

  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);

  throw new StudyError('internal', 'Searchable entity identity is invalid');
}

/** Derive canonical content and project scope from the table’s explicit column policy. */
function rowProjection(entity: RegisteredEntity, row: Record<string, unknown>): SearchProjection {
  const meta = entity.metadata;

  if (meta.projection !== 'columns')
    throw new StudyError('config', 'Entity requires a feature projection');

  const text = meta.textColumns
    .map((column) => row[column])
    .filter((value) => typeof value === 'string')
    .join('\n');
  const project = meta.scope.type === 'project' ? row[meta.scope.column] : null;

  return {
    target: {
      type: 'registered',
      entity: meta.kind,
      key: Schema.decodeUnknownSync(registeredEntityKeySchema)(identity(row[meta.idColumn ?? 'id']))
    },
    title:
      typeof row[meta.textColumns[0]!] === 'string'
        ? String(row[meta.textColumns[0]!])
        : meta.description,
    text,
    projectIds:
      project === null
        ? []
        : [Schema.decodeUnknownSync(projectIdSchema)(BigInt(identity(project)))],
    revision: text
  };
}

/** Translate declared archive, deletion, and publication rules into SQL predicates. */
function visibility(entity: RegisteredEntity) {
  const meta = entity.metadata;

  if (meta.projection !== 'columns' || meta.visibility === 'all') return undefined;

  const columns = getTableColumns(entity.table);
  const policy = meta.visibility;

  return and(
    policy.archivedColumn ? isNull(columns[policy.archivedColumn]!) : undefined,
    policy.deletedColumn ? isNull(columns[policy.deletedColumn]!) : undefined,
    policy.publishedColumn ? eq(columns[policy.publishedColumn]!, policy.publishedValue) : undefined
  );
}

/** Select registered target keys only for the requested entity kind during publication checks. */
function targetKeys(
  targets: readonly SearchTarget[] | undefined,
  kind: string
): readonly string[] | undefined {
  return targets?.flatMap((target) =>
    target.type === 'registered' && target.entity === kind ? [target.key] : []
  );
}

/** Read a deterministic SQL page with declared visibility and optional exact target filtering. */
function makeRegistrySearchProjections({ db }: StoreResources) {
  return (
    entity: RegisteredEntity,
    input: SearchProjectionPageInput
  ): readonly SearchProjection[] => {
    const meta = entity.metadata;

    if (meta.projection !== 'columns')
      throw new StudyError('config', 'Entity requires a feature projection');

    const keys = targetKeys(input.targets, meta.kind);

    if (keys && !keys.length) return [];

    const id = getTableColumns(entity.table)[meta.idColumn ?? 'id']!;
    const selected = keys
      ? sql`${id} IN (${sql.join(
          keys.map((key) => sql`${key}`),
          sql`,`
        )})`
      : undefined;

    return db.orm
      .select()
      .from(entity.table)
      .where(and(visibility(entity), selected))
      .orderBy(asc(id))
      .limit(input.limit)
      .offset(input.offset)
      .all()
      .map((row) => rowProjection(entity, row));
  };
}

/** Build the agent catalog and automatic projection store from the validated Drizzle registry. */
export function makeRegistryStore(schema: Readonly<Record<string, unknown>> = databaseSchema) {
  const registry = collectSchemaRegistry(schema);

  for (const { metadata } of registry.entities) {
    if (metadata.projection === 'feature' && !featureKinds.has(metadata.kind))
      throw new StudyError('config', `Missing feature projection for ${metadata.kind}`);
  }

  const store = defineStore({
    name: 'SearchRegistryStore',
    entity: { singular: 'searchProjectionPage', plural: 'searchProjectionPages' },
    make: (resources) => {
      const read = makeRegistrySearchProjections(resources);

      return {
        queries: {
          searchProjectionPages: storeQuery({
            role: 'collection',
            input: searchProjectionPageInputSchema,
            output: searchProjectionPageSchema,
            run: (input) => {
              const entity = registry.entities.find(
                (entry) =>
                  entry.metadata.kind === input.kind && entry.metadata.projection === 'columns'
              );

              if (!entity) return { items: [], next: null };

              const rows = read(entity, { ...input, limit: input.limit + 1 });

              return {
                items: rows.slice(0, input.limit),
                next: rows.length > input.limit ? input.offset + input.limit : null
              };
            }
          })
        },
        mutations: {}
      };
    }
  });
  const catalog = registry.entities.map(({ metadata }) => ({
    kind: metadata.kind,
    description: metadata.description,
    filters:
      metadata.projection === 'feature' || metadata.scope.type === 'project'
        ? (['kind', 'project'] as const)
        : (['kind'] as const),
    citations: metadata.kind === 'passage' || metadata.kind === 'document'
  }));

  return { store, catalog };
}
