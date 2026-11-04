import type * as s from './schemas.ts';

export type StudyDocument = typeof s.detailSchema.Type;

export type StudyDocumentVersion = typeof s.versionSchema.Type;

export type ExactDocumentInput = typeof s.exactInputSchema.Type;

export type DocumentCitation = typeof s.citationSchema.Type;

export type StudyDocumentSummary = typeof s.summarySchema.Type;
