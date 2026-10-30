import { RouterProvider } from '@tanstack/react-router';
import { useState } from 'react';

import { Providers } from './providers';
import { createAppRouter } from './router';

export function App() {
  const [router] = useState(createAppRouter);

  return (
    <Providers>
      <RouterProvider router={router} />
    </Providers>
  );
}
