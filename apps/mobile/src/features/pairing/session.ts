import type { ProtocolTransport } from '@study/contracts/react';
import { createContext } from 'react';

export const UnlinkPhone = createContext<(() => void) | undefined>(undefined);

export const MobileTransport = createContext<ProtocolTransport | undefined>(undefined);
