import type { AppSettings } from '@study/contracts';
import { rpc } from '@study/contracts/react';
import { useState } from 'react';

type AppSettingsPatch = Partial<
  Pick<AppSettings, 'language' | 'appearance' | 'zoomPercent' | 'onboarded'>
>;

/** Partial preference edits reread immediately so unrelated committed fields are preserved. */
export function useAppSettingsPatch() {
  const save = rpc.settings.saveAppSettings.useMutation();
  const [reads, setReads] = useState(0);
  const [failedRead, setFailedRead] = useState(false);
  const mutateAsync = async (patch: AppSettingsPatch) => {
    setReads((count) => count + 1);
    setFailedRead(false);
    let current: AppSettings;

    try {
      current = await rpc.settings.appSettings.read({});
    } catch (error) {
      setFailedRead(true);

      throw error;
    } finally {
      setReads((count) => count - 1);
    }

    return save.mutateAsync({ ...current, ...patch });
  };

  return {
    ...save,
    mutateAsync,
    isPending: reads > 0 || save.isPending,
    isError: failedRead || save.isError,
    reset: () => {
      setFailedRead(false);
      save.reset();
    }
  };
}
