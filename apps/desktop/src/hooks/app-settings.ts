import { useContext } from "react";
import { InstallationContext } from "./installation-state";
import { useI18n } from "../i18n";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { AppSettings } from "../generated/study_pb";
import { rpc } from "../rpc/client";

type SettingsPatch = Partial<
  Pick<AppSettings, "language" | "appearance" | "zoomPercent" | "onboarded">
>;
type SettingsChange = SettingsPatch | ((current: AppSettings) => SettingsPatch);

// All app preference writers share one queue, including shortcuts and onboarding.
// Read inside the queue so a stale render or refetch cannot replace another change.
export function useSaveAppSettings() {
  const client = useQueryClient();
  const installation = useContext(InstallationContext);
  const { t } = useI18n();
  return useMutation({
    scope: { id: "app-settings" },
    mutationFn: async (change: SettingsChange) => {
      if (installation?.blocksChanges()) throw new Error(t("UpdateBusy"));
      const current = await rpc.getAppSettings({});
      const patch = typeof change === "function" ? change(current) : change;
      await rpc.saveAppSettings({ ...current, ...patch });
    },
    onSuccess: () => client.invalidateQueries(),
  });
}
