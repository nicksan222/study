import { createContext, useContext } from "react";

export interface Installation {
  installing: boolean;
  busy: boolean;
  error: Error | null;
  blocksChanges: () => boolean;
  install: () => Promise<boolean>;
}
export const InstallationContext = createContext<Installation | null>(null);
export function useInstallation() {
  const value = useContext(InstallationContext);
  if (!value) throw new Error("InstallationProvider is required");
  return value;
}
