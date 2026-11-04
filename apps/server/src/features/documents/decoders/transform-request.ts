import * as t from '@study/contracts/documents/transform';
import { StudyError } from '@study/contracts/errors';
import type { study_document_transform_requests } from '@study/db/schema';
import { Schema } from 'effect';

export const transformRequestCodec = Schema.fromJsonString(
  Schema.toCodecJson(t.transformRequestSchema)
);
export const transformReportCodec = Schema.fromJsonString(
  Schema.toCodecJson(t.transformReportSchema)
);

export function decodeTransformRequest(row: typeof study_document_transform_requests.$inferSelect) {
  const request = Schema.decodeUnknownSync(transformRequestCodec)(row.request);
  if (request.contextRequestId !== row.context_request_id)
    throw new StudyError('invalid_input', 'Document generation capture identity is inconsistent');
  return Schema.decodeUnknownSync(t.transformSnapshotSchema)({
    ...request,
    id: row.id,
    sessionId: row.session_id,
    instruction: row.instruction,
    eventId: row.event_id,
    cancelled: row.cancelled,
    errorKind: row.error_kind,
    resultVersionId: row.result_version_id,
    report: row.report === null ? null : Schema.decodeUnknownSync(transformReportCodec)(row.report)
  });
}
