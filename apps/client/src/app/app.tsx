import type { ProtocolTransport } from '@study/contracts/react';
import { RouterProvider } from '@tanstack/react-router';
import { useState } from 'react';

import type { ClientModule } from '../lib/client-modules';
import { Providers } from './providers';
import { createAppRouter } from './router';
import { ServerConnection } from './server-connection';
import { DesktopUpdates } from './shell/desktop-updates';

export function App({
  transport,
  modules
}: { transport?: ProtocolTransport; modules?: readonly ClientModule[] } = {}) {
  const [router] = useState(createAppRouter);

  return (
    <Providers
      transport={transport}
      modules={modules}
      renderApp={(children) => (
        <DesktopUpdates
          renderRecovery={(updateAction) => (
            <ServerConnection
              updateAction={updateAction}
              onReconnect={() => {
                void router.invalidate();
              }}
            >
              {children}
            </ServerConnection>
          )}
        />
      )}
    >
      <RouterProvider router={router} />
    </Providers>
  );
}
