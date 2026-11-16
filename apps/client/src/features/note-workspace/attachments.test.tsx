import { RegistryContext } from '@effect/atom-react';
import { noteIdSchema } from '@study/contracts';
import { test } from '@study/testing';
import { AttachmentPreview, WorkspaceDeskSurface as Desk } from '@study/ui';
import { AtomRegistry } from 'effect/reactivity';

import { AttachmentPicker, AttachmentTray } from './attachments';
import { attachmentState } from './attachments.queries';
import type { Attachment } from './attachments.queries';

test.mock('#client/lib/i18n.tsx', () => ({
  useI18n: () => ({ t: (key: string) => key, locale: 'english' })
}));

const id = noteIdSchema.make(14n);

const clients: AtomRegistry.AtomRegistry[] = [];

function mount(entry: Attachment) {
  const client = AtomRegistry.make();

  clients.push(client);
  client.set(attachmentState(id), [entry]);

  return {
    client,
    ...test.render(
      <RegistryContext.Provider value={client}>
        <AttachmentTray id={id} blocked={false} />
        <AttachmentPicker id={id} blocked={false} />
      </RegistryContext.Provider>
    )
  };
}

test.afterEach(() => {
  test.cleanup();
  clients.splice(0).forEach((client) => client.dispose());
  test.vi.unstubAllGlobals();
});

test.stable(
  'keeps ready files in a separate compact tray with an accessible icon remove action',
  async () => {
    const file = new File(['notes'], 'A very long document filename.pdf', {
      type: 'application/pdf'
    });
    const view = mount({ key: 'file', file, state: 'ready' });
    const tray = test.screen.getByRole('list', { name: 'NoteAttachments' });

    test.expect(tray).toContainElement(test.screen.getByText(file.name));
    test.expect(test.screen.getByText(file.name)).toHaveAttribute('title', file.name);
    test.expect(test.screen.getByRole('status')).toHaveTextContent('NoteFileAccepted');
    test.expect(tray).not.toContainElement(test.screen.getByLabelText('NoteAttachFiles'));
    const remove = test.screen.getByRole('button', { name: 'NoteRemoveAttachment' });

    test.expect(remove.textContent).toBe('');
    test.fireEvent.click(remove);
    await test.waitFor(() => test.expect(view.client.get(attachmentState(id))).toEqual([]));
    test.expect(test.screen.queryByRole('list')).toBeNull();
  }
);

test.stable('shows uploading state without offering an unsafe in-flight removal', () => {
  mount({ key: 'pending', file: new File(['notes'], 'notes.txt'), state: 'uploading' });
  test.expect(test.screen.getByRole('status')).toHaveTextContent('NoteUploading');
  test.expect(test.screen.queryByRole('button', { name: 'NoteRemoveAttachment' })).toBeNull();
});

test.stable(
  'keeps uncertain upload guidance and requires the acknowledgement action instead of retrying',
  () => {
    mount({ key: 'uncertain', file: new File(['notes'], 'notes.txt'), state: 'uncertain' });
    test.expect(test.screen.getByText('NoteUploadUncertain')).toBeVisible();
    test.expect(test.screen.getByRole('status')).toHaveTextContent('NoteUploadUnconfirmed');
    test.expect(test.screen.getByRole('button', { name: 'NoteUploadAcknowledge' })).toBeVisible();
    test.expect(test.screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  }
);

test.stable(
  'uses a local image preview and releases its URL when the attachment is removed',
  async () => {
    const createObjectURL = test.vi.fn(() => 'blob:local-preview');
    const revokeObjectURL = test.vi.fn();

    test.vi.stubGlobal(
      'URL',
      class extends URL {
        static createObjectURL = createObjectURL;
        static revokeObjectURL = revokeObjectURL;
      }
    );
    const file = new File(['image'], 'image.png', { type: 'image/png' });
    const view = mount({ key: 'image', file, state: 'ready' });

    await test.waitFor(() =>
      test.expect(view.container.querySelector('img')).toHaveAttribute('src', 'blob:local-preview')
    );
    test.expect(createObjectURL).toHaveBeenCalledWith(file);
    test.fireEvent.click(test.screen.getByRole('button', { name: 'NoteRemoveAttachment' }));
    await test.waitFor(() =>
      test.expect(revokeObjectURL).toHaveBeenCalledWith('blob:local-preview')
    );
  }
);

test.stable.each([
  ['audio', 'audio/mpeg'],
  ['video', 'video/mp4']
] as const)('uses native %s controls outside the attachment navigation link', (kind, mime) => {
  const view = test.render(
    <Desk.AttachmentCard
      name="Lecture"
      meta="Attached"
      icon={null}
      href="/reader"
      preview={<AttachmentPreview kind={kind} src="blob:local-media" mime={mime} label="Lecture" />}
    />
  );
  const player = view.container.querySelector(kind);

  test.expect(player).toHaveAttribute('controls');
  test.expect(player).toHaveAttribute('preload', 'metadata');
  test.expect(player).not.toHaveAttribute('autoplay');
  test.expect(player?.querySelector('source')).toHaveAttribute('src', 'blob:local-media');
  test.expect(player?.closest('a,button')).toBeNull();
  test
    .expect(test.screen.getByRole('link', { name: /Lecture/ }))
    .toHaveAttribute('href', '/reader');
});
