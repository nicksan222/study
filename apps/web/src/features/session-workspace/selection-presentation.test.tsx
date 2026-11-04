import { sessionSelectionTargetSchema } from '@study/contracts/conversations/context';
import { sessionIdSchema } from '@study/contracts/ids';
import { testStable } from '@study/testing/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Effect, Schema } from 'effect';
import { afterEach, expect, vi } from 'vite-plus/test';

import { runRequest } from '#web/lib/effect/runtime.ts';
import type { StudyClient } from '#web/lib/study-client/client.ts';
import { toStudyError } from '#web/lib/study-client/errors.ts';
import { request } from '#web/lib/study-client/request.ts';

import { authoredDocument } from '../document-editing/test-support';
import { SelectedTarget, SelectionContent, SelectionPanel } from './selection';

vi.mock('#web/lib/i18n.tsx', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('#web/lib/study-client/request.ts', () => ({ request: vi.fn() }));

const original = authoredDocument(31n, 'Keep selected outside', 41n);

const exact = original.version!;

const target = Schema.decodeUnknownSync(sessionSelectionTargetSchema)({
  input: { kind: 'document', versionId: exact.id },
  scope: { kind: 'ranges', ranges: [{ blockId: exact.document.blocks[0]!.id, start: 5, end: 13 }] }
});

const clients: QueryClient[] = [];

function mount(owner = { ...original, title: 'Mechanics' }) {
  const rpc = {
    'documents.version': vi
      .fn<StudyClient['documents.version']>()
      .mockReturnValue(Effect.succeed(exact)),
    'documents.document': vi
      .fn<StudyClient['documents.document']>()
      .mockReturnValue(Effect.succeed(owner))
  };

  vi.mocked(request).mockImplementation((invoke, signal) =>
    runRequest(invoke(rpc as unknown as StudyClient).pipe(Effect.mapError(toStudyError)), signal)
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <SelectedTarget target={target} />
    </QueryClientProvider>
  );

  return { client, rpc };
}

afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  vi.resetAllMocks();
});
testStable(
  'labels the retained authored version and excerpts only its selected range',
  async () => {
    const { rpc } = mount();

    expect(await screen.findByText('Mechanics')).toBeVisible();
    expect(await screen.findByText('selected')).toBeVisible();
    expect(
      screen.getByText(
        `ReaderVersion ${exact.number} · SessionRanges · SessionSelectionPassageCount`
      )
    ).toBeVisible();
    expect(rpc['documents.version']).toHaveBeenCalledExactlyOnceWith({ id: exact.id });
    expect(screen.queryByText('Keep selected outside')).toBeNull();
  }
);
testStable('does not display excerpts under a different authored owner identity', async () => {
  mount(authoredDocument(32n, 'Different owner', 52n));
  expect(await screen.findByText('SessionReadUnavailable')).toBeVisible();
  expect(screen.queryByText('selected')).toBeNull();
});
testStable(
  'updates the catalog title without replacing retained content with the current authored version',
  async () => {
    const { client, rpc } = mount({ ...original, title: 'Old catalog title' });

    expect(await screen.findByText('selected')).toBeVisible();
    expect(await screen.findByText('Old catalog title')).toBeVisible();
    rpc['documents.document'].mockReturnValue(
      Effect.succeed({
        ...authoredDocument(31n, 'Latest replacement content', 99n),
        title: 'Renamed catalog title'
      })
    );
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['documents'] });
    });
    expect(await screen.findByText('Renamed catalog title')).toBeVisible();
    expect(screen.getByText('selected')).toBeVisible();
    expect(screen.queryByText('Latest replacement content')).toBeNull();
    expect(rpc['documents.version'].mock.calls.every(([input]) => input.id === exact.id)).toBe(
      true
    );
  }
);

testStable('keeps the full selected content behind a native disclosure', async () => {
  const user = userEvent.setup();

  mount();
  expect(await screen.findByText('selected')).toBeVisible();
  const disclosure = screen.getByText('SessionSelectionReadContent');

  await user.click(disclosure);
  expect(disclosure.closest('details')).toHaveAttribute('open');
  expect(screen.getAllByText('selected')).toHaveLength(2);
  expect(screen.queryByText('Keep selected outside')).toBeNull();
});

function mountContent(selected?: typeof sessionSelectionTargetSchema.Type) {
  const change = vi.fn();
  const first = exact.document.blocks[0]!;
  const content = {
    name: 'Mechanics',
    document: {
      ...exact.document,
      blocks: Array.from({ length: 5 }, (_, index) => ({
        ...first,
        id: `b${index}` as typeof first.id,
        text: index === 0 ? 'Keep selected outside' : `Block ${index + 1}`
      }))
    }
  };

  render(
    <SelectionContent
      input={target.input}
      selected={selected}
      disabled={false}
      change={change}
      content={content}
    />
  );

  return { change, content };
}

testStable('shows a short block list and lets keyboard users reveal the rest', async () => {
  const user = userEvent.setup();

  mountContent();
  expect(screen.getAllByRole('checkbox')).toHaveLength(3);
  const more = screen.getByRole('button', { name: 'SessionSelectionAllBlocks' });

  more.focus();
  await user.keyboard('{Enter}');
  expect(more).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getAllByRole('checkbox')).toHaveLength(5);
  await user.click(screen.getByRole('button', { name: 'SessionSelectionFewerBlocks' }));
  expect(screen.getAllByRole('checkbox')).toHaveLength(3);
});

testStable(
  'unchecking the final selected block removes the target instead of keeping it checked',
  async () => {
    const user = userEvent.setup();
    const selected = Schema.decodeUnknownSync(sessionSelectionTargetSchema)({
      ...target,
      scope: { kind: 'blocks', blockIds: ['b0'] }
    });
    const { change } = mountContent(selected);
    const block = screen.getByRole('checkbox', { name: '1 · Keep selected outside' });

    expect(block).toBeChecked();
    await user.click(block);
    expect(change).toHaveBeenCalledExactlyOnceWith(selected, true);
  }
);

testStable(
  'requires an explicit action before replacing the scope with a highlighted passage',
  async () => {
    const user = userEvent.setup();
    const { change } = mountContent();

    await user.click(screen.getByText('SessionSelectionChoosePassage'));
    await user.click(screen.getByRole('combobox', { name: 'DocumentBlock' }));
    await user.click(await screen.findByRole('option', { name: '1 · Keep selected outside' }));
    const text = screen.getByRole('textbox', {
      name: 'DocumentSelectPassage'
    }) as HTMLTextAreaElement;

    text.focus();
    text.setSelectionRange(5, 13);
    fireEvent.select(text);
    expect(change).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'SessionUseRange' }));
    expect(change).toHaveBeenCalledExactlyOnceWith({
      input: target.input,
      scope: { kind: 'ranges', ranges: [{ blockId: 'b0', start: 5, end: 13 }] }
    });
  }
);

testStable('keeps selected blocks visible when they are beyond the initial preview', () => {
  const selected = Schema.decodeUnknownSync(sessionSelectionTargetSchema)({
    ...target,
    scope: { kind: 'blocks', blockIds: ['b4'] }
  });

  mountContent(selected);
  expect(screen.getByRole('checkbox', { name: '5 · Block 5' })).toBeChecked();
  expect(screen.queryByRole('checkbox', { name: '4 · Block 4' })).toBeNull();
});

function mountEmptyPanel(pending = false) {
  const rpc = {
    'conversations.sessionSelection': () =>
      pending ? Effect.never : Effect.succeed({ revision: 1n, targets: [] }),
    'documents.documents': () =>
      pending ? Effect.never : Effect.succeed({ items: [], nextCursor: null }),
    'sources.sources': () => (pending ? Effect.never : Effect.succeed({ items: [], next: null }))
  };

  vi.mocked(request).mockImplementation((invoke, signal) =>
    runRequest(invoke(rpc as unknown as StudyClient).pipe(Effect.mapError(toStudyError)), signal)
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <SelectionPanel id={Schema.decodeUnknownSync(sessionIdSchema)(1n)} />
    </QueryClientProvider>
  );
}

testStable(
  'explains how to start with an empty selection and distinguishes an empty search',
  async () => {
    const user = userEvent.setup();

    mountEmptyPanel();
    expect(await screen.findByText('SessionSelectionEmptyTitle')).toBeVisible();
    expect(await screen.findByText('SessionSelectionLibraryEmpty')).toBeVisible();
    expect(screen.getByRole('button', { name: 'SessionSaveSelection' })).toBeDisabled();
    expect(screen.queryByText('SessionSelectionUnsaved')).toBeNull();
    await user.type(screen.getByRole('searchbox', { name: 'SessionSearchMaterial' }), 'mechanics');
    expect(await screen.findByText('SessionSelectionNoMatches')).toBeVisible();
  }
);

testStable('does not present pending reads as an empty selection or library', () => {
  mountEmptyPanel(true);
  expect(screen.getAllByText('LoadingStudy')).toHaveLength(2);
  expect(screen.queryByText('SessionSelectionEmptyTitle')).toBeNull();
  expect(screen.queryByText('SessionSelectionLibraryEmpty')).toBeNull();
});
