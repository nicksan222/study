import { StudyError } from '@study/contracts/errors';
import { sourceSchema } from '@study/contracts/sources/schemas';
import { catalogs } from '@study/localization';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Schema } from 'effect';
import { expect, it, vi } from 'vite-plus/test';

import { request } from '../../lib/study-client/request';
import { ImportForm } from './library-page';

vi.mock('../../lib/study-client/request', () => ({ request: vi.fn() }));

const source = Schema.decodeUnknownSync(sourceSchema)({
  id: 7n,
  name: 'A page',
  kind: 'web',
  mime: 'text/html',
  origin: 'web',
  projectId: null,
  projectName: null,
  sizeBytes: 0n,
  sha256: new Uint8Array(),
  uri: 'https://example.com',
  createdAt: 1n
});

function form(client = new QueryClient()) {
  return (
    <QueryClientProvider client={client}>
      <ImportForm />
    </QueryClientProvider>
  );
}

it('retains Source-only acceptance without requiring a collection or Material ID', async () => {
  vi.mocked(request).mockReset().mockResolvedValueOnce(source);
  const user = userEvent.setup();

  render(form());
  await user.type(
    screen.getByRole('textbox', { name: catalogs.english.LibraryLink }),
    'https://example.com'
  );
  await user.click(screen.getByRole('button', { name: catalogs.english.LibraryImport }));
  expect(await screen.findByRole('status')).toHaveTextContent(catalogs.english.LibraryAccepted);
  expect(request).toHaveBeenCalledTimes(1);
});

it('retains a pending import through unmount and prevents resubmission on reopening', async () => {
  let finish: (value: typeof source) => void = () => {};

  vi.mocked(request)
    .mockReset()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
  const client = new QueryClient();
  const user = userEvent.setup();
  const mounted = render(form(client));

  await user.type(
    screen.getByRole('textbox', { name: catalogs.english.LibraryLink }),
    'https://example.com'
  );
  await user.click(screen.getByRole('button', { name: catalogs.english.LibraryImport }));
  mounted.unmount();
  const reopened = render(form(client));

  expect(await screen.findByRole('status')).toHaveTextContent(catalogs.english.LibraryImporting);
  expect(screen.getByRole('button', { name: catalogs.english.LibraryImport })).toBeDisabled();
  reopened.unmount();
  await act(async () => {
    finish(source);
  });
  render(form(client));
  expect(await screen.findByRole('status')).toHaveTextContent(catalogs.english.LibraryAccepted);
  expect(screen.getByRole('button', { name: catalogs.english.LibraryImport })).toBeDisabled();
  expect(request).toHaveBeenCalledTimes(1);
});

it('retains ambiguous submission recovery after dismissal instead of enabling a fresh submit', async () => {
  vi.mocked(request).mockReset().mockRejectedValueOnce(new Error('disconnected'));
  const client = new QueryClient();
  const user = userEvent.setup();
  const mounted = render(form(client));

  await user.type(
    screen.getByRole('textbox', { name: catalogs.english.LibraryLink }),
    'https://example.com'
  );
  await user.click(screen.getByRole('button', { name: catalogs.english.LibraryImport }));
  expect(await screen.findByRole('alert')).toHaveTextContent(catalogs.english.LibraryImportFailed);
  mounted.unmount();
  render(form(client));
  expect(await screen.findByRole('alert')).toHaveTextContent(catalogs.english.LibraryImportFailed);
  expect(screen.getByRole('button', { name: catalogs.english.LibraryImport })).toBeDisabled();
  expect(request).toHaveBeenCalledTimes(1);
});

it('allows correcting a definitive typed rejection without claiming acceptance', async () => {
  vi.mocked(request)
    .mockReset()
    .mockRejectedValueOnce(new StudyError('invalid_input', 'Unsupported URL'))
    .mockResolvedValueOnce(source);
  const user = userEvent.setup();

  render(form());
  const input = screen.getByRole('textbox', {
    name: catalogs.english.LibraryLink
  });

  await user.type(input, 'ftp://example.com');
  await user.click(screen.getByRole('button', { name: catalogs.english.LibraryImport }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    catalogs.english.LibraryImportRejected
  );
  expect(screen.queryByText(catalogs.english.LibraryImportFailed)).not.toBeInTheDocument();
  await user.clear(input);
  await user.type(input, 'https://example.com');
  await user.click(screen.getByRole('button', { name: catalogs.english.LibraryImport }));
  expect(await screen.findByRole('status')).toHaveTextContent(catalogs.english.LibraryAccepted);
  expect(request).toHaveBeenCalledTimes(2);
});

it('requires explicit acknowledgment of an ambiguous result before allowing another import', async () => {
  vi.mocked(request)
    .mockReset()
    .mockRejectedValueOnce(new Error('connection lost'))
    .mockResolvedValueOnce(source);
  const user = userEvent.setup();

  render(form());
  const input = screen.getByRole('textbox', { name: catalogs.english.LibraryLink });

  await user.type(input, 'https://example.com');
  await user.click(screen.getByRole('button', { name: catalogs.english.LibraryImport }));
  await screen.findByRole('alert');
  expect(input).toBeDisabled();
  await user.click(screen.getByRole('button', { name: catalogs.english.LibraryImport }));
  expect(request).toHaveBeenCalledTimes(1);
  await user.click(
    screen.getByRole('button', { name: catalogs.english.LibraryImportAcknowledged })
  );
  expect(input).toBeEnabled();
  expect(input).toHaveValue('');
  expect(screen.queryByRole('alert')).toBeNull();
  await user.type(input, 'https://example.com/corrected');
  await user.click(screen.getByRole('button', { name: catalogs.english.LibraryImport }));
  expect(await screen.findByRole('status')).toHaveTextContent(catalogs.english.LibraryAccepted);
  expect(request).toHaveBeenCalledTimes(2);
});

it('permits replacing an unreadable local file with a link without sending file bytes', async () => {
  vi.mocked(request).mockReset().mockResolvedValueOnce(source);
  const file = new File(['unreadable'], 'notes.txt', { type: 'text/plain' });
  const read = vi.fn().mockRejectedValue(new Error('File disappeared'));

  Object.defineProperty(file, 'arrayBuffer', { value: read });
  const user = userEvent.setup();

  render(form());
  await user.upload(screen.getByLabelText(catalogs.english.LibraryFile), file);
  await user.click(screen.getByRole('button', { name: catalogs.english.LibraryImport }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    catalogs.english.LibraryImportRejected
  );
  expect(request).not.toHaveBeenCalled();
  expect(screen.queryByText(catalogs.english.LibraryImportFailed)).toBeNull();
  await user.click(screen.getByRole('button', { name: catalogs.english.LibraryClearFile }));
  await user.type(
    screen.getByRole('textbox', { name: catalogs.english.LibraryLink }),
    'https://example.com'
  );
  await user.click(screen.getByRole('button', { name: catalogs.english.LibraryImport }));
  expect(await screen.findByRole('status')).toHaveTextContent(catalogs.english.LibraryAccepted);
  expect(read).toHaveBeenCalledTimes(1);
  expect(request).toHaveBeenCalledTimes(1);
});

it('clears the native picker when explicitly starting another import of the same file', async () => {
  vi.mocked(request).mockReset().mockResolvedValue(source);
  const file = new File(['notes'], 'notes.txt', { type: 'text/plain' });
  const read = vi.fn().mockResolvedValue(new Uint8Array([110, 111, 116, 101, 115]).buffer);

  Object.defineProperty(file, 'arrayBuffer', { value: read });
  const user = userEvent.setup();

  render(form());
  const picker = screen.getByLabelText(catalogs.english.LibraryFile);

  await user.upload(picker, file);
  await user.click(screen.getByRole('button', { name: catalogs.english.LibraryImport }));
  expect(await screen.findByRole('status')).toHaveTextContent(catalogs.english.LibraryAccepted);
  await user.click(screen.getByRole('button', { name: catalogs.english.LibraryStartAnother }));
  expect(picker).toHaveValue('');
  await user.upload(picker, file);
  expect(screen.getByRole('button', { name: catalogs.english.LibraryImport })).toBeEnabled();
  await user.click(screen.getByRole('button', { name: catalogs.english.LibraryImport }));
  expect(await screen.findByRole('status')).toHaveTextContent(catalogs.english.LibraryAccepted);
  expect(read).toHaveBeenCalledTimes(2);
  expect(request).toHaveBeenCalledTimes(2);
});
