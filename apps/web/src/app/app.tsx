import { RouterProvider } from '@tanstack/react-router';
import { useState } from 'react';

import { Providers } from './providers';
import { createAppRouter } from './router';
import { ServerConnection } from './server-connection';

export function App() {
  const [router] = useState(createAppRouter);

  return (
    <Providers
      queryClient={router.options.context.queryClient}
      renderApp={(children) => (
        <ServerConnection
          onReconnect={() => {
            void router.invalidate();
          }}
        >
          {children}
        </ServerConnection>
      )}
    >
      <RouterProvider router={router} />
    </Providers>
  );
}
