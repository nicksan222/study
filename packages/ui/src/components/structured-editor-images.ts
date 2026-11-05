import type { Editor } from '@tiptap/core';
import type { Transaction } from '@tiptap/pm/state';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { EditorImageReference } from './structured-editor-types';

type UploadImage = (file: File) => Promise<EditorImageReference>;

/** Maps the insertion range through typing while the caller retains the original image bytes. */
export function useEditorImageInsertion(upload?: UploadImage) {
  const currentUpload = useRef(upload);
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    currentUpload.current = upload;
  }, [upload]);

  const insert = useCallback(async (editor: Editor, files: File[], position?: number) => {
    const retain = currentUpload.current;
    if (!retain || !canInsert(editor, files, busy.current)) return;
    busy.current = true;
    setPending(true);
    setFailed(false);
    try {
      await insertImages(editor, files, retain, position);
    } catch {
      if (!editor.isDestroyed) setFailed(true);
    } finally {
      busy.current = false;
      if (!editor.isDestroyed) setPending(false);
    }
  }, []);

  return { insert, pending, failed };
}

async function insertImages(editor: Editor, files: File[], retain: UploadImage, position?: number) {
  let from = position ?? editor.state.selection.from;
  let to = position ?? editor.state.selection.to;
  const map = ({ transaction }: { transaction: Transaction }) => {
    from = transaction.mapping.map(from);
    to = transaction.mapping.map(to);
  };
  editor.on('transaction', map);
  try {
    for (const file of files) {
      const image = await retain(file);
      if (editor.isDestroyed || !editor.isEditable) return;
      const inserted = editor
        .chain()
        .focus()
        .insertContentAt({ from, to }, { type: 'image', attrs: { ...image, src: null } })
        .run();
      if (!inserted) throw new Error('Image insertion failed');
      from = editor.state.selection.to;
      to = from;
    }
  } finally {
    editor.off('transaction', map);
  }
}

function canInsert(editor: Editor, files: File[], busy: boolean) {
  return !busy && !editor.isDestroyed && editor.isEditable && files.length > 0;
}
