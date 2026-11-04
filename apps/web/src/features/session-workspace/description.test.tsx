import { chatMessageSchema } from '@study/contracts/conversations/schemas';
import { summarySchema as materialSummarySchema } from '@study/contracts/documents/schemas';
import { StudyError } from '@study/contracts/errors';
import { sourceKinds } from '@study/contracts/sources/sniff';
import { mediaSize } from '@study/localization';
import { testStable } from '@study/testing/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider
} from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Schema } from 'effect';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, vi } from 'vite-plus/test';

import { Description } from './description';
import { History } from './history';

const rpc = vi.hoisted(() => ({
  update: vi.fn(),
  thread: vi.fn(),
  citations: vi.fn(),
  selection: vi.fn(),
  material: vi.fn(),
  source: vi.fn()
}));

vi.mock('#web/lib/i18n.tsx', () => ({
  useI18n: () => ({ t: (key: string) => key, date: String, locale: 'english' })
}));
vi.mock('#web/lib/study-client/request.ts', () => ({
  request: (invoke: (client: Record<string, unknown>) => unknown) =>
    invoke({
      'conversations.updateMessageDescription': rpc.update,
      'conversations.thread': rpc.thread,
      'conversations.messageVersionCitations': rpc.citations,
      'conversations.sessionSelection': rpc.selection,
      'sources.source': rpc.source
    })
}));

const message = Schema.decodeUnknownSync(chatMessageSchema)({
  id: 71n,
  sessionId: 501n,
  format: 'document',
  description: 'Review before the exam',
  role: 'user',
  threadRoot: null,
  replyTo: null,
  activeVersionId: 81n,
  recordingId: null,
  recordingMs: null,
  recordedIn: null,
  createdAt: 1n,
  versions: [
    {
      id: 81n,
      number: 1n,
      origin: 'typed',
      status: 'complete',
      text: '# Linear algebra\n\nThis body preview is secondary.',
      basedOn: null,
      instruction: null,
      createdAt: 1n
    }
  ],
  parts: [],
  citations: []
});

const clients: QueryClient[] = [];

function mount(children: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });

  clients.push(client);

  return render(<QueryClientProvider client={client}>{children}</QueryClientProvider>);
}

async function openDescription() {
  mount(<Description message={message} />);
  fireEvent.click(screen.getByRole('button', { name: 'SessionDescriptionTitle' }));
  const dialog = await screen.findByRole('dialog', { name: 'SessionDescriptionTitle' });

  return {
    dialog,
    input: within(dialog).getByRole('textbox', { name: 'SessionDescriptionLabel' })
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  rpc.update.mockResolvedValue(message);
  rpc.thread.mockResolvedValue({ items: [message], next: null });
  rpc.citations.mockResolvedValue({ citations: [] });
  rpc.selection.mockResolvedValue({ revision: 1n, targets: [] });
});

afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
});

testStable(
  'saves trimmed descriptions against their original value and closes after success',
  async () => {
    const { dialog, input } = await openDescription();

    expect(input).toHaveValue(message.description);
    fireEvent.change(input, { target: { value: '  Focus on eigenvectors  ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(rpc.update).toHaveBeenCalledExactlyOnceWith({
        messageId: message.id,
        description: 'Focus on eigenvectors',
        expectedDescription: message.description
      })
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  }
);

testStable('keeps the entered description and shows an error when a save fails', async () => {
  rpc.update.mockRejectedValue(new StudyError('transient', 'Save unavailable'));
  const { dialog, input } = await openDescription();

  fireEvent.change(input, { target: { value: 'Keep this draft' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
  expect(await within(dialog).findByRole('alert')).toBeVisible();
  expect(input).toHaveValue('Keep this draft');
  expect(within(dialog).getByRole('button', { name: 'Save' })).toBeEnabled();
  expect(rpc.update).toHaveBeenCalledTimes(1);
});

testStable('clears a saved description when the field contains only whitespace', async () => {
  const { dialog, input } = await openDescription();

  fireEvent.change(input, { target: { value: '   ' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
  await waitFor(() =>
    expect(rpc.update).toHaveBeenCalledExactlyOnceWith({
      messageId: message.id,
      description: null,
      expectedDescription: message.description
    })
  );
});

testStable(
  'shows the stored description on the document card and opens the original message',
  async () => {
    const onOpen = vi.fn();

    const view = mount(<History id={message.sessionId} onOpen={onOpen} />);
    const description = await screen.findByText('Review before the exam');

    expect(description).toBeVisible();
    expect(screen.queryByText('This body preview is secondary.')).toBeNull();
    fireEvent.click(
      within(view.container.querySelector('.session-index-target')!).getByRole('button', {
        name: /Linear algebra/
      })
    );
    expect(onOpen).toHaveBeenCalledExactlyOnceWith(message);
  }
);

testStable.each(['text', undefined] as const)(
  'keeps %s quick captures as literal text rather than document cards',
  async (format) => {
    const literal = '# A quick thought **with stars** and [a link](https://example.com)';
    const quick = Schema.decodeUnknownSync(chatMessageSchema)({
      ...message,
      format,
      description: null,
      versions: [{ ...message.versions[0], text: literal }]
    });
    const onOpen = vi.fn();

    rpc.thread.mockResolvedValue({ items: [quick], next: null });
    const view = mount(<History id={message.sessionId} onOpen={onOpen} />);

    expect(
      await within(view.container.querySelector('.session-history')!).findByText(literal)
    ).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'A quick thought' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'a link' })).toBeNull();
    expect(view.container.querySelector('.session-desk-document')).toBeNull();
    expect(screen.queryByRole('button', { name: 'SessionOpenPage' })).toBeNull();
    expect(onOpen).not.toHaveBeenCalled();
  }
);

testStable(
  'shows a linked attachment card with kind and size for every canonical source kind',
  async () => {
    const attached = Schema.decodeUnknownSync(chatMessageSchema)({
      ...message,
      format: 'text',
      parts: sourceKinds.map((kind, index) => ({
        id: BigInt(index + 1),
        sourceId: BigInt(index + 100),
        sourceName: `Attached ${kind}`,
        sourceKind: kind
      }))
    });

    rpc.thread.mockResolvedValue({ items: [attached], next: null });
    rpc.material.mockImplementation(({ sourceId }: { sourceId: bigint }) =>
      Promise.resolve({ id: sourceId + 1000n })
    );
    rpc.source.mockImplementation(async ({ id }: { id: bigint }) => ({
      id,
      name: `Source ${id}`,
      sizeBytes: 2048n
    }));
    const root = createRootRoute({
      component: () => <History id={message.sessionId} onOpen={vi.fn()} />
    });
    const router = createRouter({
      routeTree: root,
      history: createMemoryHistory({ initialEntries: ['/'] })
    });

    mount(<RouterProvider router={router} />);

    for (const [index, kind] of sourceKinds.entries()) {
      const link = await screen.findByRole('link', { name: new RegExp(`Attached ${kind}`) });

      expect(link).toHaveAttribute('href', `/sources/${index + 100}`);
      expect(
        await within(link).findByText(
          `Source${kind[0]!.toUpperCase()}${kind.slice(1)} · ${mediaSize('english', 2048)}`
        )
      ).toBeVisible();
      expect(link.querySelector('svg')).not.toBeNull();
    }

    expect(screen.getAllByRole('link')).toHaveLength(sourceKinds.length);
  }
);

testStable(
  'places real document attachments in time order alongside plain notes and opens their material',
  async () => {
    const material = Schema.decodeUnknownSync(materialSummarySchema)({
      id: 90n,
      projectIds: [],
      title: 'Working document',
      description: 'A real editable attachment',
      createdAt: 2n,
      updatedAt: 2n,
      archivedAt: null,
      headVersionId: 100n
    });
    const earlier = {
      ...message,
      format: 'text' as const,
      versions: [{ ...message.versions[0]!, text: 'Before the document' }]
    };
    const later = {
      ...earlier,
      id: Schema.decodeUnknownSync(chatMessageSchema)({ ...message, id: 72n }).id,
      createdAt: 3n,
      versions: [{ ...message.versions[0]!, text: 'After the document' }]
    };

    rpc.thread.mockResolvedValue({ items: [later, earlier], next: null });
    const open = vi.fn();
    const view = mount(
      <History id={message.sessionId} documents={[material]} onOpenDocument={open} />
    );

    await within(view.container.querySelector('.session-history')!).findByText(
      'Before the document'
    );
    const items = view.container.querySelectorAll('.session-entry, .session-desk-document');

    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent('Before the document');
    expect(items[1]).toHaveTextContent('Working document');
    expect(items[2]).toHaveTextContent('After the document');
    fireEvent.click(
      within(items[1]!.closest('.session-index-target')!).getByRole('button', {
        name: /Working document/
      })
    );
    expect(open).toHaveBeenCalledExactlyOnceWith(material);
  }
);
