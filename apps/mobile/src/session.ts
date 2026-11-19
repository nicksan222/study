import { createContext } from 'react';

export const UnlinkPhone = createContext<(() => void) | undefined>(undefined);

export type SaveStatus = 'idle' | 'sending' | 'saved' | 'rejected' | 'uncertain';

export const CaptureSaveState = createContext<{
  status: SaveStatus;
  setStatus: (status: SaveStatus) => void;
} | null>(null);
