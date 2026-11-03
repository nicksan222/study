import { Button } from '@study/ui/button';
import { DialogFooter, DialogClose } from '@study/ui/dialog';

import { useI18n } from '../../lib/i18n';

export function DescriptionFooter({
  pending,
  disabled = false
}: {
  pending: boolean;
  disabled?: boolean;
}) {
  const { t } = useI18n();

  return (
    <DialogFooter>
      <DialogClose render={<Button variant="outline" />} disabled={pending}>
        {t('Cancel')}
      </DialogClose>
      <Button type="submit" disabled={pending || disabled}>
        {t(pending ? 'SessionSaving' : 'Save')}
      </Button>
    </DialogFooter>
  );
}
