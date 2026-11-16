import { chatMessageSchema } from '@study/contracts';
import { test } from '@study/testing';
import type * as Router from '@tanstack/react-router';
import { Schema } from 'effect';
import type { ReactNode } from 'react';

import type * as __MockType0 from '#client/lib/ai-readiness.ts';

import type * as __MockType1 from './failed-conversion';

let useAiReadiness: typeof __MockType0.useAiReadiness;

let FailedMessageConversion: typeof __MockType1.FailedMessageConversion;

let api: ReturnType<typeof createMockState>['api'];

const message = Schema.decodeUnknownSync(chatMessageSchema)({
  id: 2n,
  noteId: 1n,
  role: 'user',
  threadRoot: null,
  replyTo: null,
  activeVersionId: 3n,
  recordingId: null,
  recordingMs: null,
  recordedIn: null,
  createdAt: 1n,
  parts: [],
  citations: [],
  versions: [
    {
      id: 3n,
      number: 1n,
      origin: 'typed',
      status: 'complete',
      text: 'Original',
      basedOn: null,
      instruction: null,
      createdAt: 1n
    },
    {
      id: 4n,
      number: 2n,
      origin: 'convert',
      status: 'failed',
      text: '',
      basedOn: 3n,
      instruction: null,
      createdAt: 2n,
      generationRequestId: 'saved-conversion'
    }
  ]
});

let fixture: ReturnType<test.unit.Context['rpcHandlersTransport']>;

function Provider({ children }: { children: ReactNode }) {
  return <fixture.wrapper>{children}</fixture.wrapper>;
}

function createMockState(mock: test.Mock) {
  return {
    api: (() => ({
      snapshot: mock.fn(),
      convert: mock.fn(),
      discard: mock.fn()
    }))()
  };
}

test.unit.beforeEach(async ({ mock }) => {
  const __mockState = createMockState(mock);

  api = __mockState.api;

  mock('#client/lib/ai-readiness.ts', () => ({ useAiReadiness: mock.fn(() => 'ready') }));
  mock('@tanstack/react-router', async (load) => ({
    ...(await load<typeof Router>()),
    Link: ({ to, children }: { to: string; children?: ReactNode }) => <a href={to}>{children}</a>
  }));
  mock('#client/lib/i18n.tsx', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
  const __mockModule0 = await import('#client/lib/ai-readiness.ts');

  useAiReadiness = __mockModule0.useAiReadiness;
  const __mockModule1 = await import('./failed-conversion');

  FailedMessageConversion = __mockModule1.FailedMessageConversion;
});

test.unit.beforeEach(({ vi, rpcHandlersTransport }) => {
  vi.resetAllMocks();
  vi.mocked(useAiReadiness).mockReturnValue('ready');
  fixture = rpcHandlersTransport({
    'notes.replySnapshot': api.snapshot,
    'notes.convertMessage': api.convert,
    'notes.deleteMessageVersion': api.discard
  });
  api.snapshot.mockResolvedValue({
    requestId: 'saved-conversion',
    noteId: 1n,
    messageId: 2n,
    versionId: 4n,
    contextRevision: 1n,
    messages: [{ messageId: 2n, versionId: 3n, role: 'user', text: 'Original', attachments: [] }],
    generation: {
      origin: 'convert',
      instruction: null,
      conversion: { strategyId: 'saved-strategy', baseVersionId: 3n }
    }
  });
  api.convert.mockResolvedValue({
    requestId: 'new-conversion',
    noteId: 1n,
    messageId: 2n,
    versionId: 5n
  });
  api.discard.mockResolvedValue(message);
});
test.unit.afterEach(({ cleanup }) => {
  cleanup();
});

test.unit.stable.for(['retry', 'discard'] as const)(
  'exposes %s for a failed conversion without changing its original input',
  async (action, { render, expect, screen, waitFor, fireEvent }) => {
    render(
      <Provider>
        <FailedMessageConversion message={message} version={message.versions[1]} />
      </Provider>
    );
    expect(screen.getByText('NoteConversionFailed')).toBeVisible();
    const retry = screen.getByRole('button', { name: 'Retry' });

    await waitFor(() => expect(retry).toBeEnabled());
    fireEvent.click(
      action === 'retry' ? retry : screen.getByRole('button', { name: 'NoteDiscardConversion' })
    );
    await waitFor(() => {
      if (action === 'retry')
        expect(api.convert).toHaveBeenCalledWith({
          messageId: 2n,
          expectedActiveVersionId: 3n,
          strategyId: 'saved-strategy'
        });
      else expect(api.discard).toHaveBeenCalledWith({ messageId: 2n, versionId: 4n });
    });
  }
);

test.unit.stable(
  'keeps recovery retries blocked while another version has active work',
  async ({ render, waitFor, expect, screen }) => {
    const busy = Schema.decodeUnknownSync(chatMessageSchema)({
      ...message,
      versions: [
        ...message.versions,
        {
          id: 5n,
          number: 3n,
          origin: 'improve',
          status: 'pending',
          text: '',
          basedOn: 3n,
          instruction: null,
          createdAt: 3n
        }
      ]
    });

    render(
      <Provider>
        <FailedMessageConversion message={busy} version={busy.versions[1]} />
      </Provider>
    );
    await waitFor(() => expect(api.snapshot).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: 'Retry' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'NoteDiscardConversion' })).toBeEnabled();
  }
);

test.unit.stable(
  'blocks AI conversion recovery without setup while preserving discard',
  async ({ vi, render, waitFor, expect, screen, fireEvent }) => {
    vi.mocked(useAiReadiness).mockReturnValue('setup');
    render(
      <Provider>
        <FailedMessageConversion message={message} version={message.versions[1]} />
      </Provider>
    );
    await waitFor(() => expect(api.snapshot).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: 'Retry' })).toBeDisabled();
    expect(screen.getByText('AiReadinessSetup')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(api.convert).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'NoteDiscardConversion' }));
    await waitFor(() => expect(api.discard).toHaveBeenCalledWith({ messageId: 2n, versionId: 4n }));
  }
);
