import { LanguageProvider } from '@study/client/companion';
import { noteIdSchema, StudyError } from '@study/contracts';
import type { ProtocolTransport } from '@study/contracts/react';
import { catalogs } from '@study/localization';
import { test } from '@study/testing';
import { useState } from 'react';

import { MobileCapture } from './capture';
import { CaptureSaveState } from './state';
import type { SaveStatus } from './state';

const copy = catalogs.italian;

function CaptureHarness({ transport }: { transport: ProtocolTransport }) {
  const [status, setStatus] = useState<SaveStatus>('idle');

  return (
    <LanguageProvider locale="italian">
      <CaptureSaveState.Provider value={{ status, setStatus }}>
        <MobileCapture transport={transport} />
      </CaptureSaveState.Provider>
    </LanguageProvider>
  );
}

test.unit.stable(
  'mobile saves a single capture to Study and clears the submitted draft',
  async ({ rpc, render, screen, userEvent, expect, waitFor }) => {
    const note = {
      id: noteIdSchema.make(1n),
      title: 'Appunto',
      titleSource: 'user',
      projectIds: [],
      archivedAt: null,
      createdAt: 1n,
      updatedAt: 1n
    } as const;

    rpc.handle({
      'notes.createUntitledNote': (input) => {
        expect(input.initialMessage?.text).toBe('Da ripassare');

        return note;
      }
    });
    render(<CaptureHarness transport={rpc.transport} />);
    const field = screen.getByRole('textbox', { name: copy.MobileCaptureText });
    const save = screen.getByRole('button', { name: copy.MobileCaptureSave });

    expect(save).toBeDisabled();
    await userEvent.type(field, 'Da ripassare');
    await userEvent.click(save);
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(copy.MobileCaptureSaved)
    );
    expect(field).toHaveValue('');
    expect(save).toBeDisabled();
  }
);

test.unit.stable(
  'mobile keeps the text after an uncertain save and requires an explicit new capture',
  async ({ rpc, render, screen, userEvent, expect, waitFor }) => {
    rpc.handle({
      'notes.createUntitledNote': () => {
        throw new StudyError('transient', 'Disconnected');
      }
    });
    render(<CaptureHarness transport={rpc.transport} />);
    const field = screen.getByRole('textbox', { name: copy.MobileCaptureText });

    await userEvent.type(field, 'Da controllare');
    await userEvent.click(screen.getByRole('button', { name: copy.MobileCaptureSave }));
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(copy.MobileCaptureUncertain)
    );
    expect(field).toHaveValue('Da controllare');
    expect(screen.queryByRole('button', { name: copy.MobileCaptureSave })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: copy.MobileCaptureAnother }));
    expect(field).toHaveValue('');
  }
);

test.unit.stable(
  'a photo read started on one desktop cannot write after the transport changes',
  async ({ rpc, render, screen, userEvent, expect, mock, act }) => {
    const bytes = Promise.withResolvers<ArrayBuffer>();
    const read = Promise.withResolvers<void>();
    const file = new File(['photo'], 'photo.png', { type: 'image/png' });
    const execute = mock.fn(rpc.transport.execute);
    const replacement = { ...rpc.transport, execute };

    Object.defineProperty(file, 'arrayBuffer', {
      value: () => {
        read.resolve();

        return bytes.promise;
      }
    });

    const view = render(<CaptureHarness transport={rpc.transport} />);

    await userEvent.upload(view.container.querySelector('input[type=file]')!, file);
    await userEvent.click(screen.getByRole('button', { name: copy.MobileCaptureSave }));
    await read.promise;
    view.rerender(<CaptureHarness transport={replacement} />);
    await act(async () => bytes.resolve(new ArrayBuffer(1)));

    expect(execute).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent(copy.MobileCaptureUncertain);
  }
);
