import { projectIdSchema } from '@study/contracts/ids';
import { useSearch } from '@tanstack/react-router';
import { Schema } from 'effect';

import { PageView } from './page.view';

export function Page() {
  const { project } = useSearch({ from: '__root__' });

  return (
    <PageView
      project={project ? Schema.decodeUnknownSync(projectIdSchema)(BigInt(project)) : undefined}
    />
  );
}
