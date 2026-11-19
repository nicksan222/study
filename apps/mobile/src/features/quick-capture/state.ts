import { createContext } from 'react';

export type SaveStatus = 'idle' | 'sending' | 'saved' | 'rejected' | 'uncertain';

export const CaptureSaveState = createContext<{
  status: SaveStatus;
  setStatus: (status: SaveStatus) => void;
} | null>(null);
