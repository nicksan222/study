import { rpc } from '@study/contracts/react';
import { useEffect, useEffectEvent } from 'react';

import { AiModelSettingsView, AiAccountSettingsView } from './ai.view';
import { useAiSettings } from './use-ai-settings';

export function AiModelSettings() {
  const model = useAiSettings();
  const request = rpc.settings.refreshModelCatalog.useMutation();
  const refresh = () => {
    void request.mutate({}).catch(() => undefined);
  };
  const onOpen = useEffectEvent(refresh);

  useEffect(() => {
    onOpen();
  }, []);

  return (
    <AiModelSettingsView
      model={model}
      refreshFailed={
        request.isError ||
        request.data?.apiAvailable === false ||
        request.data?.chatAvailable === false
      }
      refreshing={request.isPending}
      retryRefresh={() => {
        model.retryCatalog();
        refresh();
      }}
    />
  );
}

/** Shares the complete sign-in lifecycle without exposing model tuning during first run. */
export function AiAccountSettings({ showHeading = true }: { showHeading?: boolean }) {
  return <AiAccountSettingsView model={useAiSettings()} showHeading={showHeading} />;
}
