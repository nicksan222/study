/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Hashes schema-encoded Page operation intents with stable object ordering.          │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Hashes schema-encoded Page operation intents with stable object ordering.              │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Pure schema and content validation grants no persistence or publication authority.       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { createHash } from 'node:crypto';

import { Schema } from 'effect';

/** Schema codecs preserve bigint identity; sorted object keys make replay property-order independent. */
export function intentHash<S extends Schema.ConstraintEncoder<unknown>>(
  schema: S,
  value: S['Type']
): string {
  const encoded = Schema.encodeSync(Schema.fromJsonString(Schema.toCodecJson(schema)))(value);
  const canonical = JSON.stringify(historicalIntent(JSON.parse(encoded)));

  return createHash('sha256').update(canonical).digest('hex');
}

/** Durable receipt digests keep their established encoding across domain terminology changes. */
const historicalKeys: Readonly<Record<string, string>> = {
  noteId: 'sessionId',
  noteIds: 'sessionIds',
  additionalNoteIds: 'additionalSessionIds',
  targetNoteId: 'targetSessionId',
  assistantForNoteId: 'assistantForSessionId',
  includedNotes: 'includedSessions',
  pageId: 'documentId'
};

function historicalIntent(value: unknown, content = false): unknown {
  if (Array.isArray(value)) return value.map((item) => historicalIntent(item, content));

  if (value === null || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value)
      .map(([key, item]) => {
        const historicalKey = content ? key : (historicalKeys[key] ?? key);

        return [historicalKey, historicalValue(key, item, value, content)] as const;
      })
      .sort(([a], [b]) => a.localeCompare(b))
  );
}

function historicalValue(key: string, item: unknown, owner: object, content: boolean): unknown {
  if (!content && key === 'kind' && item === 'page' && 'versionId' in owner) return 'document';

  const canonicalDocument =
    key === 'document' && item !== null && typeof item === 'object' && 'blocks' in item;

  return historicalIntent(item, content || canonicalDocument);
}
