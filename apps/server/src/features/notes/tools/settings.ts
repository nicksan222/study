/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exposes schema-checked settings capabilities and their agent-facing usage          │
 * │ guides.                                                                                  │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Reuses Settings service reads and writes with validated partial updates.               │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Feature services retain persistence policy; the agent runner provides dependencies and   │
 * │ tool execution.                                                                          │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts/errors';
import * as schemas from '@study/contracts/settings/schemas';
import { Effect, Option, Schema, Struct } from 'effect';
import type { Context } from 'effect';

import { Settings } from '#server/features/settings/index';
import { AiAdmission } from '#server/platform/ai/admission';
import type { Database } from '#server/platform/database/database';
import { defineTool } from '#server/platform/definitions/define-agent';
import type { ToolWiki } from '#server/platform/definitions/define-agent';

type Service = Context.Service.Shape<typeof Settings>;

/** Patch schemas preserve each canonical field's exact type and validation constraints. */
function updateTool<
  Fields extends Record<string, Schema.ConstraintCodec<unknown, unknown, never, never>>
>(
  schema: Schema.Struct<Fields>,
  description: string,
  wiki: ToolWiki,
  read: (settings: Service) => Effect.Effect<Schema.Struct<Fields>['Type'], StudyError, Database>,
  save: (
    settings: Service,
    input: Schema.Struct<Fields>['Type']
  ) => Effect.Effect<unknown, StudyError, Database>
) {
  const input = schema.mapFields(Struct.map(Schema.optionalKey));

  return defineTool({
    description,
    wiki,
    input,
    output: schema,
    mutates: true,
    execute: (patch: typeof input.Type) =>
      Effect.gen(function* () {
        const settings = yield* Settings;
        const current = yield* read(settings);
        const next = yield* Schema.decodeUnknownEffect(schema)({ ...current, ...patch }).pipe(
          Effect.mapError(
            (cause) => new StudyError('invalid_input', 'Invalid settings patch', { cause })
          )
        );

        yield* save(settings, next);

        return next;
      }).pipe(Effect.provide(Settings.layer))
  });
}

const snapshotSchema = Schema.Struct({
  general: schemas.appSettingsSchema,
  appearance: schemas.appearancePreferencesSchema,
  models: schemas.llmSettingsSchema,
  workspace: schemas.workspacePreferencesSchema,
  quiz: schemas.quizSettingsSchema,
  review: schemas.reviewSettingsSchema,
  materials: schemas.materialSettingsSchema,
  concurrency: schemas.concurrencySettingsSchema,
  sidebar: schemas.sidebarSettingsSchema,
  instructions: schemas.agentRulesSchema
});

export const settingsTools = {
  read_settings: defineTool({
    description:
      'Read all current local application preferences before changing or explaining them.',
    wiki: {
      when: 'Check current values and available settings.',
      examples: ['What settings can I change?', 'What is my current quiz difficulty?'],
      limits:
        'Returns local preferences only. Language 1=English/2=Italian; appearance 1=light/2=dark/3=system; ChatGPT model 1=Luna/2=Sol/3=Astra, provider=1. Preserve onboarding state unless explicitly asked.'
    },
    input: Schema.Record(Schema.String, Schema.Never),
    output: snapshotSchema,
    mutates: false,
    execute: () =>
      Effect.gen(function* () {
        const settings = yield* Settings;

        return yield* Effect.all({
          general: settings.appSettings(),
          appearance: settings.appearancePreferences(),
          models: settings.llmSettings(),
          workspace: settings.workspacePreferences(),
          quiz: settings.quizSettings(),
          review: settings.reviewSettings(),
          materials: settings.materialSettings(),
          concurrency: settings.concurrencySettings(),
          sidebar: settings.sidebarSettings(),
          instructions: settings.agentRules()
        });
      }).pipe(Effect.provide(Settings.layer))
  }),
  update_general_settings: updateTool(
    schemas.appSettingsSchema,
    'Change language, color scheme or interface zoom.',
    {
      when: 'Use for language, appearance and zoom preferences.',
      examples: ['Switch to Italian and dark mode.'],
      limits:
        'Language 1=English, 2=Italian. Appearance 1=light, 2=dark, 3=system. Preserve onboarded unless explicitly requested.'
    },
    (settings) => settings.appSettings(),
    (settings, input) => settings.saveAppSettings(input)
  ),
  update_appearance_settings: updateTool(
    schemas.appearancePreferencesSchema,
    'Change contrast, glass opacity and animation duration.',
    {
      when: 'Tune the visual interface without replacing themes.',
      examples: ['Increase contrast and reduce animations.'],
      limits: 'Percentages and milliseconds must stay within the schema bounds.'
    },
    (settings) => settings.appearancePreferences(),
    (settings, input) => settings.saveAppearancePreferences(input)
  ),
  update_model_settings: updateTool(
    schemas.llmSettingsSchema,
    'Change AI provider and model assignments for task tiers.',
    {
      when: 'Change tiny, medium or smart tier selection.',
      examples: ['Use Sol for everyday tasks.'],
      limits:
        'ChatGPT uses provider 1 and models 1=Luna, 2=Sol, 3=Astra. API providers use their registered provider ID and one of their registered model IDs. Each supplied tier is a complete replacement; omit model inside that tier to restore automatic selection. Never changes sign-in credentials.'
    },
    (settings) => settings.llmSettings(),
    (settings, input) => settings.saveLlmSettings(input)
  ),
  update_workspace_settings: updateTool(
    schemas.workspacePreferencesSchema,
    'Change writing, reading, export, sidebar display and automatic assistance preferences.',
    {
      when: 'Tune autosave, spellcheck, Enter behavior, font sizes, AI detail, automatic titles or answers, text/PDF conversion mode and strategy, sidebar density/counts/time, export format and expanded pages.',
      examples: ['Save notes every five seconds and use a larger reader font.'],
      limits:
        'Changes affect future actions; they do not rewrite existing content. Export formats are markdown, html, aid_json and csv.'
    },
    (settings) => settings.workspacePreferences(),
    (settings, input) => settings.saveWorkspacePreferences(input)
  ),
  update_quiz_settings: updateTool(
    schemas.quizSettingsSchema,
    'Change quiz setup and generation defaults.',
    {
      when: 'Tune question counts, ordering, answer shuffling, kinds, choice counts or difficulty.',
      examples: ['Make future quizzes challenging with six choices per question.'],
      limits:
        'Existing questions retain their content. Difficulty is easy, balanced or challenging; questionKind is all, choice or open.'
    },
    (settings) => settings.quizSettings(),
    (settings, input) => settings.saveQuizSettings(input)
  ),
  update_review_settings: updateTool(
    schemas.reviewSettingsSchema,
    'Change the daily allowance of new flashcards.',
    {
      when: 'Adjust spaced-repetition study workload.',
      examples: ['Show ten new cards per day.'],
      limits: 'Does not reset existing review history or due dates.'
    },
    (settings) => settings.reviewSettings(),
    (settings, input) => settings.saveReviewSettings(input)
  ),
  update_material_settings: updateTool(
    schemas.materialSettingsSchema,
    'Change material-processing preferences.',
    {
      when: 'Tune the existing sift preference.',
      examples: ['Disable material sifting.'],
      limits: 'No model downloads, deletion or regeneration are triggered.'
    },
    (settings) => settings.materialSettings(),
    (settings, input) => settings.saveMaterialSettings(input)
  ),
  update_concurrency_settings: updateTool(
    schemas.concurrencySettingsSchema,
    'Change parallel AI work and queue limits.',
    {
      when: 'Control background model workload.',
      examples: ['Run one AI task at a time.'],
      limits:
        'Active work is preserved; limits apply to admission. Do not bypass provider usage limits.'
    },
    (settings) => settings.concurrencySettings(),
    (settings, input) =>
      Effect.gen(function* () {
        yield* settings.saveConcurrencySettings(input);
        const admission = yield* Effect.serviceOption(AiAdmission);

        if (Option.isSome(admission)) yield* admission.value.configure(input);
      }).pipe(Effect.uninterruptible)
  ),
  update_sidebar_settings: updateTool(
    schemas.sidebarSettingsSchema,
    'Change the page threshold used to settle notes in the sidebar.',
    {
      when: 'Tune which notes look settled.',
      examples: ['Set the settled page threshold to two.'],
      limits: 'Does not delete or archive any note.'
    },
    (settings) => settings.sidebarSettings(),
    (settings, input) => settings.saveSidebarSettings(input)
  ),
  update_custom_instructions: updateTool(
    schemas.agentRulesSchema,
    'Change user-authored instructions for individual AI tasks.',
    {
      when: 'Customize pages, titles, answers, quizzes, flashcards, diagrams, grading, transcription or question detection.',
      examples: ['Use concise descriptive titles and worked examples in pages.'],
      limits:
        'Each field allows at most 8000 characters. Empty restores built-in behavior. New instructions apply to future runs and cannot grant unavailable tools.'
    },
    (settings) => settings.agentRules(),
    (settings, input) => settings.saveAgentRules(input)
  )
} as const;
