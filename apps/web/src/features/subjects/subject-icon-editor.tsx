import type { Project } from '@study/contracts/projects/schemas';
import { projectInitials, validProjectIcon } from '@study/contracts/projects/schemas';
import { Button } from '@study/ui/button';
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from '@study/ui/dialog';
import { ErrorState } from '@study/ui/error-state';
import { Input } from '@study/ui/input';
import { Label } from '@study/ui/label';
import { toastManager } from '@study/ui/toast';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Pencil } from 'lucide-react';
import { useId, useState } from 'react';

import { useI18n } from '../../lib/i18n';
import { request } from '../../lib/study-client/request';
import { SubjectIdentity } from './subject-identity';

function useSubjectIconMutation(project: Project, onSaved: () => void) {
  const { t } = useI18n();
  const cache = useQueryClient();
  return useMutation({
    mutationKey: ['subject-icon', String(project.id)],
    mutationFn: (icon: string | null) =>
      request((client) => client['projects.setIcon']({ id: project.id, icon })),
    retry: false,
    onSuccess: (updated) => {
      cache.setQueryData(['projects', 'collection', String(project.id)], updated);
      void cache.invalidateQueries({ queryKey: ['projects'] });
      toastManager.add({ title: t('SubjectIconSaved'), type: 'success' });
      onSaved();
    }
  });
}

export function SubjectIconDialog({
  project,
  open,
  onOpenChange
}: {
  project: Project;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const field = useId();
  const [automatic, setAutomatic] = useState(project.icon == null);
  const [letters, setLetters] = useState(project.icon ?? projectInitials(project.name));
  const mutation = useSubjectIconMutation(project, () => onOpenChange(false));
  const icon = automatic ? null : letters;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup closeLabel={t('Close')}>
        <DialogHeader>
          <DialogTitle>{t('SubjectIconTitle')}</DialogTitle>
          <DialogDescription>{t('SubjectIconHelp')}</DialogDescription>
        </DialogHeader>
        <form
          id={field}
          className="space-y-5 px-6 pb-6"
          onSubmit={(event) => {
            event.preventDefault();
            if (!mutation.isPending && (automatic || validProjectIcon(letters)))
              mutation.mutate(icon);
          }}
        >
          <div className="flex items-center gap-4">
            <SubjectIdentity name={project.name} icon={icon} size="large" />
            <span className="min-w-0 break-words text-sm font-medium">{project.name}</span>
          </div>
          <div role="group" aria-label={t('SubjectIconMode')} className="flex gap-1">
            <Button
              variant={automatic ? 'secondary' : 'ghost-muted'}
              size="sm"
              aria-pressed={automatic}
              disabled={mutation.isPending}
              onClick={() => setAutomatic(true)}
            >
              {t('SubjectIconAutomatic')}
            </Button>
            <Button
              variant={!automatic ? 'secondary' : 'ghost-muted'}
              size="sm"
              aria-pressed={!automatic}
              disabled={mutation.isPending}
              onClick={() => setAutomatic(false)}
            >
              {t('SubjectIconCustom')}
            </Button>
          </div>
          {!automatic && (
            <div className="space-y-2">
              <Label htmlFor={field + '-letters'}>{t('SubjectIconLetters')}</Label>
              <Input
                id={field + '-letters'}
                value={letters}
                autoComplete="off"
                maxLength={24}
                aria-describedby={field + '-help'}
                disabled={mutation.isPending}
                onChange={(event) =>
                  setLetters(event.target.value.normalize('NFC').toLocaleUpperCase('en-US'))
                }
              />
              <p id={field + '-help'} className="text-xs text-muted-foreground">
                {t('SubjectIconLettersHelp')}
              </p>
            </div>
          )}
          {mutation.error && (
            <ErrorState
              layout="inline"
              title={t('SubjectIconSaveFailed')}
              description={t('SubjectIconSaveRetry')}
            />
          )}
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('Cancel')}
          </Button>
          <Button
            type="submit"
            form={field}
            disabled={
              mutation.isPending ||
              (!automatic && !validProjectIcon(letters)) ||
              icon === project.icon
            }
          >
            {t('Save')}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

export function SubjectIconEditor({
  project,
  disabled = false
}: {
  project: Project;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost-muted" size="sm" disabled={disabled} onClick={() => setOpen(true)}>
        <Pencil size={14} aria-hidden="true" />
        {t('SubjectIconChange')}
      </Button>
      {open && <SubjectIconDialog project={project} open onOpenChange={setOpen} />}
    </>
  );
}
