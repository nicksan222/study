import { rpc } from '@study/contracts/react';
import { useEffect, useEffectEvent } from 'react';

import { AiModelSettingsView, AiAccountSettingsView } from './ai.view';
import { useAiSettings } from './use-ai-settings';

export function AiModelSettings() {
  const model = useAiSettings();
  const { mutate } = rpc.settings.refreshModelCatalog.useMutation();
  const refresh = useEffectEvent(() => {
    void mutate({}).catch(() => undefined);
  });

  useEffect(() => {
    refresh();
  }, []);

  return <AiModelSettingsView model={model} />;
}

/** Shares the complete sign-in lifecycle without exposing model tuning during first run. */
export function AiAccountSettings({ showHeading = true }: { showHeading?: boolean }) {
  return <AiAccountSettingsView model={useAiSettings()} showHeading={showHeading} />;
}
