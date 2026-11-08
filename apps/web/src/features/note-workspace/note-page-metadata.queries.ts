import type { Page } from '@study/contracts/pages/types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { invalidatePages } from '#web/lib/study-client/pages.queries.ts';
import { request } from '#web/lib/study-client/request.ts';

export function usePageMetadata(document: Page) {
  const cache = useQueryClient();
  const [title, setTitle] = useState(document.title);
  const [description, setDescription] = useState(document.description ?? '');
  const [expectedDescription] = useState(document.description ?? null);
  const mutation = useMutation({
    mutationFn: async () => {
      return request((rpc) =>
        rpc['pages.updateMetadata']({
          id: document.id,
          title: title.trim(),
          description: description.trim() || null,
          expectedTitle: document.title,
          expectedDescription
        })
      );
    },
    onSettled: () => {
      void invalidatePages(cache);
    }
  });

  return { title, setTitle, description, setDescription, mutation };
}
