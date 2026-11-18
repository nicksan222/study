import { LanguageProvider } from '@study/client/companion';
import { noteIdSchema, StudyError } from '@study/contracts';
import { catalogs } from '@study/localization';
import { test } from '@study/testing';

import { MobileCapture } from './capture';

const copy = catalogs.italian;

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
    render(
      <LanguageProvider locale="italian">
        <MobileCapture transport={rpc.transport} />
      </LanguageProvider>
    );
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
    render(
      <LanguageProvider locale="italian">
        <MobileCapture transport={rpc.transport} />
      </LanguageProvider>
    );
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
