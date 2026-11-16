import { StudyError } from '@study/contracts';
import { test } from '@study/testing';
import type { ReactNode } from 'react';

import type * as __MockType0 from '../document-editing/test-support';
import type * as __MockType1 from './annotation-target';

let authoredPage: typeof __MockType0.authoredPage;

let TargetPicker: typeof __MockType1.TargetPicker;

let EvidenceTarget: typeof __MockType1.EvidenceTarget;

function setup(handlers: Parameters<typeof test.rpcHandlersTransport>[0], child: ReactNode) {
  const harness = test.rpcHandlersTransport(handlers);

  return { ...test.render(<harness.wrapper>{child}</harness.wrapper>), ...harness };
}

test.beforeEach(async ({ mock }) => {
  mock('#client/lib/i18n.tsx', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
  const __mockModule0 = await import('../document-editing/test-support');

  authoredPage = __mockModule0.authoredPage;
  const __mockModule1 = await import('./annotation-target');

  TargetPicker = __mockModule1.TargetPicker;
  EvidenceTarget = __mockModule1.EvidenceTarget;
});

test.stable('selects one canonical block and rejects a split UTF-16 surrogate pair', async () => {
  const owner = authoredPage(41n, 'A😀BC', 101n);
  const doc = owner.version!;
  const pick = test.vi.fn();

  setup(
    {
      'pages.versions': () => Promise.resolve({ items: [], nextCursor: null }),
      'pages.version': () => Promise.resolve(doc)
    },
    <TargetPicker pageId={owner.id} initialVersion={doc.id} onPick={pick} />
  );
  await test.userEvent.setup().click(await test.screen.findByLabelText('PageBlock'));
  await test.userEvent.setup().click(await test.screen.findByRole('option', { name: '1 · A😀BC' }));
  const field = test.screen.getByLabelText<HTMLTextAreaElement>('PageSelectPassage');

  field.setSelectionRange(1, 2);
  test.fireEvent.select(field);
  test.expect(pick).toHaveBeenLastCalledWith(undefined);
  field.setSelectionRange(1, 3);
  test.fireEvent.select(field);
  test.expect(pick).toHaveBeenLastCalledWith({
    pageId: owner.id,
    range: {
      versionId: doc.id,
      snapshotId: doc.snapshotId,
      blockId: doc.document.blocks[0]!.id,
      start: 1,
      end: 3
    }
  });
  test.expect(test.screen.getByLabelText('AnnotationPreview')).toHaveTextContent('😀');
});

function retainedTarget() {
  const owner = authoredPage(41n, 'Retained private evidence', 101n);
  const version = owner.version!;
  const target = {
    pageId: owner.id,
    range: {
      versionId: version.id,
      snapshotId: version.snapshotId,
      blockId: version.document.blocks[0]!.id,
      start: 0,
      end: 8
    }
  };

  return { owner, version, target };
}

test.stable('a retained reference never follows a different document identity', async () => {
  const { version, target } = retainedTarget();

  setup(
    {
      'pages.version': async () => ({
        ...version,
        snapshotId: authoredPage(41n, 'Replacement', 102n).version!.snapshotId
      })
    },
    <EvidenceTarget preview reference={{ kind: 'range', target }} />
  );
  test.expect(await test.screen.findByText('ReaderUnavailable')).toBeVisible();
  test.expect(test.screen.queryByText('Retained private evidence')).toBeNull();
});

test.stable(
  'a mounted retained reference discards its body after a committed retirement hint',
  async () => {
    const { version, target } = retainedTarget();
    const read = test.vi.fn().mockResolvedValue(version);
    const view = setup(
      { 'pages.version': read },
      <EvidenceTarget preview reference={{ kind: 'range', target }} />
    );

    await test.screen.findByText('Retained');
    read.mockRejectedValue(new StudyError('not_found', 'Retired'));
    await test.act(() => view.notify());
    await test.waitFor(() => test.expect(test.screen.queryByText('Retained')).toBeNull());
    test.expect(await test.screen.findByText('ReaderUnavailable')).toBeVisible();
  }
);
