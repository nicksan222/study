import { RegistryContext } from '@effect/atom-react';
import { StudyError, annotationSchema } from '@study/contracts';
import { testStable } from '@study/testing/vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Schema } from 'effect';
import type { AtomRegistry } from 'effect/reactivity';
import type { ReactNode } from 'react';
import { expect, vi, beforeEach } from 'vite-plus/test';

import { rpcHandlersTransport } from '#client/test/rpc.tsx';

import { AnnotationControls } from './annotation-controls';
import { annotationDrafts } from './annotation-drafts';
import type { AnnotationDraft } from './annotation-state';
import { savedDraft } from './annotation-state';

vi.mock('#client/lib/i18n.tsx', () => ({ useI18n: () => ({ t: (key: string) => key }) }));

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

const rpc = {
  'pages.annotation': vi.fn(),
  'pages.reviseAnnotation': vi.fn(),
  'pages.annotationHistory': vi.fn(),
  'pages.versions': vi.fn(),
  'pages.version': vi.fn()
};

beforeEach(() => {
  vi.clearAllMocks();
  rpc['pages.versions'].mockResolvedValue({ items: [], nextCursor: null });
  rpc['pages.version'].mockRejectedValue(new StudyError('not_found', 'Retired'));
  rpc['pages.annotation'].mockResolvedValue(annotation);
  rpc['pages.annotationHistory'].mockResolvedValue({ items: [annotation], nextCursor: null });
});

function mount() {
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
    setTarget(target: AnnotationDraft['target']) {
      if (!registry) throw new Error('Draft registry not mounted');

      const atom = annotationDrafts(annotation.id);
      const current = registry.get(atom);

      if (!current) throw new Error('Annotation draft not initialized');

      registry.set(atom, { ...current, target });
    }
  };
}

testStable('does not erase a newer draft when an older save completes', async () => {
  let finish!: (value: unknown) => void;

  rpc['pages.reviseAnnotation'].mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    })
  );
  const user = userEvent.setup();

  mount();
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
});

testStable(
  'retains edits on conflict and requires explicit adoption before using the new revision',
  async () => {
    rpc['pages.reviseAnnotation'].mockResolvedValue({
      outcome: 'conflict',
      annotation: { ...annotation, revision: 3n, note: 'Remote' }
    });
    const user = userEvent.setup();

    mount();
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

testStable(
  'retains drafts across caller remount and isolates another connection registry',
  async () => {
    const user = userEvent.setup();
    const view = mount();

    await user.type(screen.getByLabelText('PageAnnotationNote'), ' retained');
    view.rerender(<></>);
    view.rerender(<AnnotationControls annotation={annotation} />);

    expect(screen.getByLabelText('PageAnnotationNote')).toHaveValue('Original retained');
    view.unmount();
    mount();
    expect(screen.getByLabelText('PageAnnotationNote')).toHaveValue('Original');
  }
);

testStable('blocks uncertain writes until a successful canonical revision refresh', async () => {
  rpc['pages.reviseAnnotation'].mockRejectedValue(new StudyError('transient', 'lost'));
  const user = userEvent.setup();

  mount();
  await user.click(screen.getByText('PageSaveAnnotation'));
  await screen.findByText('AnnotationReconcile');
  expect(screen.getByText('PageSaveAnnotation')).toBeDisabled();
  rpc['pages.annotation'].mockResolvedValue({ ...annotation, revision: 2n });
  await user.click(screen.getByText('AnnotationRefreshRevision'));
  await user.click(await screen.findByRole('button', { name: 'AnnotationUseRevision' }));
  await waitFor(() => expect(screen.getByText('PageSaveAnnotation')).toBeEnabled());
});

testStable('keeps unsaved note edits while acknowledging reanchor or delete', () => {
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
});

testStable(
  'deletes only after confirmation and keeps paginated deleted revisions accessible',
  async () => {
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

    mount();
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

testStable(
  'commits the previewed exact target with the expected revision without saving unrelated note edits',
  async () => {
    const user = userEvent.setup();
    const view = mount();
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

testStable('saving note content preserves an independently selected reanchor target', () => {
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
});
