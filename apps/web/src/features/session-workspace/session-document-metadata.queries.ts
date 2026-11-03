import type { MaterialDetailDto } from '@study/contracts/materials/schemas';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { request } from '../../lib/study-client/request';

export function useDocumentMetadata(material: MaterialDetailDto) {
  const cache = useQueryClient();
  const [title, setTitle] = useState(material.title);
  const [description, setDescription] = useState(material.description ?? '');
  const [expectedDescription] = useState(material.description ?? null);
  const mutation = useMutation({
    mutationFn: async () => {
      await request((rpc) =>
        rpc['materials.updateDescription']({
          id: material.id,
          description: description.trim() || null,
          expectedDescription
        })
      );

      if (title.trim() !== material.title) {
        await request((rpc) => rpc['materials.rename']({ id: material.id, title: title.trim() }));
      }
    },
    onSettled: () => {
      void cache.invalidateQueries({ queryKey: ['materials'] });
    }
  });

  return { title, setTitle, description, setDescription, mutation };
}
