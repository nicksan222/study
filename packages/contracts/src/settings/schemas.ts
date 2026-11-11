import { Effect, Schema } from 'effect';

import { exportFormatSchema } from '../materials/export.ts';
import { conversionStrategyIdSchema } from '../sources/conversion.ts';

export const appSettingsSchema = Schema.Struct({
  language: Schema.Literals([1, 2]),
  appearance: Schema.Literals([1, 2, 3]),
  zoomPercent: Schema.Int.check(Schema.isBetween({ minimum: 50, maximum: 200 })),
  onboarded: Schema.Boolean
});

/** Provider modules register IDs; the service checks membership before saving or requesting. */
const apiKeyProviderIdSchema = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9-]{0,63}$/));

const modelIdSchema = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(200),
  Schema.isPattern(/^\S+$/)
);

export const tierSetupSchema = Schema.Union([
  Schema.Struct({
    provider: Schema.Literal(1),
    model: Schema.optional(Schema.Literals([1, 2, 3]))
  }),
  Schema.Struct({ provider: apiKeyProviderIdSchema, model: Schema.optional(modelIdSchema) })
]);

export const apiKeyInputSchema = Schema.Struct({
  provider: apiKeyProviderIdSchema,
  apiKey: Schema.NullOr(
    Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(8192), Schema.isPattern(/^\S+$/))
  )
});

export const aiProviderSchema = Schema.Struct({
  id: apiKeyProviderIdSchema,
  name: Schema.String,
  models: Schema.Array(modelIdSchema),
  defaults: Schema.Struct({ tiny: modelIdSchema, medium: modelIdSchema, smart: modelIdSchema }),
  configured: Schema.Boolean
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
  settledPageThreshold: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 }))
});

export const workspacePreferencesSchema = Schema.Struct({
  autosaveIntervalSeconds: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 30 })),
  spellcheck: Schema.Boolean,
  submitOnEnter: Schema.Boolean,
  defaultExportFormat: exportFormatSchema,
  defaultAiDetail: Schema.Literals(['brief', 'balanced', 'detailed']),
  autoTitleNotes: Schema.Boolean,
  autoAnswerQuestions: Schema.Boolean,
  textConversionMode: Schema.Literals(['manual', 'automatic']),
  textConversionStrategy: conversionStrategyIdSchema,
  sidebarDensity: Schema.Literals(['comfortable', 'compact']),
  sidebarShowPageCounts: Schema.Boolean,
  sidebarTimeFormat: Schema.Literals(['relative', 'absolute']),
  editorFontSize: Schema.Int.check(Schema.isBetween({ minimum: 14, maximum: 24 })),
  readerFontSize: Schema.Int.check(Schema.isBetween({ minimum: 14, maximum: 24 })),
  expandPages: Schema.Boolean
});

/** Generation defaults for each specialized practice mode. */
const practiceGenerationSettingsSchema = Schema.Struct({
  questionCount: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 10 })),
  difficulty: Schema.Literals(['easy', 'balanced', 'challenging'])
});

export const quizSettingsSchema = Schema.Struct({
  practice: Schema.optional(
    Schema.Struct({
      fill_blank: Schema.optional(practiceGenerationSettingsSchema),
      ordering: Schema.optional(practiceGenerationSettingsSchema),
      matching: Schema.optional(practiceGenerationSettingsSchema),
      true_false: Schema.optional(practiceGenerationSettingsSchema)
    })
  ),
  questionCount: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 10 })),
  questionOrder: Schema.Literals(['source', 'shuffle']),
  shuffleChoices: Schema.Boolean,
  questionKind: Schema.Literals([
    'all',
    'choice',
    'open',
    'fill_blank',
    'ordering',
    'matching',
    'true_false'
  ]),
  choiceCount: Schema.Int.check(Schema.isBetween({ minimum: 2, maximum: 6 })).pipe(
    Schema.withDecodingDefault(Effect.succeed(4))
  ),
  difficulty: Schema.Literals(['easy', 'balanced', 'challenging']).pipe(
    Schema.withDecodingDefault(Effect.succeed('balanced'))
  )
});

export const AgentRule = {
  Pages: { key: 'pages' },
  Titles: { key: 'titles' },
  Replies: { key: 'replies' },
  Quizzes: { key: 'quizzes' },
  Flashcards: { key: 'flashcards' },
  Grading: { key: 'grading' },
  Transcription: { key: 'transcription' },
  QuestionDetection: { key: 'questionDetection' }
} as const;

export const maxAgentRuleLength = 8000;

/** User preferences augment task instructions without replacing schemas or evidence requirements. */
const agentRuleTextSchema = Schema.String.check(Schema.isMaxLength(maxAgentRuleLength));

export const agentRulesSchema = Schema.Struct({
  [AgentRule.Pages.key]: agentRuleTextSchema,
  [AgentRule.Titles.key]: agentRuleTextSchema,
  [AgentRule.Replies.key]: agentRuleTextSchema,
  [AgentRule.Quizzes.key]: agentRuleTextSchema,
  [AgentRule.Flashcards.key]: agentRuleTextSchema,
  [AgentRule.Grading.key]: agentRuleTextSchema,
  [AgentRule.Transcription.key]: agentRuleTextSchema,
  [AgentRule.QuestionDetection.key]: agentRuleTextSchema
});

export type AgentRule = (typeof AgentRule)[keyof typeof AgentRule];

export type AgentRuleKey = AgentRule['key'];
