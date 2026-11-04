import { defaultWorkspacePreferences } from '@study/contracts/settings/types';
import { catalogs } from '@study/localization';
import { testStable } from '@study/testing/vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Effect } from 'effect';
import { expect, vi } from 'vite-plus/test';

import { authoredDocument } from '../document-editing/test-support';
import { materialRpc, mountLibraryRoute } from '../material-library/test/support';
vi.mock('#web/lib/study-client/request.ts', () => ({ request: vi.fn() }));
testStable(
  'exports the selected version using the configured format and server filename',
  async () => {
    const rpc = materialRpc();

    rpc['settings.workspacePreferences'].mockReturnValue(
      Effect.succeed({ ...defaultWorkspacePreferences, defaultExportFormat: 'html' })
    );
    rpc['documents.exportFile'].mockReturnValue(
      Effect.succeed({
        versionId: authoredDocument(41n, '', 101n).version!.id,
        format: 'html',
        filename: 'my-notes.html',
        mediaType: 'text/html; charset=utf-8',
        bytes: new TextEncoder().encode('<p>Notes</p>'),
        omissions: []
      })
    );
    const download = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:export-notes');

    mountLibraryRoute('/documents/41?documentVersion=101', rpc);
    const button = await screen.findByRole('button', { name: catalogs.english.ExportDownload });

    await waitFor(() =>
      expect(
        screen.getByRole('combobox', { name: catalogs.english.ExportFormat })
      ).toHaveTextContent(catalogs.english.ExportHtml)
    );
    await userEvent.click(button);
    await waitFor(() =>
      expect(rpc['documents.exportFile']).toHaveBeenCalledWith({
        id: authoredDocument(41n, '', 101n).version!.id,
        format: 'html'
      })
    );
    await waitFor(() => expect(download).toHaveBeenCalled());
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'text/html; charset=utf-8' })
    );
    download.mockRestore();
    create.mockRestore();
  }
);
