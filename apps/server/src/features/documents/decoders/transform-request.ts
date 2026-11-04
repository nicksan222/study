/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Defines canonical persisted Document transform request and report codecs.          │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Defines canonical persisted Document transform request and report codecs.              │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Pure schema and content validation grants no persistence or publication authority.       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import * as t from '@study/contracts/documents/transform';
import { Schema } from 'effect';

export const transformRequestCodec = Schema.fromJsonString(
  Schema.toCodecJson(t.transformRequestSchema)
);

export const transformReportCodec = Schema.fromJsonString(
  Schema.toCodecJson(t.transformReportSchema)
);
