import { noteIdSchema } from '@study/contracts/ids';
import { testStable } from '@study/testing/vitest';
import { AttachmentPreview } from '@study/ui/attachment-preview';
import { WorkspaceDeskSurface as Desk } from '@study/ui/workspace-desk';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, vi } from 'vite-plus/test';

import { AttachmentPicker, AttachmentTray } from './attachments';
import { attachmentKey } from './attachments.queries';
import type { Attachment } from './attachments.queries';

vi.mock('#web/lib/i18n.tsx', () => ({
  useI18n: () => ({ t: (key: string) => key, locale: 'english' })
}));

const id = noteIdSchema.make(14n);

const clients: QueryClient[] = [];

function mount(entry: Attachment) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  clients.push(client);
  client.setQueryData(attachmentKey(id), [entry]);

  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <AttachmentTray id={id} blocked={false} />
        <AttachmentPicker id={id} blocked={false} />
      </QueryClientProvider>
    )
  };
}

afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  vi.unstubAllGlobals();
});

testStable(
  'keeps ready files in a separate compact tray with an accessible icon remove action',
  async () => {
    const file = new File(['notes'], 'A very long document filename.pdf', {
      type: 'application/pdf'
    });
    const view = mount({ key: 'file', file, state: 'ready' });
    const tray = screen.getByRole('list', { name: 'NoteAttachments' });

    expect(tray).toContainElement(screen.getByText(file.name));
    expect(screen.getByText(file.name)).toHaveAttribute('title', file.name);
    expect(screen.getByRole('status')).toHaveTextContent('NoteFileAccepted');
    expect(tray).not.toContainElement(screen.getByLabelText('NoteAttachFiles'));
    const remove = screen.getByRole('button', { name: 'NoteRemoveAttachment' });

    expect(remove.textContent).toBe('');
    fireEvent.click(remove);
    await waitFor(() => expect(view.client.getQueryData(attachmentKey(id))).toEqual([]));
    expect(screen.queryByRole('list')).toBeNull();
  }
);

testStable('shows uploading state without offering an unsafe in-flight removal', () => {
  mount({ key: 'pending', file: new File(['notes'], 'notes.txt'), state: 'uploading' });
  expect(screen.getByRole('status')).toHaveTextContent('NoteUploading');
  expect(screen.queryByRole('button', { name: 'NoteRemoveAttachment' })).toBeNull();
});

testStable(
  'keeps uncertain upload guidance and requires the acknowledgement action instead of retrying',
  () => {
    mount({ key: 'uncertain', file: new File(['notes'], 'notes.txt'), state: 'uncertain' });
    expect(screen.getByText('NoteUploadUncertain')).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('NoteUploadUnconfirmed');
    expect(screen.getByRole('button', { name: 'NoteUploadAcknowledge' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  }
);

testStable(
  'uses a local image preview and releases its URL when the attachment is removed',
  async () => {
    const createObjectURL = vi.fn(() => 'blob:local-preview');
    const revokeObjectURL = vi.fn();

    vi.stubGlobal(
      'URL',
      class extends URL {
        static createObjectURL = createObjectURL;
        static revokeObjectURL = revokeObjectURL;
      }
    );
    const file = new File(['image'], 'image.png', { type: 'image/png' });
    const view = mount({ key: 'image', file, state: 'ready' });

    await waitFor(() =>
      expect(view.container.querySelector('img')).toHaveAttribute('src', 'blob:local-preview')
    );
    expect(createObjectURL).toHaveBeenCalledWith(file);
    fireEvent.click(screen.getByRole('button', { name: 'NoteRemoveAttachment' }));
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:local-preview'));
  }
);

testStable.each([
  ['audio', 'audio/mpeg'],
  ['video', 'video/mp4']
] as const)('uses native %s controls outside the attachment navigation link', (kind, mime) => {
  const view = render(
    <Desk.AttachmentCard
      name="Lecture"
      meta="Attached"
      icon={null}
      href="/reader"
      preview={<AttachmentPreview kind={kind} src="blob:local-media" mime={mime} label="Lecture" />}
    />
  );
  const player = view.container.querySelector(kind);

  expect(player).toHaveAttribute('controls');
  expect(player).toHaveAttribute('preload', 'metadata');
  expect(player).not.toHaveAttribute('autoplay');
  expect(player?.querySelector('source')).toHaveAttribute('src', 'blob:local-media');
  expect(player?.closest('a,button')).toBeNull();
  expect(screen.getByRole('link', { name: /Lecture/ })).toHaveAttribute('href', '/reader');
});
