import { RegistryContext, useAtomValue } from '@effect/atom-react';
import { StudyError } from '@study/contracts';
import type { NoteId, MessageId, VersionId, chatMessageSchema } from '@study/contracts';
import { rpc } from '@study/contracts/react';
import { Atom } from 'effect/reactivity';
import { useContext, useRef } from 'react';

import { useAiReadiness } from '#client/lib/ai-readiness.ts';
import { useI18n } from '#client/lib/i18n.tsx';

import { composerDraft } from './composer.queries';
import { useMessageConversion } from './conversion.queries';
import {
  activateVersion,
  ask,
  editNote,
  reanswerNote,
  rewriteNote
} from './note-workspace.queries';
import type { AskInput } from './note-workspace.queries';

type Message = typeof chatMessageSchema.Type;

type Action = 'edit' | 'ask' | 'answer' | 'improve' | 'summarize' | 'instruction' | 'activate';

function requiresAi(action: Action) {
  return action !== 'edit' && action !== 'activate';
}

type Attempt = {
  action: Action;
  versionId: VersionId;
  text: string;
  instruction: string;
  askInput?: AskInput;
};

type EditDraft = {
  targetVersionId: VersionId;
  targetText: string;
  targetNumber?: bigint;
  text: string;
};

type State = {
  pausedEdit?: EditDraft;
  reviewedEditBase?: Omit<EditDraft, 'text'>;
  targetVersionId?: VersionId;
  targetText?: string;
  targetNumber?: bigint;
  mode?: Action;
  text: string;
  instruction: string;
  attempt?: Attempt;
  pending?: boolean;
  error?: unknown;
  requestId?: string;
  reviewed?: boolean;
};

const actionDraft = Atom.family((_key: string) =>
  Atom.make<State>({ text: '', instruction: '' }).pipe(Atom.keepAlive)
);

export const messageActionDraft = (noteId: NoteId, messageId: MessageId) =>
  actionDraft(`${noteId}:${messageId}`);

/** Coordinates version-scoped edits, generation attempts and conversion controls. */
export function useMessageActions({
  message,
  versionId,
  onActive
}: {
  message: Message;
  versionId: VersionId;
  onActive: () => void;
}) {
  const { t, locale } = useI18n();
  const readiness = useAiReadiness('medium');
  const conversion = useMessageConversion(message, versionId);
  const cache = useContext(RegistryContext);
  const atom = messageActionDraft(message.noteId, message.id);
  const draft = useAtomValue(atom);
  const editor = useRef<HTMLElement>(null);
  const origin = useRef<HTMLDivElement>(null);
  const launcher = useRef<HTMLElement | null>(null);
  const patch = (value: Partial<State>) =>
    cache.update(atom, (previous) => ({ ...previous, ...value }));
  const selection = rpc.notes.noteSelection.useQuery({ noteId: message.noteId });
  const version = message.versions.find((item) => item.id === versionId);
  const active = versionId === message.activeVersionId;
  const blocked = !!draft.attempt || !!draft.pending || version?.status !== 'complete';

  function canAct(action: Action) {
    return !blocked && (!requiresAi(action) || readiness === 'ready');
  }

  async function runAttempt(attempt: Attempt) {
    let requestId: string | undefined;

    if (attempt.action === 'ask') {
      requestId = (await ask(attempt.askInput!)).requestId;
    } else {
      // These APIs target a message's active version, never a historical version.
      const latest = await rpc.notes.message.read({ id: message.id });

      if (attempt.action !== 'activate' && latest.activeVersionId !== attempt.versionId)
        throw new StudyError('invalid_input', 'Active message version changed');

      if (attempt.action === 'edit') await editNote({ messageId: message.id, text: attempt.text });
      else if (attempt.action === 'activate')
        await activateVersion({ messageId: message.id, versionId: attempt.versionId });
      else if (attempt.action === 'answer') requestId = (await reanswerNote(message.id)).requestId;
      else
        requestId = (
          await rewriteNote({
            messageId: message.id,
            origin: attempt.action,
            instruction: attempt.action === 'instruction' ? attempt.instruction : undefined
          })
        ).requestId;
    }

    return requestId;
  }

  async function execute(attempt: Attempt) {
    const current = cache.get(atom);

    if (
      current?.pending ||
      (!['edit', 'activate'].includes(attempt.action) && readiness !== 'ready')
    )
      return;

    patch({
      pending: true,
      attempt,
      error: undefined,
      reviewed: false,
      reviewedEditBase: undefined
    });

    try {
      const requestId = await runAttempt(attempt);

      patch({
        attempt: undefined,
        mode: undefined,
        requestId,
        error: undefined,
        ...(attempt.action === 'edit' ? { pausedEdit: undefined } : {})
      });

      if (attempt.action === 'activate') onActive();
    } catch (error) {
      patch({ error });
    } finally {
      patch({ pending: false });
    }
  }

  function open(mode: Action) {
    if (canAct(mode)) {
      launcher.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      patch({
        mode,
        targetVersionId: versionId,
        targetText: version?.text ?? '',
        targetNumber: version?.number,
        text: version?.text ?? '',
        instruction: '',
        requestId: undefined,
        ...(mode === 'edit' ? draft.pausedEdit : {})
      });
    }
  }

  function editSnapshot(): EditDraft {
    return {
      targetVersionId: draft.targetVersionId ?? versionId,
      targetText: draft.targetText ?? version?.text ?? '',
      targetNumber: draft.targetNumber,
      text: draft.text
    };
  }

  function pauseEdit() {
    if (!draft.attempt) patch({ mode: undefined, pausedEdit: editSnapshot() });
  }

  function discardEdit() {
    if (!draft.attempt) patch({ mode: undefined, pausedEdit: undefined, error: undefined });
  }

  function prepareQuotedAsk(attempt: Attempt): AskInput | undefined {
    if (!selection.data || !draft.instruction.trim()) return undefined;

    return {
      noteId: message.noteId,
      threadRoot: message.threadRoot ?? undefined,
      expectedSelectionRevision: selection.data.revision,
      intentKey: crypto.randomUUID(),
      text: draft.instruction,
      instruction: JSON.stringify({
        targetMessageId: String(message.id),
        targetVersionId: String(attempt.versionId),
        targetText: draft.targetText
      }),
      preferences: cache.get(composerDraft(message.noteId))?.preferences ?? { language: locale }
    };
  }

  function submit() {
    if (!draft.mode || !version || !canAct(draft.mode)) return;

    const attempt: Attempt = {
      action: draft.mode,
      versionId: draft.targetVersionId ?? versionId,
      text: draft.text,
      instruction: draft.instruction
    };

    if (draft.mode === 'ask') {
      attempt.askInput = prepareQuotedAsk(attempt);

      if (!attempt.askInput) return;
    }

    if (draft.mode === 'edit') patch({ pausedEdit: editSnapshot() });

    void execute(attempt);
  }

  function editLatest() {
    if (
      !draft.reviewed ||
      !draft.reviewedEditBase ||
      draft.pending ||
      draft.attempt?.action !== 'edit'
    )
      return;

    patch({
      ...draft.reviewedEditBase,
      text: draft.attempt?.text ?? draft.text,
      mode: 'edit',
      attempt: undefined,
      pausedEdit: undefined,
      error: undefined,
      reviewed: false,
      reviewedEditBase: undefined
    });
  }

  async function review() {
    try {
      const latest = await rpc.notes.message.read({ id: message.id });
      const current = latest.versions.find((item) => item.id === latest.activeVersionId);

      patch({
        reviewed: true,
        reviewedEditBase:
          draft.attempt?.action === 'edit' && current
            ? {
                targetVersionId: current.id,
                targetNumber: current.number,
                targetText: current.text
              }
            : undefined
      });
    } catch (error) {
      patch({ error, reviewed: false });
    }
  }

  return {
    message,
    versionId,
    conversion,
    readiness,
    t,
    locale,
    cache,
    draft,
    editor,
    origin,
    launcher,
    patch,
    selection,
    version,
    active,
    blocked,
    execute,
    open,
    submit,
    pauseEdit,
    discardEdit,
    editLatest,
    review
  };
}
