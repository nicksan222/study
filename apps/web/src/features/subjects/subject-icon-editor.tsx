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
import { IdentityEditor } from '@study/ui/identity-editor';
import { Input } from '@study/ui/input';
import { Label } from '@study/ui/label';
import { toastManager } from '@study/ui/toast';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Schema } from 'effect';
import { Pencil } from 'lucide-react';
import { useId, useRef, useState } from 'react';

import { useI18n } from '../../lib/i18n';
import { subjectIconMutationOptions } from './subject-icon-editor.queries';
import { subjectColors, subjectSymbols } from './subject-icon-options';
import { SubjectIdentity } from './subject-identity';

/** Persists the canonical icon before refreshing every subject presentation. */
function useSubjectIconMutation(project: Project, onSaved: () => void) {
  const { t } = useI18n();
  const cache = useQueryClient();

  return useMutation({
    ...subjectIconMutationOptions(project.id),
    onSuccess: (updated) => {
      cache.setQueryData(['projects', 'collection', String(project.id)], updated);
      void cache.invalidateQueries({ queryKey: ['projects'] });
      toastManager.add({ title: t('SubjectIconSaved'), type: 'success' });
      onSaved();
    }
  });
}

/** Retains per-mode choices locally while sharing the selected accent across modes. */
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

/** Validates the complete icon draft and prevents dismissal during its save. */
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
      <DialogPopup closeLabel={t('Close')} variant="identity">
        <DialogHeader>
          <DialogTitle>{t('SubjectIconTitle')}</DialogTitle>
          <DialogDescription>{t('SubjectIconHelp')}</DialogDescription>
        </DialogHeader>
        <IdentityEditor.Form
          id={field}
          onSubmit={(event) => {
            event.preventDefault();

            if (!mutation.isPending && valid && !unchanged) mutation.mutate(icon);
          }}
        >
          <IdentityEditor.Preview>
            <SubjectIdentity name={project.name} icon={valid ? icon : project.icon} size="large" />
            <IdentityEditor.Name>{project.name}</IdentityEditor.Name>
          </IdentityEditor.Preview>
          <IdentityEditor.Modes label={t('SubjectIconMode')}>
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
          </IdentityEditor.Modes>
          <IdentityEditor.Field>
            <Label>{t('SubjectIconColor')}</Label>
            <IconChoices
              label={t('SubjectIconColor')}
              variant="colors"
              value={icon.color}
              disabled={mutation.isPending}
              options={projectIconColors.map((color) => ({
                value: color,
                label: t(subjectColors[color]),
                content: <IdentityEditor.Color color={color} />
              }))}
              onValueChange={(color) => setIcon({ ...icon, color })}
            />
          </IdentityEditor.Field>
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
        </IdentityEditor.Form>
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

/** Searches localized symbol names without changing the stable symbol values sent to storage. */
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
    <IdentityEditor.Choices>
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
      {!options.length && <IdentityEditor.Empty>{t('SearchNoResults')}</IdentityEditor.Empty>}
    </IdentityEditor.Choices>
  );
}

/** Separates title-derived initials from explicitly saved Unicode letters. */
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
    <IdentityEditor.Choices>
      <IdentityEditor.Modes label={t('SubjectIconMonogram')}>
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
      </IdentityEditor.Modes>
      {!automatic && (
        <IdentityEditor.Field>
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
          <IdentityEditor.Help id={field + '-help'}>
            {t('SubjectIconLettersHelp')}
          </IdentityEditor.Help>
        </IdentityEditor.Field>
      )}
    </IdentityEditor.Choices>
  );
}

/** Starts a fresh icon draft for the reviewed subject whenever the chooser opens. */
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
