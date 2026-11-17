import { test } from '@study/testing';
import { createRef } from 'react';

import type { RichNoteEditorHandle } from './rich-note';
import { StructuredEditor } from './structured-editor';
import type { StructuredEditorValue } from './structured-editor';
import type { StructuredEditorLabels } from './structured-editor-types';

const labels = new Proxy({} as StructuredEditorLabels, { get: (_, key) => String(key) });

test.unit.stable(
  'appends dictation after a trailing image when the captured document changed',
  ({ render, screen, act, expect }) => {
    const handle = createRef<RichNoteEditorHandle>();
    let changed: StructuredEditorValue | undefined;

    render(
      <StructuredEditor
        ref={handle}
        value={{
          type: 'doc',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'Before' }] },
            {
              type: 'image',
              attrs: {
                src: 'data:image/png;base64,',
                sourceId: '17',
                revision: 1,
                alt: 'Last image'
              }
            }
          ]
        }}
        onChange={(value) => {
          changed = value;
        }}
        label="Document"
        placeholder=""
        labels={labels}
      />
    );
    expect(screen.getByAltText('Last image')).toBeInTheDocument();
    act(() => {
      handle.current!.restoreSelection({
        anchor: Number.MAX_SAFE_INTEGER,
        head: Number.MAX_SAFE_INTEGER
      });
      handle.current!.insertPlainText('Spoken after');
    });
    expect(changed?.content?.map((node) => node.type)).toEqual(['paragraph', 'image', 'paragraph']);
    expect(changed?.content?.[0]?.content?.[0]?.text).toBe('Before');
    expect(changed?.content?.[2]?.content?.[0]?.text).toBe('Spoken after');
  }
);
