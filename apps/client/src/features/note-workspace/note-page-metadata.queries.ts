import type { Page } from '@study/contracts';
import { rpc } from '@study/contracts/react';
import { useState } from 'react';

export function usePageMetadata(page: Page) {
  const [title, setTitle] = useState(page.title);
  const [description, setDescription] = useState(page.description ?? '');
  const [expectedDescription] = useState(page.description ?? null);
  const operation = rpc.pages.updateMetadata.useMutation();
  const mutation = {
    ...operation,
    mutate: () =>
      operation.mutate({
        id: page.id,
        title: title.trim(),
        description: description.trim() || null,
        expectedTitle: page.title,
        expectedDescription
      }),
    mutateAsync: () =>
      operation.mutateAsync({
        id: page.id,
        title: title.trim(),
        description: description.trim() || null,
        expectedTitle: page.title,
        expectedDescription
      })
  };

  return { title, setTitle, description, setDescription, mutation };
}
