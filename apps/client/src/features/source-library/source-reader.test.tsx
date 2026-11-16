import { StudyError } from '@study/contracts';
import { catalogs } from '@study/localization';
import { test } from '@study/testing';
import { Effect } from 'effect';

import { materialRpc, mountLibraryRoute, importedSource } from '../material-library/test/support';
test.stable(
  'keeps unavailable historical extraction unavailable without falling back to current content or bytes',
  async () => {
    const rpc = materialRpc();

    rpc['sources.extraction'].mockReturnValue(
      Effect.fail(new StudyError('not_found', 'Revision unavailable'))
    );
    mountLibraryRoute('/sources/7?sourceRevision=1&sourceSnapshot=1101', rpc);
    test
      .expect(await test.within(await test.screen.findByRole('main')).findByRole('alert'))
      .toHaveTextContent(catalogs.english.ReaderUnavailable);
    test.expect(test.screen.queryByText('Current extraction 41')).toBeNull();
    test
      .expect(test.screen.getByRole('button', { name: catalogs.english.ReaderOriginal }))
      .toBeEnabled();
    test.expect(rpc['sources.extraction']).toHaveBeenCalledExactlyOnceWith({
      sourceId: importedSource.id,
      revision: 1n,
      snapshotId: 1101n
    });
    test.expect(rpc['materials.materialVersion']).not.toHaveBeenCalled();
    test.expect(rpc['sources.currentExtraction']).not.toHaveBeenCalled();
    test.expect(rpc['sources.exportRevision']).not.toHaveBeenCalled();
    test.expect(rpc['sources.sourceExport']).not.toHaveBeenCalled();
  }
);

test.stable(
  'exports the selected historical version with its exact retained bytes, MIME and filename',
  async () => {
    const rpc = materialRpc();
    const bytes = new Uint8Array([0, 128, 255]);

    rpc['sources.exportRevision'].mockReturnValue(
      Effect.succeed({
        sourceId: importedSource.id,
        revision: 1n,
        name: importedSource.name,
        mime: importedSource.mime,
        bytes
      })
    );
    const createObjectURL = test.vi
      .fn<(blob: Blob) => string>()
      .mockReturnValue('blob:historical-original');
    const revokeObjectURL = test.vi.fn();
    const timers = test.vi.spyOn(globalThis, 'setTimeout');

    test.vi.stubGlobal(
      'URL',
      class extends URL {
        static createObjectURL = createObjectURL;
        static revokeObjectURL = revokeObjectURL;
      }
    );
    let delivery: { href: string; filename: string } | undefined;
    const click = test.vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement
    ) {
      delivery = { href: this.href, filename: this.download };
    });

    try {
      mountLibraryRoute('/sources/7?sourceRevision=1&sourceSnapshot=1101', rpc);
      await test.screen.findByText('Historical extraction');
      test.expect(test.screen.queryByText('Current extraction 41')).toBeNull();
      const original = test.screen.getByRole('button', { name: catalogs.english.ReaderOriginal });

      await test.userEvent.setup().click(original);
      await test.waitFor(() => test.expect(createObjectURL).toHaveBeenCalledTimes(1));
      const blob = createObjectURL.mock.calls[0]![0];

      test.expect(blob.type).toBe(importedSource.mime);
      const retained = await new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(blob);
      });

      test.expect(new Uint8Array(retained)).toEqual(bytes);
      test
        .expect(delivery)
        .toEqual({ href: 'blob:historical-original', filename: importedSource.name });
      test.expect(rpc['sources.exportRevision']).toHaveBeenCalledExactlyOnceWith({
        sourceId: importedSource.id,
        revision: 1n
      });
      test.expect(rpc['sources.sourceExport']).not.toHaveBeenCalled();
      await test.waitFor(() => test.expect(original).toBeEnabled(), { timeout: 2500 });
      const scheduled = timers.mock.calls.findLastIndex(([, delay]) => delay === 30000);

      test.expect(scheduled).toBeGreaterThanOrEqual(0);
      const callback = timers.mock.calls[scheduled]![0];

      clearTimeout(timers.mock.results[scheduled]!.value);

      test.assert(typeof callback === 'function', 'Expected a download cleanup callback');

      callback();
      test.expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:historical-original');
    } finally {
      timers.mockRestore();
      click.mockRestore();
      test.vi.unstubAllGlobals();
    }
  }
);

test.stable(
  'reports an unavailable historical original without requesting a current-version or Source fallback',
  async () => {
    const rpc = materialRpc();

    rpc['sources.exportRevision'].mockReturnValue(
      Effect.fail(new StudyError('not_found', 'Original unavailable'))
    );
    mountLibraryRoute('/sources/7?sourceRevision=1&sourceSnapshot=1101', rpc);
    const original = await test.screen.findByRole('button', {
      name: catalogs.english.ReaderOriginal
    });

    await test.userEvent.setup().click(original);
    test
      .expect(await test.within(await test.screen.findByRole('main')).findByRole('alert'))
      .toHaveTextContent(catalogs.english.ReaderOriginalUnavailable);
    test.expect(rpc['sources.exportRevision']).toHaveBeenCalledExactlyOnceWith({
      sourceId: importedSource.id,
      revision: 1n
    });
    test.expect(rpc['sources.sourceExport']).not.toHaveBeenCalled();
    test.expect(test.screen.getByText('Historical extraction')).toBeInTheDocument();
  }
);
