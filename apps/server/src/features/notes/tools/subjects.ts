/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exposes schema-checked subject capabilities and their agent-facing usage guides.   │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Reuses Projects service operations with canonical typed IDs and schemas.               │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Feature services retain persistence policy; the agent runner provides dependencies and   │
 * │ tool execution.                                                                          │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import * as inputs from '@study/contracts/projects/rpc';
import { projectSchema } from '@study/contracts/projects/schemas';
import { Effect, Schema } from 'effect';

import { Projects } from '#server/features/projects/index';
import { defineTool } from '#server/platform/definitions/define-agent';

export const subjectTools = {
  list_subjects: defineTool({
    description: 'List subjects, newest first. Follow next with before to retrieve every page.',
    wiki: {
      when: 'Find subjects and resolve their exact IDs before changing them.',
      examples: ['What subjects do I have?'],
      limits: 'At most 100 per page. Never invent IDs; ask which subject when names are ambiguous.'
    },
    input: inputs.projectPageInputSchema,
    output: inputs.projectPageSchema,
    mutates: false,
    execute: (input: typeof inputs.projectPageInputSchema.Type) =>
      Projects.use((service) => service.projects(input)).pipe(Effect.provide(Projects.layer))
  }),
  read_subject: defineTool({
    description: 'Read a subject by its exact ID.',
    wiki: {
      when: 'Inspect a known subject, its icon or exam date.',
      examples: ['When is my biology exam?'],
      limits: 'Read IDs from list_subjects. Does not return the subject’s materials or notes.'
    },
    input: inputs.projectIdInputSchema,
    output: projectSchema,
    mutates: false,
    execute: ({ id }: typeof inputs.projectIdInputSchema.Type) =>
      Projects.use((service) => service.project(id)).pipe(Effect.provide(Projects.layer))
  }),
  create_subject: defineTool({
    description:
      'Create a subject, or reuse the earliest subject with the exact same trimmed name.',
    wiki: {
      when: 'The user asks to create a new subject.',
      examples: ['Create a new subject called Biology.'],
      limits:
        'Name must be nonempty and at most 100 characters. Reuses an exact name so retrying does not create duplicates. Does not generate study content.'
    },
    input: inputs.createProjectInputSchema,
    output: projectSchema,
    mutates: true,
    execute: (input: typeof inputs.createProjectInputSchema.Type) =>
      Projects.use((service) => service.ensureProject(input)).pipe(Effect.provide(Projects.layer))
  }),
  rename_subject: defineTool({
    description: 'Rename an existing subject.',
    wiki: {
      when: 'The user requests a subject name change.',
      examples: ['Rename Biology to Molecular Biology.'],
      limits: 'Resolve the exact ID first. Does not change linked content.'
    },
    input: inputs.renameProjectInputSchema,
    output: Schema.Boolean,
    mutates: true,
    execute: (input: typeof inputs.renameProjectInputSchema.Type) =>
      Projects.use((service) => service.renameProject(input)).pipe(Effect.provide(Projects.layer))
  }),
  set_subject_exam: defineTool({
    description: 'Set or clear the exam date of a subject.',
    wiki: {
      when: 'Schedule a subject’s exam date.',
      examples: ['Set my biology exam to 2027-01-20.'],
      limits:
        'Use a valid YYYY-MM-DD date or null to clear. Clarify an ambiguous date. Does not create calendar events or notifications.'
    },
    input: inputs.setExamInputSchema,
    output: Schema.Boolean,
    mutates: true,
    execute: (input: typeof inputs.setExamInputSchema.Type) =>
      Projects.use((service) => service.setExam(input)).pipe(Effect.provide(Projects.layer))
  }),
  set_subject_icon: defineTool({
    description: 'Change a subject’s icon and color.',
    wiki: {
      when: 'Customize a subject’s visual identity.',
      examples: ['Give Biology a green icon.'],
      limits:
        'Use the schema’s supported icon variants and colors; read current state and preserve unspecified choices.'
    },
    input: inputs.setProjectIconInputSchema,
    output: projectSchema,
    mutates: true,
    execute: (input: typeof inputs.setProjectIconInputSchema.Type) =>
      Projects.use((service) => service.setIcon(input)).pipe(Effect.provide(Projects.layer))
  })
} as const;
