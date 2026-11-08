import type * as s from './schemas.ts';

export type Page = typeof s.detailSchema.Type;

export type PageVersion = typeof s.versionSchema.Type;

export type ExactPageInput = typeof s.exactInputSchema.Type;

export type PageCitation = typeof s.citationSchema.Type;

export type PageSummary = typeof s.summarySchema.Type;
