import { StudyError } from '@study/contracts/errors';
import { annotationSchema } from '@study/contracts/materials/evidence';
import { testStable } from '@study/testing/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Schema } from 'effect';
import type { ReactNode } from 'react';
import { expect, vi, beforeEach } from 'vite-plus/test';

import { request } from '#web/lib/study-client/request.ts';

import { AnnotationControls } from './annotation-controls';
import type { AnnotationDraft } from './annotation-state';
import { savedDraft } from './annotation-state';

vi.mock('#web/lib/i18n.tsx', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('#web/lib/study-client/request.ts', () => ({ request: vi.fn() }));

const rawTarget = {
  materialId: 41n,
  range: { versionId: 101n, documentId: 1101n, blockId: 'b0', start: 0, end: 4 }
};

const annotation = Schema.decodeUnknownSync(annotationSchema)({
  id: 1n,
  revision: 1n,
  target: rawTarget,
  kind: 'note',
  note: 'Original',
  deleted: false,
  operation: 'create',
  evidence: {
    availability: 'unavailable',
    precision: 'unavailable',
    reason: 'version_pruned',
    reference: { kind: 'range', target: rawTarget }
  }
});

const target = annotation.target;

const rpc = {
  'materials.annotation': vi.fn(),
  'materials.updateAnnotation': vi.fn(),
  'materials.deleteAnnotation': vi.fn(),
  'materials.annotationHistory': vi.fn(),
  'materials.reanchorAnnotation': vi.fn(),
  'materials.resolveEvidence': vi.fn(),
  'materials.materialVersions': vi.fn(),
  'materials.materialVersion': vi.fn(),
  'materials.materialVersionDocument': vi.fn()
};

beforeEach(() => {
  vi.clearAllMocks();
  rpc['materials.materialVersions'].mockResolvedValue({ items: [], nextCursor: null });
  rpc['materials.materialVersion'].mockResolvedValue({ material_id: annotation.target.materialId });
  rpc['materials.materialVersionDocument'].mockResolvedValue(null);
  rpc['materials.resolveEvidence'].mockResolvedValue(annotation.evidence);
  rpc['materials.annotation'].mockResolvedValue(annotation);
  rpc['materials.annotationHistory'].mockResolvedValue({ items: [annotation], nextCursor: null });
  vi.mocked(request).mockImplementation((invoke) => invoke(rpc as never) as never);
});

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );

  return {
    ...render(<AnnotationControls annotation={annotation} />, { wrapper }),
    client,
    wrapper
  };
}

testStable('does not erase a newer draft when an older save completes', async () => {
  let finish!: (value: unknown) => void;

  rpc['materials.updateAnnotation'].mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    })
  );
  const user = userEvent.setup();

  mount();
  const field = screen.getByLabelText('DocumentAnnotationNote');

  await user.clear(field);
  await user.type(field, 'Submitted');
  await user.click(screen.getByText('DocumentSaveAnnotation'));
  await user.clear(field);
  await user.type(field, 'Newer edit');
  await act(async () =>
    finish({ outcome: 'saved', annotation: { ...annotation, revision: 2n, note: 'Submitted' } })
  );
  expect(field).toHaveValue('Newer edit');
  expect(rpc['materials.updateAnnotation']).toHaveBeenCalledWith({
    id: annotation.id,
    expectedRevision: 1n,
    note: 'Submitted',
    kind: 'note'
  });
});

testStable(
  'retains edits on conflict and requires explicit adoption before using the new revision',
  async () => {
    rpc['materials.updateAnnotation'].mockResolvedValue({
      outcome: 'conflict',
      current: { ...annotation, revision: 3n, note: 'Remote' },
      submitted: {}
    });
    const user = userEvent.setup();

    mount();
    await user.type(screen.getByLabelText('DocumentAnnotationNote'), ' local');
    await user.click(screen.getByText('DocumentSaveAnnotation'));
    await user.click(await screen.findByText('AnnotationUseRevision'));
    expect(screen.getByLabelText('DocumentAnnotationNote')).toHaveValue('Original local');
    await user.click(screen.getByText('DocumentSaveAnnotation'));
    expect(rpc['materials.updateAnnotation']).toHaveBeenLastCalledWith(
      expect.objectContaining({ expectedRevision: 3n, note: 'Original local' })
    );
  }
);

testStable(
  'retains per-client drafts across remount and isolates another query client',
  async () => {
    const user = userEvent.setup();
    const view = mount();

    await user.type(screen.getByLabelText('DocumentAnnotationNote'), ' retained');
    view.unmount();
    const again = render(<AnnotationControls annotation={annotation} />, { wrapper: view.wrapper });

    expect(screen.getByLabelText('DocumentAnnotationNote')).toHaveValue('Original retained');
    again.unmount();
    mount();
    expect(screen.getByLabelText('DocumentAnnotationNote')).toHaveValue('Original');
  }
);

testStable('blocks uncertain writes until a successful canonical revision refresh', async () => {
  rpc['materials.updateAnnotation'].mockRejectedValue(new StudyError('transient', 'lost'));
  const user = userEvent.setup();

  mount();
  await user.click(screen.getByText('DocumentSaveAnnotation'));
  await screen.findByText('AnnotationReconcile');
  expect(screen.getByText('DocumentSaveAnnotation')).toBeDisabled();
  rpc['materials.annotation'].mockResolvedValue({ ...annotation, revision: 2n });
  await user.click(screen.getByText('AnnotationRefreshRevision'));
  await user.click(await screen.findByRole('button', { name: 'AnnotationUseRevision' }));
  await waitFor(() => expect(screen.getByText('DocumentSaveAnnotation')).toBeEnabled());
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

    rpc['materials.deleteAnnotation'].mockResolvedValue({ outcome: 'saved', annotation: deleted });
    rpc['materials.annotationHistory'].mockImplementation(({ cursor }) =>
      Promise.resolve(
        cursor ? { items: [annotation], nextCursor: null } : { items: [deleted], nextCursor: 2n }
      )
    );
    const user = userEvent.setup();

    mount();
    expect(rpc['materials.deleteAnnotation']).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'AnnotationDelete' }));
    const dialog = await screen.findByRole('alertdialog');
    const confirm = within(dialog).getByRole('button', { name: 'AnnotationDelete' });

    expect(confirm).toBeDisabled();
    expect(rpc['materials.deleteAnnotation']).not.toHaveBeenCalled();
    await user.type(within(dialog).getByRole('textbox'), 'DeleteConfirmationWord');
    await user.click(confirm);
    await waitFor(() =>
      expect(rpc['materials.deleteAnnotation']).toHaveBeenCalledWith({
        id: annotation.id,
        expectedRevision: 1n
      })
    );
    await user.click(screen.getByText('AnnotationHistory'));
    await user.click(await screen.findByText('LibraryMore'));
    await waitFor(() =>
      expect(rpc['materials.annotationHistory']).toHaveBeenCalledWith({
        id: annotation.id,
        limit: 30,
        cursor: 2n
      })
    );
    expect(await screen.findByText(/AnnotationCreated/)).toBeInTheDocument();
    expect(screen.getByText('DocumentSaveAnnotation')).toBeDisabled();
  }
);

testStable(
  'commits the previewed exact target with the expected revision without saving unrelated note edits',
  async () => {
    const user = userEvent.setup();
    const view = mount();
    const next = { ...target, range: { ...target.range, start: 1, end: 3 } };

    rpc['materials.reanchorAnnotation'].mockResolvedValue({
      outcome: 'saved',
      annotation: { ...annotation, revision: 2n, operation: 'reanchor', target: next }
    });
    await user.type(screen.getByLabelText('DocumentAnnotationNote'), ' unsaved');
    act(() =>
      view.client.setQueryData(
        ['annotationDraft', String(annotation.id)],
        (old: AnnotationDraft) => ({ ...old, target: next })
      )
    );
    await user.click(screen.getByText('AnnotationReanchor'));
    await user.click(screen.getByText('AnnotationCommitTarget'));
    await waitFor(() =>
      expect(rpc['materials.reanchorAnnotation']).toHaveBeenCalledWith({
        id: annotation.id,
        expectedRevision: 1n,
        target: next
      })
    );
    expect(screen.getByLabelText('DocumentAnnotationNote')).toHaveValue('Original unsaved');
    expect(rpc['materials.updateAnnotation']).not.toHaveBeenCalled();
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
