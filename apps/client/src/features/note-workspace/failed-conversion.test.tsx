import { chatMessageSchema } from '@study/contracts';
import { test } from '@study/testing';
import type * as Router from '@tanstack/react-router';
import { Schema } from 'effect';
import type { ReactNode } from 'react';

import { useAiReadiness } from '#client/lib/ai-readiness.ts';

import { FailedMessageConversion } from './failed-conversion';

test.mock('#client/lib/ai-readiness.ts', () => ({ useAiReadiness: test.vi.fn(() => 'ready') }));
test.mock('@tanstack/react-router', async (load) => ({
  ...(await load<typeof Router>()),
  Link: ({ to, children }: { to: string; children?: ReactNode }) => <a href={to}>{children}</a>
}));

const api = test.hoisted(() => ({
  snapshot: test.vi.fn(),
  convert: test.vi.fn(),
  discard: test.vi.fn()
}));

test.mock('#client/lib/i18n.tsx', () => ({ useI18n: () => ({ t: (key: string) => key }) }));

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

let fixture: ReturnType<typeof test.rpcHandlersTransport>;

function Provider({ children }: { children: ReactNode }) {
  return <fixture.wrapper>{children}</fixture.wrapper>;
}

test.beforeEach(() => {
  test.vi.resetAllMocks();
  test.vi.mocked(useAiReadiness).mockReturnValue('ready');
  fixture = test.rpcHandlersTransport({
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
test.afterEach(() => {
  test.cleanup();
});

test.stable.each(['retry', 'discard'] as const)(
  'exposes %s for a failed conversion without changing its original input',
  async (action) => {
    test.render(
      <Provider>
        <FailedMessageConversion message={message} version={message.versions[1]} />
      </Provider>
    );
    test.expect(test.screen.getByText('NoteConversionFailed')).toBeVisible();
    const retry = test.screen.getByRole('button', { name: 'Retry' });

    await test.waitFor(() => test.expect(retry).toBeEnabled());
    test.fireEvent.click(
      action === 'retry'
        ? retry
        : test.screen.getByRole('button', { name: 'NoteDiscardConversion' })
    );
    await test.waitFor(() => {
      if (action === 'retry')
        test.expect(api.convert).toHaveBeenCalledWith({
          messageId: 2n,
          expectedActiveVersionId: 3n,
          strategyId: 'saved-strategy'
        });
      else test.expect(api.discard).toHaveBeenCalledWith({ messageId: 2n, versionId: 4n });
    });
  }
);

test.stable('keeps recovery retries blocked while another version has active work', async () => {
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

  test.render(
    <Provider>
      <FailedMessageConversion message={busy} version={busy.versions[1]} />
    </Provider>
  );
  await test.waitFor(() => test.expect(api.snapshot).toHaveBeenCalled());
  test.expect(test.screen.getByRole('button', { name: 'Retry' })).toBeDisabled();
  test.expect(test.screen.getByRole('button', { name: 'NoteDiscardConversion' })).toBeEnabled();
});

test.stable('blocks AI conversion recovery without setup while preserving discard', async () => {
  test.vi.mocked(useAiReadiness).mockReturnValue('setup');
  test.render(
    <Provider>
      <FailedMessageConversion message={message} version={message.versions[1]} />
    </Provider>
  );
  await test.waitFor(() => test.expect(api.snapshot).toHaveBeenCalled());
  test.expect(test.screen.getByRole('button', { name: 'Retry' })).toBeDisabled();
  test.expect(test.screen.getByText('AiReadinessSetup')).toBeVisible();
  test.fireEvent.click(test.screen.getByRole('button', { name: 'Retry' }));
  test.expect(api.convert).not.toHaveBeenCalled();
  test.fireEvent.click(test.screen.getByRole('button', { name: 'NoteDiscardConversion' }));
  await test.waitFor(() =>
    test.expect(api.discard).toHaveBeenCalledWith({ messageId: 2n, versionId: 4n })
  );
});
