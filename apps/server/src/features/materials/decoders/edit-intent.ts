/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Canonicalizes schema-encoded idempotency intents for durable replay.               │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Preserves meaningful array order and bigint codec values.                              │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Pure ordering policy; feature stores retain typed intent codecs.                         │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

export function canonicalJson(encoded: string): string {
  return JSON.stringify(JSON.parse(encoded), (_, value: unknown) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;

    return Object.fromEntries(
      Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
    );
  });
}
