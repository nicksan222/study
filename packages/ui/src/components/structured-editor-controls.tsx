import type { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import { ImagePlus, Link2, Subscript, Superscript } from 'lucide-react';

import { Button } from './button';
import { StructuredTableControls } from './structured-editor-table';
import type { StructuredEditorLabels } from './structured-editor-types';

export function StructuredEditorControls({
  editor,
  labels,
  disabled,
  onInsertImage,
  onInsertTable,
  onEditLink,
  uploading
}: {
  editor: Editor;
  labels: StructuredEditorLabels;
  disabled: boolean;
  onInsertImage?: () => void;
  onInsertTable: () => void;
  onEditLink: () => void;
  uploading: boolean;
}) {
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      subscript: current.isActive('subscript'),
      superscript: current.isActive('superscript')
    })
  });

  return (
    <>
      <span className="rich-note-toolbar-divider" aria-hidden="true" />
      <Button
        size="icon-sm"
        variant="ghost-muted"
        aria-label={labels.link}
        title={labels.link}
        disabled={disabled}
        onClick={onEditLink}
      >
        <Link2 size={16} aria-hidden="true" />
      </Button>
      <StructuredTableControls
        editor={editor}
        labels={labels}
        disabled={disabled}
        onInsert={onInsertTable}
      />
      {onInsertImage && (
        <>
          <Button
            size="icon-sm"
            variant="ghost-muted"
            aria-label={labels.image}
            title={labels.image}
            disabled={disabled || uploading}
            aria-busy={uploading || undefined}
            onClick={onInsertImage}
          >
            <ImagePlus size={16} aria-hidden="true" />
          </Button>
        </>
      )}
      <span className="rich-note-toolbar-divider" aria-hidden="true" />
      <Button
        size="icon-sm"
        variant="ghost-muted"
        aria-label={labels.subscript}
        title={labels.subscript}
        aria-pressed={state.subscript}
        disabled={disabled}
        onClick={() => editor.chain().focus().toggleSubscript().run()}
      >
        <Subscript size={16} aria-hidden="true" />
      </Button>
      <Button
        size="icon-sm"
        variant="ghost-muted"
        aria-label={labels.superscript}
        title={labels.superscript}
        aria-pressed={state.superscript}
        disabled={disabled}
        onClick={() => editor.chain().focus().toggleSuperscript().run()}
      >
        <Superscript size={16} aria-hidden="true" />
      </Button>
    </>
  );
}
