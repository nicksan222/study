import * as schema from '@study/db/schema';
import { sql } from 'drizzle-orm';

import type { ServerContext } from '#server/runtime/context';
import { StudyError } from '#server/shared/errors/index';
import type { JsonValue } from '#server/shared/json';

export function encodePreference(value: JsonValue): string {
  const json = JSON.stringify(value);

  if (json === undefined) throw new StudyError('invalid_input', 'preference must be JSON');

  return json;
}

export function loadPreferences(ctx: ServerContext, scope: string): Record<string, JsonValue> {
  const result: Record<string, JsonValue> = {};

  for (const row of ctx.db.orm
    .select({
      key: schema.preferences.key,
      value: schema.preferences.value
    })
    .from(schema.preferences)
    .where(sql`scope = ${scope}`)
    .all())
    Object.defineProperty(result, row.key as string, {
      value: JSON.parse(row.value as string) as JsonValue,
      enumerable: true,
      configurable: true,
      writable: true
    });

  return result;
}

export function setPreference(
  ctx: ServerContext,
  scope: string,
  key: string,
  value: JsonValue
): void {
  ctx.db.orm.run(
    sql`INSERT INTO preferences (scope, key, value) VALUES (${scope}, ${key}, ${encodePreference(value)}) ON CONFLICT (scope, key) DO UPDATE SET value = excluded.value`
  );
}

export function deletePreference(ctx: ServerContext, scope: string, key: string): void {
  ctx.db.orm
    .delete(schema.preferences)
    .where(sql`scope = ${scope} AND key = ${key}`)
    .run();
}

export function savePreferences(
  ctx: ServerContext,
  scope: string,
  values: Record<string, JsonValue>
): void {
  ctx.transaction(() => {
    ctx.db.orm
      .delete(schema.preferences)
      .where(sql`scope = ${scope}`)
      .run();

    for (const [key, value] of Object.entries(values)) setPreference(ctx, scope, key, value);
  });
}
