import type { ProtocolTransport } from '@study/contracts/react';
import { RouterProvider } from '@tanstack/react-router';
import { useState } from 'react';

import { Providers } from './providers';
import { createAppRouter } from './router';
import { ServerConnection } from './server-connection';

export function App({ transport }: { transport?: ProtocolTransport } = {}) {
  const [router] = useState(createAppRouter);

  return (
    <Providers
      transport={transport}
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
