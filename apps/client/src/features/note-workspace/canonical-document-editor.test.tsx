import { createBlock, contentSnapshotIdSchema, sourceIdSchema } from '@study/contracts';
import { test } from '@study/testing';
import type { RichNoteEditorHandle, RichNoteSelection, StructuredEditorLabels } from '@study/ui';
import { Schema } from 'effect';
import { useImperativeHandle } from 'react';
import type { ReactNode, Ref } from 'react';

import { blankDocument } from '../document-editing/block-editor';
import {
  documentToEditor,
  editorToDocument
} from '../document-presentation/document-editor-content';
import type * as Module from './canonical-document-editor';

let CanonicalDocumentEditor: typeof Module.CanonicalDocumentEditor;

let urls: Record<string, string>;

let destination: RichNoteSelection | undefined;

const labels = new Proxy({} as StructuredEditorLabels, { get: (_, key) => String(key) });

test.unit.beforeEach(async ({ mock }) => {
  urls = {};
  destination = undefined;
  mock('#client/lib/study-client/workspace-preferences.queries.ts', () => ({
    useWorkspacePreferences: () => ({})
  }));
  mock('#client/features/document-presentation/index.ts', () => ({
    documentToEditor,
    editorToDocument,
    useDocumentEditorImages: () => ({ urls }),
    useStructuredEditorLabels: () => labels
  }));
  mock('#client/features/voice/index.ts', () => ({
    DictationButton: ({
      onCaptureStart,
      onTranscript
    }: {
      onCaptureStart: () => void;
      onTranscript: (text: string) => void;
    }) => (
      <>
        <button onClick={onCaptureStart}>Capture</button>
        <button onClick={() => onTranscript('Spoken')}>Finish</button>
      </>
    )
  }));
  mock('@study/ui', () => ({
    StructuredEditor: ({
      ref,
      toolbarEnd
    }: {
      ref: Ref<RichNoteEditorHandle>;
      toolbarEnd: ReactNode;
    }) => {
      useImperativeHandle(ref, () => ({
        selection: () => ({ kind: 'text', anchor: 3, head: 7 }),
        restoreSelection: (selection) => {
          destination = selection;
        },
        insertPlainText() {}
      }));

      return toolbarEnd;
    }
  }));
  CanonicalDocumentEditor = (await import('./canonical-document-editor')).CanonicalDocumentEditor;
});

for (const contentChanged of [false, true]) {
  test.unit.stable(
    `uses ${contentChanged ? 'document end after a content edit' : 'captured selection after preview resolution'}`,
    ({ render, screen, fireEvent, expect }) => {
      const document = {
        ...blankDocument(),
        blocks: [
          createBlock({
            type: 'paragraph',
            inlines: [{ type: 'text', text: 'Original content', marks: [] }]
          }),
          createBlock({
            type: 'image',
            sourceId: Schema.decodeUnknownSync(sourceIdSchema)(42n),
            revision: 1,
            alt: 'Preview'
          })
        ]
      };
      const props = {
        document,
        snapshotId: Schema.decodeUnknownSync(contentSnapshotIdSchema)(1n),
        targetKey: 1n,
        onChange() {}
      };
      const view = render(<CanonicalDocumentEditor {...props} />);

      fireEvent.click(screen.getByRole('button', { name: 'Capture' }));
      urls = { '42:1': 'blob:resolved-preview' };
      view.rerender(
        <CanonicalDocumentEditor
          {...props}
          document={contentChanged ? { ...document, blocks: [] } : structuredClone(document)}
        />
      );
      fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
      expect(destination).toEqual(
        contentChanged
          ? { kind: 'text', anchor: Number.MAX_SAFE_INTEGER, head: Number.MAX_SAFE_INTEGER }
          : { kind: 'text', anchor: 3, head: 7 }
      );
    }
  );
}
