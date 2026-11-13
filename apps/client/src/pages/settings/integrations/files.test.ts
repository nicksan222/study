import { testStable } from '@study/testing/vitest';
import { expect } from 'vite-plus/test';

import { vaultFiles } from './files';

testStable(
  'strips only the selected root and excludes private vault configuration before reading',
  async () => {
    const note = new File(['# Cells'], 'Cells.md');
    const privateFile = new File(['private'], 'app.json');

    Object.defineProperty(note, 'webkitRelativePath', { value: 'Biology/Notes/Cells.md' });
    Object.defineProperty(privateFile, 'webkitRelativePath', {
      value: 'Biology/.obsidian/app.json'
    });
    Object.defineProperty(note, 'arrayBuffer', {
      value: async () => new TextEncoder().encode('# Cells').buffer
    });
    Object.defineProperty(privateFile, 'arrayBuffer', {
      value: () => {
        throw new Error('Private config must not be read');
      }
    });

    expect(await vaultFiles([note, privateFile])).toEqual({
      sourceKey: 'Biology',
      files: [{ path: 'Notes/Cells.md', content: 'IyBDZWxscw==' }]
    });
  }
);
