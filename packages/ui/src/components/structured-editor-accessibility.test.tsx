import { testStable } from '@study/testing/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect } from 'vite-plus/test';

import { EvidenceReference } from './citation';
import { StructuredEditor } from './structured-editor';
import type { StructuredEditorLabels } from './structured-editor-types';

const labels = new Proxy({} as StructuredEditorLabels, { get: (_, key) => String(key) });

testStable('read-only documents omit textbox-only multiline semantics', () => {
  render(
    <StructuredEditor
      readOnly
      value={{
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Evidence' }] }]
      }}
      onChange={() => {}}
      label="Source"
      placeholder=""
      labels={labels}
    />
  );
  expect(screen.getByRole('document', { name: 'Source' })).not.toHaveAttribute('aria-multiline');
});

testStable('portalled citation evidence preserves its presentation boundary', () => {
  render(
    <EvidenceReference
      marker={1}
      label="Open evidence"
      closeLabel="Close"
      title="Biology"
      quote="Source excerpt"
      precision="Exact"
    />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Open evidence' }));
  expect(screen.getByText('Source excerpt').closest('[data-study-ui-portal]')).not.toBeNull();
});
