import { test } from '@study/testing';

import { EvidenceReference } from './citation';
import { StructuredEditor } from './structured-editor';
import type { StructuredEditorLabels } from './structured-editor-types';

const labels = new Proxy({} as StructuredEditorLabels, { get: (_, key) => String(key) });

test.stable('read-only documents omit textbox-only multiline semantics', () => {
  test.render(
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
  test
    .expect(test.screen.getByRole('document', { name: 'Source' }))
    .not.toHaveAttribute('aria-multiline');
});

test.stable('portalled citation evidence preserves its presentation boundary', () => {
  test.render(
    <EvidenceReference
      marker={1}
      label="Open evidence"
      closeLabel="Close"
      title="Biology"
      quote="Source excerpt"
      precision="Exact"
    />
  );
  test.fireEvent.click(test.screen.getByRole('button', { name: 'Open evidence' }));
  test
    .expect(test.screen.getByText('Source excerpt').closest('[data-study-ui-portal]'))
    .not.toBeNull();
});
