/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Decodes persisted citation references independently from support assessments.      │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Validates canonical anchors and editor ranges from retained citation rows.             │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Materials owns stored citation decoding through the existing canonical contracts.        │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { documentTextRangeSchema } from '@study/contracts/sources/schemas';
import type * as s from '@study/db/schema';
import { Schema } from 'effect';

import { anchorSchema } from './schemas.ts';

const targetCodec = Schema.fromJsonString(Schema.toCodecJson(documentTextRangeSchema));

export function readCitation(row: typeof s.material_version_citations.$inferSelect) {
  return {
    marker: row.marker,
    inputVersionId: row.input_version_id,
    anchor: Schema.decodeUnknownSync(anchorSchema)(JSON.parse(row.anchor)),
    ...(row.target === null ? {} : { target: Schema.decodeUnknownSync(targetCodec)(row.target) }),
    quote: row.quote
  };
}
