import { RegistryContext } from '@effect/atom-react';
import { StudyError, annotationSchema } from '@study/contracts';
import { test } from '@study/testing';
import { Schema } from 'effect';
import type { AtomRegistry } from 'effect/reactivity';
import type { ReactNode } from 'react';

import { readyVoiceStatus } from '#client/test/page-values.ts';

let AnnotationControls: typeof __MockType0.AnnotationControls;

let annotationDrafts: typeof __MockType1.annotationDrafts;

import type * as __MockType0 from './annotation-controls';
import type * as __MockType1 from './annotation-drafts';
import type { AnnotationDraft } from './annotation-state';
import type * as __MockType2 from './annotation-state';

let savedDraft: typeof __MockType2.savedDraft;

const rawTarget = {
  pageId: 41n,
  range: { versionId: 101n, snapshotId: 1101n, blockId: 'b0', start: 0, end: 4 }
};

const annotation = Schema.decodeUnknownSync(annotationSchema)({
  id: 1n,
  revision: 1n,
  target: rawTarget,
  kind: 'note',
  note: 'Original',
  deleted: false,
  operation: 'create'
});

const target = annotation.target;

function createRpc({ vi }: Pick<test.unit.Context, 'vi'>) {
  return {
    'voice.status': vi.fn().mockResolvedValue(readyVoiceStatus),
    'voice.transcribe': vi.fn(),
    'pages.annotation': vi.fn(),
    'pages.reviseAnnotation': vi.fn(),
    'pages.annotationHistory': vi.fn(),
    'pages.versions': vi.fn(),
    'pages.version': vi.fn()
  };
}

let rpc: ReturnType<typeof createRpc>;

let captureCancelled: () => void;

test.unit.beforeEach(async ({ mock, vi }) => {
  captureCancelled = vi.fn();
  mock('#client/lib/host.ts', () => ({
    microphoneAvailable: () => true,
    captureMicrophone: async () => ({ stop: async () => [0.4], cancel: captureCancelled })
  }));
  mock('#client/lib/i18n.tsx', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
  const __mockModule0 = await import('./annotation-controls');

  AnnotationControls = __mockModule0.AnnotationControls;
  const __mockModule1 = await import('./annotation-drafts');

  annotationDrafts = __mockModule1.annotationDrafts;
  const __mockModule2 = await import('./annotation-state');

  savedDraft = __mockModule2.savedDraft;
});

test.unit.beforeEach(({ vi }) => {
  rpc = createRpc({ vi });
  vi.clearAllMocks();
  rpc['pages.versions'].mockResolvedValue({ items: [], nextCursor: null });
  rpc['pages.version'].mockRejectedValue(new StudyError('not_found', 'Retired'));
  rpc['pages.annotation'].mockResolvedValue(annotation);
  rpc['pages.annotationHistory'].mockResolvedValue({ items: [annotation], nextCursor: null });
});

function mount({
  rpcHandlersTransport,
  render
}: Pick<test.unit.Context, 'rpcHandlersTransport' | 'render'>) {
  const harness = rpcHandlersTransport(rpc);
  let registry: AtomRegistry.AtomRegistry | undefined;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <harness.wrapper>
      <RegistryContext.Consumer>
        {(value) => {
          registry = value;

          return null;
        }}
      </RegistryContext.Consumer>
      {children}
    </harness.wrapper>
  );

  return {
    ...render(<AnnotationControls annotation={annotation} />, { wrapper }),
    wrapper,
    setDeleted(review: boolean) {
      if (!registry) throw new Error('Draft registry not mounted');

      const atom = annotationDrafts(annotation.id);
      const current = registry.get(atom);

      if (!current) throw new Error('Annotation draft not initialized');

      const deleted = { ...current.current, deleted: true };

      registry.set(
        atom,
        review ? { ...current, review: deleted } : { ...current, current: deleted }
      );
    },
    setTarget(target: AnnotationDraft['target']) {
      if (!registry) throw new Error('Draft registry not mounted');

      const atom = annotationDrafts(annotation.id);
      const current = registry.get(atom);

      if (!current) throw new Error('Annotation draft not initialized');

      registry.set(atom, { ...current, target });
    }
  };
}

test.unit.stable(
  'does not erase a newer draft when an older save completes',
  async ({ userEvent, screen, act, expect, rpcHandlersTransport, render }) => {
    let finish!: (value: unknown) => void;

    rpc['pages.reviseAnnotation'].mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    const user = userEvent.setup();

    mount({ rpcHandlersTransport, render });
    const field = screen.getByLabelText('PageAnnotationNote');

    await user.clear(field);
    await user.type(field, 'Submitted');
    await user.click(screen.getByText('PageSaveAnnotation'));
    await user.clear(field);
    await user.type(field, 'Newer edit');
    await act(async () =>
      finish({ outcome: 'saved', annotation: { ...annotation, revision: 2n, note: 'Submitted' } })
    );
    expect(field).toHaveValue('Newer edit');
    expect(rpc['pages.reviseAnnotation']).toHaveBeenCalledWith({
      id: annotation.id,
      expectedRevision: 1n,
      note: 'Submitted',
      kind: 'note',
      target,
      deleted: false
    });
  }
);

test.unit.stable(
  'retains edits on conflict and requires explicit adoption before using the new revision',
  async ({ userEvent, screen, expect, rpcHandlersTransport, render }) => {
    rpc['pages.reviseAnnotation'].mockResolvedValue({
      outcome: 'conflict',
      annotation: { ...annotation, revision: 3n, note: 'Remote' }
    });
    const user = userEvent.setup();

    mount({ rpcHandlersTransport, render });
    await user.type(screen.getByLabelText('PageAnnotationNote'), ' local');
    await user.click(screen.getByText('PageSaveAnnotation'));
    await user.click(await screen.findByText('AnnotationUseRevision'));
    expect(screen.getByLabelText('PageAnnotationNote')).toHaveValue('Original local');
    await user.click(screen.getByText('PageSaveAnnotation'));
    expect(rpc['pages.reviseAnnotation']).toHaveBeenLastCalledWith(
      expect.objectContaining({ expectedRevision: 3n, note: 'Original local' })
    );
  }
);

test.unit.stable(
  'retains drafts across caller remount and isolates another connection registry',
  async ({ userEvent, screen, expect, rpcHandlersTransport, render }) => {
    const user = userEvent.setup();
    const view = mount({ rpcHandlersTransport, render });

    await user.type(screen.getByLabelText('PageAnnotationNote'), ' retained');
    view.rerender(<></>);
    view.rerender(<AnnotationControls annotation={annotation} />);

    expect(screen.getByLabelText('PageAnnotationNote')).toHaveValue('Original retained');
    view.unmount();
    mount({ rpcHandlersTransport, render });
    expect(screen.getByLabelText('PageAnnotationNote')).toHaveValue('Original');
  }
);

test.unit.stable(
  'blocks uncertain writes until a successful canonical revision refresh',
  async ({ userEvent, screen, expect, waitFor, rpcHandlersTransport, render }) => {
    rpc['pages.reviseAnnotation'].mockRejectedValue(new StudyError('transient', 'lost'));
    const user = userEvent.setup();

    mount({ rpcHandlersTransport, render });
    await user.click(screen.getByText('PageSaveAnnotation'));
    await screen.findByText('AnnotationReconcile');
    expect(screen.getByText('PageSaveAnnotation')).toBeDisabled();
    rpc['pages.annotation'].mockResolvedValue({ ...annotation, revision: 2n });
    await user.click(screen.getByText('AnnotationRefreshRevision'));
    await user.click(await screen.findByRole('button', { name: 'AnnotationUseRevision' }));
    await waitFor(() => expect(screen.getByText('PageSaveAnnotation')).toBeEnabled());
  }
);

test.unit.stable(
  'keeps unsaved note edits while acknowledging reanchor or delete',
  ({ expect }) => {
    const draft = {
      current: annotation,
      generation: 2,
      note: 'Unsaved',
      kind: 'note' as const,
      pending: true,
      uncertain: false
    };

    expect(savedDraft(draft, -1, { ...annotation, revision: 2n })).toMatchObject({
      note: 'Unsaved',
      pending: false,
      current: { revision: 2n }
    });
  }
);

test.unit.stable(
  'deletes only after confirmation and keeps paginated deleted revisions accessible',
  async ({ userEvent, expect, screen, within, waitFor, rpcHandlersTransport, render }) => {
    const deleted = { ...annotation, revision: 2n, deleted: true, operation: 'delete' };

    rpc['pages.reviseAnnotation'].mockResolvedValue({ outcome: 'saved', annotation: deleted });
    rpc['pages.annotationHistory'].mockImplementation(({ limit }) =>
      Promise.resolve(
        limit > 30
          ? { items: [deleted, annotation], nextCursor: null }
          : { items: [deleted], nextCursor: 2n }
      )
    );
    const user = userEvent.setup();

    mount({ rpcHandlersTransport, render });
    expect(rpc['pages.reviseAnnotation']).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'AnnotationDelete' }));
    const dialog = await screen.findByRole('alertdialog');
    const confirm = within(dialog).getByRole('button', { name: 'AnnotationDelete' });

    expect(confirm).toBeDisabled();
    expect(rpc['pages.reviseAnnotation']).not.toHaveBeenCalled();
    await user.type(within(dialog).getByRole('textbox'), 'DeleteConfirmationWord');
    await user.click(confirm);
    await waitFor(() =>
      expect(rpc['pages.reviseAnnotation']).toHaveBeenCalledWith({
        id: annotation.id,
        expectedRevision: 1n,
        target,
        note: 'Original',
        kind: 'note',
        deleted: true
      })
    );
    await user.click(screen.getByText('AnnotationHistory'));
    await user.click(await screen.findByText('LibraryMore'));
    await waitFor(() =>
      expect(rpc['pages.annotationHistory']).toHaveBeenCalledWith({
        id: annotation.id,
        limit: 60,
        cursor: undefined
      })
    );
    expect(await screen.findByText(/AnnotationCreated/)).toBeInTheDocument();
    expect(screen.getByText('PageSaveAnnotation')).toBeDisabled();
  }
);

test.unit.stable(
  'commits the previewed exact target with the expected revision without saving unrelated note edits',
  async ({ userEvent, screen, act, waitFor, expect, rpcHandlersTransport, render }) => {
    const user = userEvent.setup();
    const view = mount({ rpcHandlersTransport, render });
    const next = { ...target, range: { ...target.range, start: 1, end: 3 } };

    rpc['pages.reviseAnnotation'].mockResolvedValue({
      outcome: 'saved',
      annotation: { ...annotation, revision: 2n, operation: 'reanchor', target: next }
    });
    await user.type(screen.getByLabelText('PageAnnotationNote'), ' unsaved');
    act(() => view.setTarget(next));
    await user.click(screen.getByText('AnnotationReanchor'));
    await user.click(screen.getByText('AnnotationCommitTarget'));
    await waitFor(() =>
      expect(rpc['pages.reviseAnnotation']).toHaveBeenCalledWith({
        id: annotation.id,
        expectedRevision: 1n,
        target: next,
        note: 'Original',
        kind: 'note',
        deleted: false
      })
    );
    expect(screen.getByLabelText('PageAnnotationNote')).toHaveValue('Original unsaved');
    expect(rpc['pages.reviseAnnotation']).toHaveBeenCalledTimes(1);
  }
);

test.unit.stable(
  'saving note content preserves an independently selected reanchor target',
  ({ expect }) => {
    const next = { ...target, range: { ...target.range, start: 1, end: 3 } };
    const draft = {
      current: annotation,
      generation: 4,
      note: 'Submitted',
      kind: 'note' as const,
      target: next,
      pending: true,
      uncertain: false
    };

    expect(savedDraft(draft, 4, { ...annotation, revision: 2n, note: 'Submitted' }).target).toEqual(
      next
    );
  }
);

for (const review of [false, true]) {
  test.unit.stable(
    `cancels dictation when ${review ? 'a reviewed revision' : 'the current annotation'} is deleted`,
    async ({ rpcHandlersTransport, render, screen, userEvent, act, expect, within }) => {
      const status = Promise.withResolvers<typeof readyVoiceStatus>();

      rpc['voice.status'].mockReturnValue(status.promise);
      const view = mount({ rpcHandlersTransport, render });

      expect(screen.getByLabelText('PageAnnotationNote')).toBeEnabled();
      await userEvent.click(screen.getByRole('button', { name: 'VoiceStart' }));
      const setup = within(await screen.findByRole('dialog', { name: 'VoiceSetupTitle' }));

      await act(async () => status.resolve(readyVoiceStatus));
      await userEvent.click(await setup.findByRole('button', { name: 'VoiceStart' }));
      await screen.findByRole('button', { name: 'VoiceStop' });
      act(() => view.setDeleted(review));
      expect(screen.getByLabelText('PageAnnotationNote')).toBeDisabled();
      expect(within(view.container).getByRole('button', { name: 'VoiceStart' })).toBeDisabled();
      expect(captureCancelled).toHaveBeenCalledOnce();
    }
  );
}

test.unit.stable(
  'saves a revised annotation only after its final dictation segment is inserted',
  async ({ rpcHandlersTransport, render, screen, userEvent, waitFor, act, expect, within }) => {
    const status = Promise.withResolvers<typeof readyVoiceStatus>();
    const recognition = Promise.withResolvers<{ text: string }>();

    rpc['voice.status'].mockReturnValue(status.promise);
    rpc['voice.transcribe'].mockReturnValue(recognition.promise);
    rpc['pages.reviseAnnotation'].mockResolvedValue({
      outcome: 'saved',
      annotation: { ...annotation, revision: 2n, operation: 'update', note: 'Original spoken' }
    });
    mount({ rpcHandlersTransport, render });
    const save = screen.getByRole('button', { name: 'PageSaveAnnotation' });

    const note = screen.getByLabelText('PageAnnotationNote');
    const deleteAction = screen.getByRole('button', { name: 'AnnotationDelete' });

    expect(save).toBeEnabled();
    await userEvent.click(note);
    await userEvent.keyboard('{End}');
    await userEvent.click(screen.getByRole('button', { name: 'VoiceStart' }));
    const setup = within(await screen.findByRole('dialog', { name: 'VoiceSetupTitle' }));

    await act(async () => status.resolve(readyVoiceStatus));
    await userEvent.click(await setup.findByRole('button', { name: 'VoiceStart' }));
    await userEvent.click(await screen.findByRole('button', { name: 'VoiceStop' }));
    await waitFor(() => expect(rpc['voice.transcribe']).toHaveBeenCalledOnce());
    expect(save).toBeDisabled();
    expect(deleteAction).toBeDisabled();
    await userEvent.click(deleteAction);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    await userEvent.click(save);
    expect(rpc['pages.reviseAnnotation']).not.toHaveBeenCalled();
    await act(async () => recognition.resolve({ text: 'spoken' }));
    await waitFor(() => expect(save).toBeEnabled());
    expect(deleteAction).toBeEnabled();
    expect(note).toHaveValue('Original spoken');
    await userEvent.click(save);
    await waitFor(() =>
      expect(rpc['pages.reviseAnnotation']).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ note: 'Original spoken' })
      )
    );
  }
);
