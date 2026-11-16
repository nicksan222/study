import { defaultWorkspacePreferences } from '@study/contracts';

/** Build-only hook replacement: previews never connect to the user's private server. */
export function useWorkspacePreferences() {
  return defaultWorkspacePreferences;
}
