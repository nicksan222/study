import type { StudyDocument } from '@study/contracts/documents/types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { invalidateDocuments } from '#web/lib/study-client/documents.queries.ts';
import { request } from '#web/lib/study-client/request.ts';

export function useDocumentMetadata(document: StudyDocument) {
  const cache = useQueryClient();
  const [title, setTitle] = useState(document.title);
  const [description, setDescription] = useState(document.description ?? '');
  const [expectedDescription] = useState(document.description ?? null);
  const mutation = useMutation({
    mutationFn: async () => {
      return request((rpc) =>
        rpc['documents.updateMetadata']({
          id: document.id,
          title: title.trim(),
          description: description.trim() || null,
          expectedTitle: document.title,
          expectedDescription
        })
      );
    },
    onSettled: () => {
      void invalidateDocuments(cache);
    }
  });

  return { title, setTitle, description, setDescription, mutation };
}
