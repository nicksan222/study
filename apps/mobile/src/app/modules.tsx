import type { ClientModule } from '@study/client/extensions';
import { createRpcTransport } from '@study/client/transport';
import type { PropsWithChildren } from 'react';

import type { PairingError } from '../features/pairing/invitations';
import { MobileTransport } from '../features/pairing/session';
import { UnlinkAction } from '../features/pairing/unlink-action';
import { Phone } from '../pages/pairing/page';

export function mobileModules(initialError?: PairingError): readonly ClientModule[] {
  function PairingBoundary({ children }: PropsWithChildren) {
    return (
      <Phone
        initialError={initialError}
        renderApp={(open) => (
          <MobileTransport.Provider value={createRpcTransport(open)}>
            {children}
          </MobileTransport.Provider>
        )}
      />
    );
  }

  return [{ id: 'pairing', Boundary: PairingBoundary, slots: { 'capture.actions': UnlinkAction } }];
}
