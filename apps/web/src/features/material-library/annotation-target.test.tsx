import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { expect, it, vi } from 'vite-plus/test';

import { request } from '../../lib/study-client/request';
import { TargetPicker, EvidenceTarget } from './annotation-target';
import { exactDocument, importedVersion } from './test/support';
vi.mock('../../lib/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('../../lib/study-client/request', () => ({ request: vi.fn() }));
function setup(rpc: object, child: ReactNode) {
  vi.mocked(request).mockImplementation((invoke) => invoke(rpc as never) as never);
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {child}
    </QueryClientProvider>
  );
}
it('selects one canonical block and rejects a split UTF-16 surrogate pair', async () => {
  const owner = importedVersion();
  const doc = exactDocument(101n, 'A😀BC');
  const pick = vi.fn();
  setup(
    {
      'materials.materialVersions': () => Promise.resolve({ items: [], nextCursor: null }),
      'materials.materialVersion': () => Promise.resolve(owner),
      'materials.materialVersionDocument': () => Promise.resolve(doc)
    },
    <TargetPicker materialId={owner.material_id} initialVersion={owner.id} onPick={pick} />
  );
  await userEvent.setup().click(await screen.findByLabelText('DocumentBlock'));
  await userEvent.setup().click(await screen.findByRole('option', { name: '1 · A😀BC' }));
  const field = screen.getByLabelText('DocumentSelectPassage') as HTMLTextAreaElement;
  field.setSelectionRange(1, 2);
  fireEvent.select(field);
  expect(pick).toHaveBeenLastCalledWith(undefined);
  field.setSelectionRange(1, 3);
  fireEvent.select(field);
  expect(pick).toHaveBeenLastCalledWith({
    materialId: owner.material_id,
    range: { versionId: owner.id, documentId: doc.id, blockId: 'b0', start: 1, end: 3 }
  });
  expect(screen.getByLabelText('AnnotationPreview')).toHaveTextContent('😀');
});
it('does not show current text when retained document identity differs', async () => {
  const owner = importedVersion();
  const target = {
    materialId: owner.material_id,
    range: { versionId: owner.id, documentId: exactDocument().id, blockId: 'b0', start: 0, end: 4 }
  };
  const read = vi.fn().mockResolvedValue(exactDocument(102n, 'Wrong current text'));
  setup(
    {
      'materials.resolveEvidence': () =>
        Promise.resolve({ availability: 'available', precision: 'exact' }),
      'materials.materialVersion': () => Promise.resolve(owner),
      'materials.materialVersionDocument': read
    },
    <EvidenceTarget reference={{ kind: 'range', target }} />
  );
  await userEvent.setup().click(screen.getByText('AnnotationOpenTarget'));
  await waitFor(() => expect(read).toHaveBeenCalledWith({ id: owner.id }));
  expect(await screen.findByText('ReaderUnavailable')).toBeInTheDocument();
  expect(screen.queryByText('Wrong current text')).not.toBeInTheDocument();
});
