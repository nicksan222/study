import type {
  materialContentDetailSchema,
  MaterialDetailDto,
  MaterialSummaryDto,
  MaterialVersionDetailDto,
  draftMaterialVersionDetailSchema,
  publishedMaterialVersionDetailSchema
} from './schemas.ts';

export type ContentDetail = typeof materialContentDetailSchema.Type;

export type QuizQuestionDetail = Extract<ContentDetail, { kind: 'quiz' }>['questions'][number];

export type MaterialVersionDetail = MaterialVersionDetailDto;

export type PublishedMaterialVersion = typeof publishedMaterialVersionDetailSchema.Type;

export type DraftMaterialVersion = typeof draftMaterialVersionDetailSchema.Type;

export type MaterialDetail = MaterialDetailDto;

export type MaterialSummary = MaterialSummaryDto;
