import { RouterProvider } from '@tanstack/react-router';
import { useState } from 'react';

import { Providers } from './providers';
import { createAppRouter } from './router';

export function App() {
  const [router] = useState(createAppRouter);

  return (
    <Providers queryClient={router.options.context.queryClient}>
      <RouterProvider router={router} />
    </Providers>
  );
}
