/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exposes notebook session tools and their agent usage guides.                       │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Reuses canonical feature services and schema-checked operations.                       │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Persistence policy remains in the owning feature service.                                │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import * as r from '@study/contracts/conversations/rpc';
import { sessionSchema } from '@study/contracts/conversations/schemas';
import * as p from '@study/contracts/projects/rpc';
import { Effect, Schema } from 'effect';

import { Conversations } from '#server/features/conversations/index';
import { Projects } from '#server/features/projects/index';
import { defineTool } from '#server/platform/definitions/define-agent';

export const sessionTools = {
  list_sessions: defineTool({
    description: 'List notebook sessions with optional subject membership filter.',
    wiki: {
      when: 'Find study sessions and resolve their IDs.',
      examples: ['Show my biology study sessions.'],
      limits:
        'At most 100 per page. Pass next as before until null. Omit project for all notebooks; project=null finds unassigned notebooks. Assistant chats are separate.'
    },
    input: r.sessionPageInputSchema,
    output: r.sessionPageSchema,
    mutates: false,
    execute: (input: typeof r.sessionPageInputSchema.Type) =>
      Effect.flatMap(Conversations, (service) => service.sessions(input)).pipe(
        Effect.provide(Conversations.layer)
      )
  }),
  read_session: defineTool({
    description: 'Read a notebook session title and subject memberships.',
    wiki: {
      when: 'Inspect a known session before changing it.',
      examples: ['Which subjects is this session linked to?'],
      limits:
        'Requires an exact listed session ID. Use read_session_history for messages and list_documents for linked documents.'
    },
    input: r.sessionIdInputSchema,
    output: sessionSchema,
    mutates: false,
    execute: (input: typeof r.sessionIdInputSchema.Type) =>
      Effect.flatMap(Conversations, (service) => service.notebookSession(input.id)).pipe(
        Effect.provide(Conversations.layer)
      )
  }),
  create_session: defineTool({
    description: 'Create a named notebook session or reuse an exact name in the same subject.',
    wiki: {
      when: 'The user asks to create a study session.',
      examples: ['Create a session called Exam revision in Biology.'],
      limits:
        'Title must contain 1–200 characters after trimming. Reuses the earliest notebook with the same exact name and requested subject (or no subject), so retries do not duplicate it. Does not start model work or create messages.'
    },
    input: r.createSessionInputSchema,
    output: sessionSchema,
    mutates: true,
    execute: (input: typeof r.createSessionInputSchema.Type) =>
      Effect.flatMap(Conversations, (service) => service.ensureSession(input)).pipe(
        Effect.provide(Conversations.layer)
      )
  }),
  rename_session: defineTool({
    description: 'Rename an existing notebook session.',
    wiki: {
      when: 'The user asks to change a session title.',
      examples: ['Rename this session to Week 2 revision.'],
      limits:
        'Resolve the exact session ID first. Title must contain 1–200 characters. Preserves history and linked content.'
    },
    input: r.renameSessionInputSchema,
    output: sessionSchema,
    mutates: true,
    execute: (input: typeof r.renameSessionInputSchema.Type) =>
      Effect.flatMap(Conversations, (service) =>
        service.notebookSession(input.id).pipe(Effect.andThen(service.renameSession(input)))
      ).pipe(Effect.provide(Conversations.layer))
  }),
  read_session_history: defineTool({
    description: 'Read a page of saved messages in a notebook session or thread.',
    wiki: {
      when: 'Review notes, questions and replies from a session.',
      examples: ['What did we cover in my last biology session?'],
      limits:
        'At most 100 messages per page. Pass next as before for older messages until null. Read each message’s activeVersionId to identify its current text; message versions are historical variants. Optional threadRoot restricts a thread. Does not include linked document bodies.'
    },
    input: r.threadInputSchema,
    output: r.threadPageSchema,
    mutates: false,
    execute: (input: typeof r.threadInputSchema.Type) =>
      Effect.flatMap(Conversations, (service) =>
        service.notebookSession(input.sessionId).pipe(Effect.andThen(service.thread(input)))
      ).pipe(Effect.provide(Conversations.layer))
  }),
  link_session_subject: membershipTool(
    'Link a notebook session to a subject.',
    'Link this session to Biology.',
    true
  ),
  unlink_session_subject: membershipTool(
    'Unlink a notebook session from a subject.',
    'Unlink this session from Biology.',
    false
  )
} as const;

function membershipTool(description: string, example: string, add: boolean) {
  return defineTool({
    description,
    wiki: {
      when: 'Change which subjects contain a session.',
      examples: [example],
      limits:
        'Resolve both exact IDs first. Sessions may belong to several subjects. Preserves messages and documents; retries are safe.'
    },
    input: p.projectSessionInputSchema,
    output: Schema.Boolean,
    mutates: true,
    execute: (input) =>
      Effect.gen(function* () {
        const conversations = yield* Conversations;

        yield* conversations.notebookSession(input.sessionId);
        const projects = yield* Projects;

        yield* add ? projects.addSession(input) : projects.removeSession(input);

        return true;
      }).pipe(Effect.provide(Projects.layer), Effect.provide(Conversations.layer))
  });
}
