import { getTableColumns, getTableName, is } from 'drizzle-orm';
import { SQLiteTable, sqliteTable, getTableConfig } from 'drizzle-orm/sqlite-core';

/** Declarative search participation; feature services own visibility and content projection. */
type ColumnSearchVisibility =
  | 'all'
  | ({
      readonly archivedColumn?: string;
      readonly deletedColumn?: string;
    } & (
      | { readonly publishedColumn: string; readonly publishedValue: string }
      | { readonly publishedColumn?: never; readonly publishedValue?: never }
    ));

type EntityTableMetadata = {
  readonly role: 'entity';
  readonly kind: string;
  readonly description: string;
  readonly idColumn?: string;
} & (
  | { readonly projection: 'feature'; readonly textColumns?: readonly string[] }
  | {
      readonly projection: 'columns';
      readonly textColumns: readonly string[];
      readonly scope:
        | { readonly type: 'global' }
        | { readonly type: 'project'; readonly column: string };
      readonly visibility: ColumnSearchVisibility;
    }
);

type TableSearchMetadata =
  | EntityTableMetadata
  | { readonly role: 'contributes'; readonly entity: string }
  | { readonly role: 'internal'; readonly reason: string };

interface RegisteredTable {
  readonly name: string;
  readonly table: SQLiteTable;
  readonly metadata: TableSearchMetadata;
}

export interface RegisteredEntity extends RegisteredTable {
  readonly metadata: EntityTableMetadata;
}

/** The exported Drizzle schema namespace is the sole input to registry discovery. */
export type SchemaExports = Readonly<Record<string, unknown>>;

const declarations = new WeakMap<SQLiteTable, TableSearchMetadata>();

type ColumnEntityMetadata = Extract<EntityTableMetadata, { projection: 'columns' }>;

/** Require a publication column and status together so filtering cannot silently broaden visibility. */
function validatePublicationPolicy(visibility: Exclude<ColumnSearchVisibility, string>): void {
  if (
    (visibility.publishedColumn === undefined) !== (visibility.publishedValue === undefined) ||
    (visibility.publishedValue !== undefined && !visibility.publishedValue.trim())
  )
    throw new TypeError('Search publication requires a status column and a nonempty status value');
}

/** Reject empty or unknown visibility rules before any table enters the registry. */
function validateVisibilityPolicy(visibility: Exclude<ColumnSearchVisibility, string>): void {
  if (
    !visibility ||
    typeof visibility !== 'object' ||
    !Object.values(visibility).some((value) => value !== undefined) ||
    Object.keys(visibility).some(
      (key) =>
        !['archivedColumn', 'deletedColumn', 'publishedColumn', 'publishedValue'].includes(key)
    )
  )
    throw new TypeError('Automatic search requires an explicit valid visibility policy');

  validatePublicationPolicy(visibility);
}

/** Require explicit content, scope, and visibility for automatically projected tables. */
function validateAutomaticPolicy(metadata: ColumnEntityMetadata): void {
  if (!metadata.textColumns?.length || !['global', 'project'].includes(metadata.scope?.type))
    throw new TypeError('Automatic search requires text columns and an explicit scope');

  if (metadata.visibility !== 'all') validateVisibilityPolicy(metadata.visibility);
}

/** Automatic retrieval encodes one scalar identity, never part of a composite key. */
function validateAutomaticIdentity(table: SQLiteTable, idColumn: string): void {
  const identity = getTableColumns(table)[idColumn];
  const config = getTableConfig(table);
  const keys = config.primaryKeys.map((key) => key.columns);
  const inline = config.columns.filter((column) => column.primary);

  if (inline.length) keys.push(inline);

  if (keys.length !== 1 || keys[0]?.length !== 1 || keys[0][0] !== identity)
    throw new TypeError('Automatic search identity must be the single-column primary key');

  if (!['SQLiteInteger', 'SQLiteText'].includes(identity!.columnType))
    throw new TypeError('Automatic search identity must be a text or integer primary key');
}

/** Validate scope and visibility column types before constructing automatic SQL predicates. */
function validateAutomaticColumns(table: SQLiteTable, metadata: ColumnEntityMetadata): void {
  validateAutomaticIdentity(table, metadata.idColumn ?? 'id');
  const columns = getTableColumns(table);
  const requireInteger = (name: string, nullable: boolean) => {
    const column = columns[name];

    if (!column || column.getSQLType() !== 'integer' || (nullable && column.notNull))
      throw new TypeError('Search scope and timestamp columns must be declared integers');
  };

  if (metadata.scope.type === 'project') requireInteger(metadata.scope.column, false);

  if (metadata.visibility === 'all') return;

  const visibility = metadata.visibility;

  if (visibility.archivedColumn !== undefined) requireInteger(visibility.archivedColumn, true);

  if (visibility.deletedColumn !== undefined) requireInteger(visibility.deletedColumn, true);

  if (
    visibility.publishedColumn !== undefined &&
    columns[visibility.publishedColumn]?.columnType !== 'SQLiteText'
  )
    throw new TypeError('Search publication status must be a declared text column');
}

/** Check identities and text columns against the actual Drizzle table, including duplicate fields. */
function validateEntityColumns(table: SQLiteTable, metadata: EntityTableMetadata): void {
  const columns = getTableColumns(table);

  if (!columns[metadata.idColumn ?? 'id'])
    throw new TypeError('A searchable entity requires a declared identity column');

  if (metadata.projection === 'columns') validateAutomaticColumns(table, metadata);

  for (const name of metadata.textColumns ?? [])
    if (columns[name]?.columnType !== 'SQLiteText')
      throw new TypeError(`Search text column ${name} must be a declared text column`);

  if (metadata.textColumns && new Set(metadata.textColumns).size !== metadata.textColumns.length)
    throw new TypeError('Search text columns must be unique');
}

/** Require meaningful, stable metadata for every entity, contributor, or internal table. */
function validSearchPolicy(metadata: TableSearchMetadata): boolean {
  if (!metadata) return false;

  switch (metadata.role) {
    case 'entity':
      return /^[a-z][a-z0-9-]*$/.test(metadata.kind) && !!metadata.description.trim();
    case 'contributes':
      return /^[a-z][a-z0-9-]*$/.test(metadata.entity);
    case 'internal':
      return !!metadata.reason.trim();
    default:
      return false;
  }
}

/** Copy and freeze nested policies so later caller mutation cannot change search behavior. */
function freezeDeclaration(metadata: TableSearchMetadata): TableSearchMetadata {
  if (metadata.role !== 'entity') return Object.freeze({ ...metadata });

  if (metadata.projection === 'columns')
    return Object.freeze({
      ...metadata,
      textColumns: Object.freeze([...metadata.textColumns]),
      scope: Object.freeze({ ...metadata.scope }),
      visibility: metadata.visibility === 'all' ? 'all' : Object.freeze({ ...metadata.visibility })
    });

  return Object.freeze({
    ...metadata,
    ...(metadata.textColumns ? { textColumns: Object.freeze([...metadata.textColumns]) } : {})
  });
}

/** Preserve Drizzle's builder overloads and actual tables, attaching only external metadata. */
export function defineTable(metadata: TableSearchMetadata): typeof sqliteTable {
  if (!validSearchPolicy(metadata))
    throw new TypeError('A table requires an explicit valid search policy');

  if (metadata.role === 'entity') {
    if (!['feature', 'columns'].includes(metadata.projection))
      throw new TypeError('A searchable entity requires an explicit projection policy');

    if (metadata.projection === 'columns') validateAutomaticPolicy(metadata);
  }

  const declaration = freezeDeclaration(metadata);

  return new Proxy(sqliteTable, {
    apply(builder, receiver, args) {
      const table: SQLiteTable = Reflect.apply(builder, receiver, args);

      if (declaration.role === 'entity') validateEntityColumns(table, declaration);

      declarations.set(table, declaration);

      return table;
    }
  });
}

/** Discover each exported table once and reject raw declarations or duplicate SQL names. */
function declaredTables(exports: SchemaExports): RegisteredTable[] {
  const tables: RegisteredTable[] = [];
  const seen = new Set<SQLiteTable>();
  const names = new Set<string>();

  for (const value of Object.values(exports)) {
    if (!is(value, SQLiteTable) || seen.has(value)) continue;

    seen.add(value);
    const name = getTableName(value);
    const metadata = declarations.get(value);

    if (!metadata) throw new TypeError(`Table ${name} must be declared through defineTable`);

    if (names.has(name)) throw new TypeError(`Duplicate table ${name}`);

    names.add(name);
    tables.push(Object.freeze({ name, table: value, metadata }));
  }

  return tables.sort((a, b) => a.name.localeCompare(b.name));
}

/** Build unique entity kinds while preserving the validated declarations of their tables. */
function declaredEntities(tables: readonly RegisteredTable[]): RegisteredEntity[] {
  const entities: RegisteredEntity[] = [];
  const kinds = new Set<string>();

  for (const entry of tables) {
    if (entry.metadata.role !== 'entity') continue;

    if (kinds.has(entry.metadata.kind))
      throw new TypeError(`Duplicate searchable entity ${entry.metadata.kind}`);

    kinds.add(entry.metadata.kind);
    entities.push(Object.freeze({ ...entry, metadata: entry.metadata }));
  }

  return entities;
}

/** Derive a deterministic registry from the same exports consumed by Drizzle Kit. */
export function collectSchemaRegistry(exports: SchemaExports): {
  readonly tables: readonly RegisteredTable[];
  readonly entities: readonly RegisteredEntity[];
} {
  const tables = declaredTables(exports);
  const entities = declaredEntities(tables);
  const kinds = new Set(entities.map(({ metadata }) => metadata.kind));

  for (const { name, metadata } of tables)
    if (metadata.role === 'contributes' && !kinds.has(metadata.entity))
      throw new TypeError(`Table ${name} contributes to unknown entity ${metadata.entity}`);

  return Object.freeze({ tables: Object.freeze(tables), entities: Object.freeze(entities) });
}
