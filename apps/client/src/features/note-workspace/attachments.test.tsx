import { RegistryContext } from '@effect/atom-react';
import { noteIdSchema } from '@study/contracts';
import { test } from '@study/testing';
import { AttachmentPreview, WorkspaceDeskSurface as Desk } from '@study/ui';
import { AtomRegistry } from 'effect/reactivity';

let AttachmentPicker: typeof __MockType0.AttachmentPicker;

let AttachmentTray: typeof __MockType0.AttachmentTray;

let attachmentState: typeof __MockType1.attachmentState;

import type * as __MockType0 from './attachments';
import type { Attachment } from './attachments.queries';
import type * as __MockType1 from './attachments.queries';

const id = noteIdSchema.make(14n);

const clients: AtomRegistry.AtomRegistry[] = [];

function mount({ render }: Pick<test.Context, 'render'>, entry: Attachment) {
  const client = AtomRegistry.make();

  clients.push(client);
  client.set(attachmentState(id), [entry]);

  return {
    client,
    ...render(
      <RegistryContext.Provider value={client}>
        <AttachmentTray id={id} blocked={false} />
        <AttachmentPicker id={id} blocked={false} />
      </RegistryContext.Provider>
    )
  };
}

test.beforeEach(async ({ mock }) => {
  mock('#client/lib/i18n.tsx', () => ({
    useI18n: () => ({ t: (key: string) => key, locale: 'english' })
  }));
  const __mockModule0 = await import('./attachments');

  AttachmentPicker = __mockModule0.AttachmentPicker;
  AttachmentTray = __mockModule0.AttachmentTray;
  const __mockModule1 = await import('./attachments.queries');

  attachmentState = __mockModule1.attachmentState;
});

test.afterEach(({ cleanup, vi }) => {
  cleanup();
  clients.splice(0).forEach((client) => client.dispose());
  vi.unstubAllGlobals();
});

test.stable(
  'keeps ready files in a separate compact tray with an accessible icon remove action',
  async ({ screen, expect, fireEvent, waitFor, render }) => {
    const file = new File(['notes'], 'A very long document filename.pdf', {
      type: 'application/pdf'
    });
    const view = mount({ render }, { key: 'file', file, state: 'ready' });
    const tray = screen.getByRole('list', { name: 'NoteAttachments' });

    expect(tray).toContainElement(screen.getByText(file.name));
    expect(screen.getByText(file.name)).toHaveAttribute('title', file.name);
    expect(screen.getByRole('status')).toHaveTextContent('NoteFileAccepted');
    expect(tray).not.toContainElement(screen.getByLabelText('NoteAttachFiles'));
    const remove = screen.getByRole('button', { name: 'NoteRemoveAttachment' });

    expect(remove.textContent).toBe('');
    fireEvent.click(remove);
    await waitFor(() => expect(view.client.get(attachmentState(id))).toEqual([]));
    expect(screen.queryByRole('list')).toBeNull();
  }
);

test.stable(
  'shows uploading state without offering an unsafe in-flight removal',
  ({ expect, screen, render }) => {
    mount(
      { render },
      { key: 'pending', file: new File(['notes'], 'notes.txt'), state: 'uploading' }
    );
    expect(screen.getByRole('status')).toHaveTextContent('NoteUploading');
    expect(screen.queryByRole('button', { name: 'NoteRemoveAttachment' })).toBeNull();
  }
);

test.stable(
  'keeps uncertain upload guidance and requires the acknowledgement action instead of retrying',
  ({ expect, screen, render }) => {
    mount(
      { render },
      { key: 'uncertain', file: new File(['notes'], 'notes.txt'), state: 'uncertain' }
    );
    expect(screen.getByText('NoteUploadUncertain')).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('NoteUploadUnconfirmed');
    expect(screen.getByRole('button', { name: 'NoteUploadAcknowledge' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  }
);

test.stable(
  'uses a local image preview and releases its URL when the attachment is removed',
  async ({ vi, waitFor, expect, fireEvent, screen, render }) => {
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
    const view = mount({ render }, { key: 'image', file, state: 'ready' });

    await waitFor(() =>
      expect(view.container.querySelector('img')).toHaveAttribute('src', 'blob:local-preview')
    );
    expect(createObjectURL).toHaveBeenCalledWith(file);
    fireEvent.click(screen.getByRole('button', { name: 'NoteRemoveAttachment' }));
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:local-preview'));
  }
);

test.stable.for([
  ['audio', 'audio/mpeg'],
  ['video', 'video/mp4']
] as const)(
  'uses native %s controls outside the attachment navigation link',
  ([kind, mime], { render, expect, screen }) => {
    const view = render(
      <Desk.AttachmentCard
        name="Lecture"
        meta="Attached"
        icon={null}
        href="/reader"
        preview={
          <AttachmentPreview kind={kind} src="blob:local-media" mime={mime} label="Lecture" />
        }
      />
    );
    const player = view.container.querySelector(kind);

    expect(player).toHaveAttribute('controls');
    expect(player).toHaveAttribute('preload', 'metadata');
    expect(player).not.toHaveAttribute('autoplay');
    expect(player?.querySelector('source')).toHaveAttribute('src', 'blob:local-media');
    expect(player?.closest('a,button')).toBeNull();
    expect(screen.getByRole('link', { name: /Lecture/ })).toHaveAttribute('href', '/reader');
  }
);
