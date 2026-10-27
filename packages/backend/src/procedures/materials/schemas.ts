import * as s from '@study/db/schema';
import { z } from 'zod';

export const materialId = z.bigint().min(1n).max(9223372036854775807n);

const nonempty = z.string().trim().min(1);

const natural = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

export const anchorSchema = z.discriminatedUnion('type', [
  z
    .object({ type: z.literal('time'), startMs: natural, endMs: natural })
    .refine((a) => a.endMs >= a.startMs),
  z.object({ type: z.literal('page'), page: natural.min(1) }),
  z
    .object({
      type: z.literal('text'),
      lineStart: natural,
      lineEnd: natural,
      start: natural,
      end: natural
    })
    .refine((a) => a.lineEnd >= a.lineStart && a.end >= a.start),
  z.object({ type: z.literal('slide'), index: natural }),
  z.object({ type: z.literal('paragraph'), index: natural }),
  z.object({ type: z.literal('url'), url: z.url(), fragment: z.string().nullable() })
]);

export const documentSchema = z.object({
  blocks: z
    .array(
      z.object({ kind: z.enum(s.blocks.kind.enumValues), text: z.string(), anchor: anchorSchema })
    )
    .min(1),
  meta: z.object({
    extractor: z.string().nullable(),
    extractorVersion: natural,
    provider: z.string().nullable(),
    durationMs: natural.nullable(),
    pageCount: natural.nullable(),
    refiners: z.array(z.object({ refiner: nonempty, version: natural })),
    waitingFor: z.array(z.string()),
    corrected: z.boolean()
  })
});

const choice = z.object({ text: nonempty, isCorrect: z.boolean() });

const questionBase = z.object({ prompt: nonempty, explanation: nonempty });

const single = questionBase
  .extend({
    kind: z.literal(s.material_quiz_choices.question_kind.enumValues[0]),
    choices: z.array(choice).min(2).max(100)
  })
  .refine((q) => q.choices.filter((c) => c.isCorrect).length === 1);

const multiple = questionBase
  .extend({
    kind: z.literal(s.material_quiz_choices.question_kind.enumValues[1]),
    choices: z.array(choice).min(2).max(100)
  })
  .refine((q) => q.choices.some((c) => c.isCorrect));

const open = questionBase.extend({
  kind: z.literal(s.material_quiz_open_answers.kind.enumValues[0]),
  referenceAnswer: nonempty
});

export const questionSchema = z.discriminatedUnion('kind', [single, multiple, open]);

const duration = z.bigint().min(0n).max(9223372036854775807n).nullable();

const dimension = z.bigint().min(1n).max(9223372036854775807n).nullable();

const file = z.object({
  kind: z.literal(s.material_file_versions.kind.enumValues[0]),
  sourceId: materialId
});

const audio = z.object({
  kind: z.literal(s.material_audio_versions.kind.enumValues[0]),
  sourceId: materialId,
  durationMs: duration,
  sampleRate: dimension,
  channels: dimension
});

const video = z
  .object({
    kind: z.literal(s.material_video_versions.kind.enumValues[0]),
    sourceId: materialId,
    durationMs: duration,
    width: dimension,
    height: dimension
  })
  .refine((v) => (v.width === null) === (v.height === null));

const image = z
  .object({
    kind: z.literal(s.material_image_versions.kind.enumValues[0]),
    sourceId: materialId,
    width: dimension,
    height: dimension
  })
  .refine((v) => (v.width === null) === (v.height === null));

const link = z.object({
  kind: z.literal(s.material_link_versions.kind.enumValues[0]),
  sourceId: materialId
});

const document = documentSchema.extend({
  kind: z.literal(s.material_document_versions.kind.enumValues[0])
});

const diagram = z.object({
  kind: z.literal(s.material_diagram_versions.kind.enumValues[0]),
  format: z.enum(s.material_diagram_versions.format.enumValues),
  payload: nonempty
});

const quiz = z.object({
  kind: z.literal(s.material_quiz_versions.kind.enumValues[0]),
  questions: z.array(questionSchema).min(1)
});

const cards = z
  .object({
    kind: z.literal(s.material_flashcard_versions.kind.enumValues[0]),
    cards: z
      .array(z.object({ cardId: materialId.optional(), front: nonempty, back: nonempty }))
      .min(1)
  })
  .refine((v) => {
    const ids = v.cards.flatMap((c) => (c.cardId === undefined ? [] : [c.cardId]));

    return new Set(ids).size === ids.length;
  });

export const materialContentSchema = z.discriminatedUnion('kind', [
  file,
  audio,
  video,
  image,
  link,
  document,
  diagram,
  quiz,
  cards
]);

export type MaterialContentInput = z.infer<typeof materialContentSchema>;

export type MaterialKind = typeof s.materials.$inferSelect.kind;

export type MaterialOperation = typeof s.material_versions.$inferSelect.operation;

export const operationSchema = z.enum(s.material_versions.operation.enumValues);

export const linksSchema = z
  .object({
    inputs: z.array(materialId).max(1000).optional(),
    parents: z.array(materialId).max(1000).optional()
  })
  .refine((v) => [v.inputs, v.parents].every((ids) => !ids || new Set(ids).size === ids.length));

export const createVersionSchema = linksSchema.safeExtend({
  content: materialContentSchema,
  operation: operationSchema.optional(),
  language: z.string().trim().min(1).max(64).nullable().optional(),
  publish: z.boolean().optional()
});

export const createMaterialSchema = createVersionSchema.safeExtend({
  projectId: materialId,
  sessionId: materialId.optional(),
  title: nonempty.max(200)
});

export const pageSchema = z.object({
  cursor: materialId.optional(),
  take: z.number().int().min(1).max(100).default(50)
});

export const citationSchema = z.object({
  marker: z.bigint().min(1n).max(4294967295n),
  inputVersionId: materialId,
  anchor: anchorSchema,
  quote: nonempty
});
