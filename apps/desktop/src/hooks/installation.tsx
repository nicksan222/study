import { useRef, useState, type ReactNode } from "react";
import { useIsMutating, useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { Pending } from "../components";
import { useI18n } from "../i18n";
import { useRecording } from "./recording";
import { InstallationContext } from "./installation-state";

// Ownership lives above routes. Native retains the authoritative reservation even if
// the webview disappears; local intent also blocks same-turn edits before status polling.
export function InstallationProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const client = useQueryClient();
  const recording = useRecording();
  const mutations = useIsMutating();
  const [intent, setIntent] = useState(false);
  const intentRef = useRef(false);
  const [error, setError] = useState<Error | null>(null);
  const status = useQuery({
    queryKey: ["update-status"],
    queryFn: () => invoke<{ installing: boolean }>("update_status"),
    enabled: isTauri(),
    refetchInterval: 500,
  });
  const installing = intent || status.data?.installing === true;
  const nativeBusy = useRef(false);
  nativeBusy.current = status.data?.installing === true;
  const blocksChanges = () => intentRef.current || nativeBusy.current;
  const busy =
    installing ||
    recording.busy ||
    mutations > 0 ||
    status.isPending ||
    status.isError;
  const install = async () => {
    if (
      blocksChanges() ||
      recording.busy ||
      client.getMutationCache().findAll({ status: "pending" }).length ||
      !isTauri() ||
      status.isPending ||
      status.isError
    ) {
      setError(new Error(t("UpdateBusy")));
      return false;
    }
    intentRef.current = true;
    setIntent(true);
    setError(null);
    try {
      await invoke("install_update");
      return true;
    } catch (cause) {
      setError(new Error(t("UpdateFailed"), { cause }));
      return false;
    } finally {
      intentRef.current = false;
      setIntent(false);
      void client.invalidateQueries();
    }
  };
  return (
    <InstallationContext
      value={{ installing, busy, error, blocksChanges, install }}
    >
      <div className="flex h-full min-h-0 flex-col">
        {installing && (
          <div className="study-panel" role="status" aria-live="polite">
            {t("UpdateInstalling")}
          </div>
        )}
        <Pending error={error} />
        <div
          className="min-h-0 flex-1"
          inert={installing}
          style={{ visibility: installing ? "hidden" : undefined }}
        >
          {children}
        </div>
      </div>
    </InstallationContext>
  );
}
