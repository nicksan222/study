/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Defines canonical persisted Page transform request and report codecs.              │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Defines canonical persisted Page transform request and report codecs.                  │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Pure schema and content validation grants no persistence or publication authority.       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import * as t from '@study/contracts/pages/transform';
import { Schema } from 'effect';

export const transformRequestCodec = Schema.fromJsonString(
  Schema.toCodecJson(t.storedTransformRequestSchema)
);

export const transformReportCodec = Schema.fromJsonString(
  Schema.toCodecJson(t.transformReportSchema)
);
