import { useSearch } from '@tanstack/react-router';

import { PageView } from './page.view';

export function HomeScreen() {
  const search = useSearch({ from: '__root__' });

  return <PageView project={search.project} />;
}
