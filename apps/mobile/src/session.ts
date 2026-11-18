import { createContext } from 'react';

export const UnlinkPhone = createContext<(() => void) | undefined>(undefined);
