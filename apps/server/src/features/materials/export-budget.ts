/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ Counts canonical JSON bytes incrementally before export retains expanded evidence.       │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Accounts for UTF-8 strings, JSON escaping and bigint identities.                       │
 * │ - Rejects excessive nesting or cumulative bytes before visiting later values.            │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ This pure counter accepts canonical data and performs no database or provider work.      │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts/errors';
import { MAX_EXPORT_BYTES } from '@study/contracts/materials/export';

/** Counts JSON UTF-8 without allocating the full serialization; aborts at the budget. */
export function exportBudget(limit = MAX_EXPORT_BYTES) {
  let remaining = limit;
  function add(bytes: number) {
    remaining -= bytes;
    if (remaining < 0) throw new StudyError('invalid_input', 'Export input exceeds byte limit');
  }
  function string(value: string) {
    add(2);
    for (const character of value) {
      const point = character.codePointAt(0)!;
      if (character === '"' || character === '\\') add(2);
      else if ([8, 9, 10, 12, 13].includes(point)) add(2);
      else if (point < 32 || (point >= 0xd800 && point <= 0xdfff)) add(6);
      else add(point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4);
    }
  }
  function consume(value: unknown, depth = 0): void {
    if (depth > 64) throw new StudyError('invalid_input', 'Export nesting limit exceeded');
    if (typeof value === 'string' || typeof value === 'bigint') string(String(value));
    else if (value === null || value === undefined) add(4);
    else if (typeof value === 'number' || typeof value === 'boolean')
      add(JSON.stringify(value).length);
    else if (Array.isArray(value)) {
      add(2);
      for (let index = 0; index < value.length; index++) {
        if (index) add(1);
        consume(value[index], depth + 1);
      }
    } else if (typeof value === 'object') {
      add(2);
      let first = true;
      for (const key in value) {
        if (!Object.hasOwn(value, key)) continue;
        const item = (value as Record<string, unknown>)[key];
        if (item === undefined) continue;
        if (!first) add(1);
        first = false;
        string(key);
        add(1);
        consume(item, depth + 1);
      }
    } else throw new StudyError('invalid_input', 'Unsupported export value');
  }
  return { consume, remaining: () => remaining };
}
