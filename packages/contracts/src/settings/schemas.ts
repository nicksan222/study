import { Effect, Schema } from 'effect';

import { exportFormatSchema } from '../materials/export.ts';
import { conversionStrategyIdSchema } from '../sources/conversion.ts';

export const appSettingsSchema = Schema.Struct({
  language: Schema.Literals([1, 2]),
  appearance: Schema.Literals([1, 2, 3]),
  zoomPercent: Schema.Int.check(Schema.isBetween({ minimum: 50, maximum: 200 })),
  onboarded: Schema.Boolean
});

export const tierSetupSchema = Schema.Struct({
  provider: Schema.Literal(1),
  model: Schema.optional(Schema.Literals([1, 2, 3]))
});

export const llmSettingsSchema = Schema.Struct({
  tiny: tierSetupSchema,
  medium: tierSetupSchema,
  smart: tierSetupSchema
});

export type ModelTier = keyof typeof llmSettingsSchema.fields;

export const materialSettingsSchema = Schema.Struct({
  sift: Schema.Boolean
});

export const reviewSettingsSchema = Schema.Struct({
  newCardsPerDay: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 10000 }))
});

export const appearancePreferencesSchema = Schema.Struct({
  contrast: Schema.Int.check(Schema.isBetween({ minimum: 75, maximum: 150 })),
  glassOpacity: Schema.Int.check(Schema.isBetween({ minimum: 40, maximum: 100 })),
  animationDurationMs: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 400 }))
});

export const concurrencySettingsSchema = Schema.Struct({
  maxConcurrentAi: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 8 })),
  maxQueuedAi: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 64 }))
});

export const sidebarSettingsSchema = Schema.Struct({
  settledDocumentThreshold: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 }))
});

export const workspacePreferencesSchema = Schema.Struct({
  autosaveIntervalSeconds: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 30 })),
  spellcheck: Schema.Boolean,
  submitOnEnter: Schema.Boolean,
  defaultExportFormat: exportFormatSchema,
  defaultAiDetail: Schema.Literals(['brief', 'balanced', 'detailed']),
  autoTitleSessions: Schema.Boolean,
  autoAnswerQuestions: Schema.Boolean,
  textConversionMode: Schema.Literals(['manual', 'automatic']),
  textConversionStrategy: conversionStrategyIdSchema,
  sidebarDensity: Schema.Literals(['comfortable', 'compact']),
  sidebarShowDocumentCounts: Schema.Boolean,
  sidebarTimeFormat: Schema.Literals(['relative', 'absolute']),
  editorFontSize: Schema.Int.check(Schema.isBetween({ minimum: 14, maximum: 24 })),
  readerFontSize: Schema.Int.check(Schema.isBetween({ minimum: 14, maximum: 24 })),
  expandDocuments: Schema.Boolean
});

export const quizSettingsSchema = Schema.Struct({
  questionCount: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 10 })),
  questionOrder: Schema.Literals(['source', 'shuffle']),
  shuffleChoices: Schema.Boolean,
  questionKind: Schema.Literals(['all', 'choice', 'open']),
  choiceCount: Schema.Int.check(Schema.isBetween({ minimum: 2, maximum: 6 })).pipe(
    Schema.withDecodingDefault(Effect.succeed(4))
  ),
  difficulty: Schema.Literals(['easy', 'balanced', 'challenging']).pipe(
    Schema.withDecodingDefault(Effect.succeed('balanced'))
  )
});

export const AgentRule = {
  Documents: { key: 'documents' },
  Titles: { key: 'titles' },
  Replies: { key: 'replies' },
  Quizzes: { key: 'quizzes' },
  Flashcards: { key: 'flashcards' },
  Diagrams: { key: 'diagrams' },
  Grading: { key: 'grading' },
  Transcription: { key: 'transcription' },
  QuestionDetection: { key: 'questionDetection' }
} as const;

export const maxAgentRuleLength = 8000;

/** User preferences augment task instructions without replacing schemas or evidence requirements. */
const agentRuleTextSchema = Schema.String.check(Schema.isMaxLength(maxAgentRuleLength));

export const agentRulesSchema = Schema.Struct({
  [AgentRule.Documents.key]: agentRuleTextSchema,
  [AgentRule.Titles.key]: agentRuleTextSchema,
  [AgentRule.Replies.key]: agentRuleTextSchema,
  [AgentRule.Quizzes.key]: agentRuleTextSchema,
  [AgentRule.Flashcards.key]: agentRuleTextSchema,
  [AgentRule.Diagrams.key]: agentRuleTextSchema,
  [AgentRule.Grading.key]: agentRuleTextSchema,
  [AgentRule.Transcription.key]: agentRuleTextSchema,
  [AgentRule.QuestionDetection.key]: agentRuleTextSchema
});

export type AgentRule = (typeof AgentRule)[keyof typeof AgentRule];

export type AgentRuleKey = AgentRule['key'];
