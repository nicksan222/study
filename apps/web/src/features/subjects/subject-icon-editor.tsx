import type { Project, ProjectIcon } from '@study/contracts/projects/schemas';
import {
  projectInitials,
  projectIconSchema,
  projectIconColors,
  projectSymbols,
  projectEmojis
} from '@study/contracts/projects/schemas';
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
import { IconChoices } from '@study/ui/icon-choices';
import { Input } from '@study/ui/input';
import { Label } from '@study/ui/label';
import { toastManager } from '@study/ui/toast';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Schema } from 'effect';
import { Pencil } from 'lucide-react';
import { useId, useRef, useState } from 'react';

import { useI18n } from '../../lib/i18n';
import { request } from '../../lib/study-client/request';
import { subjectColors, subjectSymbols } from './subject-icon-options';
import { SubjectIdentity } from './subject-identity';

function useSubjectIconMutation(project: Project, onSaved: () => void) {
  const { t } = useI18n();
  const cache = useQueryClient();
  return useMutation({
    mutationKey: ['subject-icon', String(project.id)],
    mutationFn: (icon: ProjectIcon) =>
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

function useIconDraft(project: Project) {
  const [icon, setIcon] = useState<ProjectIcon>(project.icon);
  const [mode, setMode] = useState<'symbol' | 'emoji' | 'monogram'>(
    project.icon.kind === 'automatic' ? 'monogram' : project.icon.kind
  );
  const [letters, setLetters] = useState(
    project.icon.kind === 'monogram' ? project.icon.value : projectInitials(project.name)
  );
  const [search, setSearch] = useState('');
  const remembered = useRef<Partial<Record<typeof mode, ProjectIcon>>>({});
  const valid = Schema.is(projectIconSchema)(icon);
  const unchanged =
    icon.kind === project.icon.kind &&
    icon.color === project.icon.color &&
    (icon.kind === 'automatic' ||
      (project.icon.kind !== 'automatic' && icon.value === project.icon.value));
  function changeMode(next: typeof mode) {
    if (next === mode) return;
    remembered.current[mode] = icon;
    setMode(next);
    setSearch('');
    const previous = remembered.current[next];
    if (previous) {
      setIcon({ ...previous, color: icon.color });
      return;
    }
    if (next === 'symbol')
      setIcon({
        kind: 'symbol',
        value: project.icon.kind === 'symbol' ? project.icon.value : 'book',
        color: icon.color
      });
    else if (next === 'emoji')
      setIcon({
        kind: 'emoji',
        value: project.icon.kind === 'emoji' ? project.icon.value : '📚',
        color: icon.color
      });
    else setIcon({ kind: 'automatic', color: icon.color });
  }
  return {
    icon,
    setIcon,
    mode,
    letters,
    setLetters,
    search,
    setSearch,
    valid,
    unchanged,
    changeMode
  };
}

function SubjectIconDialog({
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
  const {
    icon,
    setIcon,
    mode,
    letters,
    setLetters,
    search,
    setSearch,
    valid,
    unchanged,
    changeMode
  } = useIconDraft(project);
  const mutation = useSubjectIconMutation(project, () => onOpenChange(false));
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!mutation.isPending) onOpenChange(next);
      }}
    >
      <DialogPopup closeLabel={t('Close')} className="ui-identity-dialog">
        <DialogHeader>
          <DialogTitle>{t('SubjectIconTitle')}</DialogTitle>
          <DialogDescription>{t('SubjectIconHelp')}</DialogDescription>
        </DialogHeader>
        <form
          id={field}
          className="space-y-5 px-6 pb-6"
          onSubmit={(event) => {
            event.preventDefault();
            if (!mutation.isPending && valid && !unchanged) mutation.mutate(icon);
          }}
        >
          <div className="flex items-center gap-3">
            <SubjectIdentity name={project.name} icon={valid ? icon : project.icon} size="large" />
            <span className="min-w-0 break-words text-sm font-medium">{project.name}</span>
          </div>
          <div role="group" aria-label={t('SubjectIconMode')} className="flex flex-wrap gap-1">
            {(['symbol', 'emoji', 'monogram'] as const).map((value) => (
              <Button
                key={value}
                variant={mode === value ? 'secondary' : 'ghost-muted'}
                size="sm"
                aria-pressed={mode === value}
                disabled={mutation.isPending}
                onClick={() => changeMode(value)}
              >
                {t(
                  value === 'symbol'
                    ? 'SubjectIconSymbols'
                    : value === 'emoji'
                      ? 'SubjectIconEmojis'
                      : 'SubjectIconMonogram'
                )}
              </Button>
            ))}
          </div>
          <div className="space-y-2">
            <Label>{t('SubjectIconColor')}</Label>
            <IconChoices
              label={t('SubjectIconColor')}
              variant="colors"
              value={icon.color}
              disabled={mutation.isPending}
              options={projectIconColors.map((color) => ({
                value: color,
                label: t(subjectColors[color]),
                content: <span className="ui-icon-color" data-color={color} />
              }))}
              onValueChange={(color) => setIcon({ ...icon, color })}
            />
          </div>
          {mode === 'symbol' && (
            <SymbolChoices
              project={project}
              icon={icon}
              search={search}
              onSearch={setSearch}
              onChange={setIcon}
              disabled={mutation.isPending}
            />
          )}
          {mode === 'emoji' && (
            <IconChoices
              label={t('SubjectIconEmojis')}
              value={icon.kind === 'emoji' ? icon.value : undefined}
              disabled={mutation.isPending}
              options={projectEmojis.map((value) => ({
                value,
                label: `${t('SubjectIconEmojiLabel')} ${value}`,
                content: <span aria-hidden="true">{value}</span>
              }))}
              onValueChange={(value) => setIcon({ kind: 'emoji', value, color: icon.color })}
            />
          )}
          {mode === 'monogram' && (
            <MonogramChoices
              field={field}
              icon={icon}
              letters={letters}
              disabled={mutation.isPending}
              onChange={setIcon}
              onLetters={setLetters}
            />
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
          <Button
            variant="outline"
            disabled={mutation.isPending}
            onClick={() => onOpenChange(false)}
          >
            {t('Cancel')}
          </Button>
          <Button type="submit" form={field} disabled={mutation.isPending || !valid || unchanged}>
            {t('Save')}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function SymbolChoices({
  project,
  icon,
  search,
  onSearch,
  onChange,
  disabled
}: {
  project: Project;
  icon: ProjectIcon;
  search: string;
  onSearch: (value: string) => void;
  onChange: (icon: ProjectIcon) => void;
  disabled: boolean;
}) {
  const { t } = useI18n();
  const options = projectSymbols.filter((value) =>
    t(subjectSymbols[value].label).toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
  );
  return (
    <div className="space-y-3">
      <Input
        aria-label={t('SubjectIconSearch')}
        placeholder={t('SubjectIconSearch')}
        value={search}
        disabled={disabled}
        onChange={(event) => onSearch(event.target.value)}
      />
      <IconChoices
        label={t('SubjectIconSymbols')}
        value={icon.kind === 'symbol' ? icon.value : undefined}
        disabled={disabled}
        options={options.map((value) => ({
          value,
          label: t(subjectSymbols[value].label),
          content: (
            <SubjectIdentity
              name={project.name}
              icon={{ kind: 'symbol', value, color: icon.color }}
            />
          )
        }))}
        onValueChange={(value) => onChange({ kind: 'symbol', value, color: icon.color })}
      />
      {!options.length && (
        <p role="status" className="text-sm text-muted-foreground">
          {t('SearchNoResults')}
        </p>
      )}
    </div>
  );
}

function MonogramChoices({
  field,
  icon,
  letters,
  disabled,
  onChange,
  onLetters
}: {
  field: string;
  icon: ProjectIcon;
  letters: string;
  disabled: boolean;
  onChange: (icon: ProjectIcon) => void;
  onLetters: (letters: string) => void;
}) {
  const { t } = useI18n();
  const automatic = icon.kind === 'automatic';
  return (
    <div className="space-y-3">
      <div role="group" aria-label={t('SubjectIconMonogram')} className="flex flex-wrap gap-1">
        <Button
          variant={automatic ? 'secondary' : 'ghost-muted'}
          size="sm"
          aria-pressed={automatic}
          disabled={disabled}
          onClick={() => onChange({ kind: 'automatic', color: icon.color })}
        >
          {t('SubjectIconAutomatic')}
        </Button>
        <Button
          variant={!automatic ? 'secondary' : 'ghost-muted'}
          size="sm"
          aria-pressed={!automatic}
          disabled={disabled}
          onClick={() => onChange({ kind: 'monogram', value: letters, color: icon.color })}
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
            disabled={disabled}
            onChange={(event) => {
              const value = event.target.value.normalize('NFC').toLocaleUpperCase('en-US');
              onLetters(value);
              onChange({ kind: 'monogram', value, color: icon.color });
            }}
          />
          <p id={field + '-help'} className="text-xs text-muted-foreground">
            {t('SubjectIconLettersHelp')}
          </p>
        </div>
      )}
    </div>
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
