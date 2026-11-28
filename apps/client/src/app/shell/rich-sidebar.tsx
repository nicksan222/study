import type { NoteDto, noteSummariesSchema } from '@study/contracts';
import { rpc } from '@study/contracts/react';
import { NoteIcon, DeleteIcon, MergeIcon, CloseIcon, PageIcon } from '@study/icons';
import { age } from '@study/localization';
import { Button, useNowMinute, IconButton, Sidebar as SidebarUI, Spinner } from '@study/ui';
import { Link } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';

import { NoteMergeDialog, NoteBatchDeleteDialog } from '#client/features/note-workspace/index.ts';
import type { SelectedNote } from '#client/features/note-workspace/index.ts';
import { useI18n } from '#client/lib/i18n.tsx';
import { useWorkspacePreferences } from '#client/lib/study-client/workspace-preferences.queries.ts';

import { SidebarNoteActions } from './sidebar-note-actions';
import { SidebarNoteDrafts } from './sidebar-note-drafts';
import type { SidebarModel } from './use-sidebar';

type Props = Pick<SidebarModel, 'project' | 'subjects' | 'notes'> & {
  selectedNote: string | null;
};

type Progress = (typeof noteSummariesSchema.Type)['items'][number];

export function RichSidebarNotes(props: Props) {
  return <SidebarNoteList key={String(props.project)} {...props} />;
}

function SidebarNoteList(props: Props) {
  const { t } = useI18n();
  const progress = rpc.notes.noteSummaries.useQuery({});
  const summaries = new Map(progress.data?.items.map((item) => [item.id, item]));
  const selectionToolbar = useRef<HTMLDivElement>(null);
  const noteRows = useRef<HTMLDivElement>(null);
  const selectionOrigin = useRef<string | undefined>(undefined);
  const [selected, setSelected] = useState<SelectedNote[] | null>(null);
  const [action, setAction] = useState<{
    kind: 'delete' | 'merge';
    notes: SelectedNote[];
  } | null>(null);
  const selection: SelectionControls = {
    items: selected,
    start: (note) => {
      selectionOrigin.current = String(note.id);
      setSelected([{ id: note.id, title: note.title }]);
    },
    toggle: (note) =>
      setSelected((current) => {
        const items = current ?? [];

        return items.some((item) => item.id === note.id)
          ? items.filter((item) => item.id !== note.id)
          : [...items, { id: note.id, title: note.title }];
      })
  };
  const selecting = selected !== null;

  useEffect(() => {
    if (selecting) selectionToolbar.current?.focus();
    else if (selectionOrigin.current) {
      noteRows.current
        ?.querySelector<HTMLElement>(`[data-note-id="${selectionOrigin.current}"]`)
        ?.focus();
    }
  }, [selecting]);

  return (
    <>
      {selected && (
        <SidebarUI.SelectionBar
          ref={selectionToolbar}
          tabIndex={-1}
          role="toolbar"
          aria-label={t('SidebarSelectionActions')}
        >
          <SidebarUI.SelectionCount
            count={selected.length}
            label={t('SidebarSelectedCount', { count: selected.length })}
          />
          <Button
            size="sm"
            aria-label={t('NoteMerge')}
            title={t('NoteMerge')}
            disabled={!canMergeNotes(selected, props.notes)}
            onClick={() => setAction({ kind: 'merge', notes: [...selected] })}
          >
            <MergeIcon aria-hidden="true" />
            <span data-selection-action-label>{t('NoteMerge')}</span>
          </Button>
          <Button
            size="sm"
            variant="ghost-destructive"
            aria-label={t('SidebarDeleteSelected')}
            title={t('SidebarDeleteSelected')}
            disabled={!selected.length}
            onClick={() => setAction({ kind: 'delete', notes: [...selected] })}
          >
            <DeleteIcon aria-hidden="true" />
            <span data-selection-action-label>{t('SidebarDeleteSelected')}</span>
          </Button>
          <IconButton
            size="icon-sm"
            variant="ghost-muted"
            label={t('Cancel')}
            onClick={() => setSelected(null)}
          >
            <CloseIcon aria-hidden="true" />
          </IconButton>
        </SidebarUI.SelectionBar>
      )}
      <SidebarUI.NoteRows ref={noteRows}>
        <SidebarNoteDrafts project={props.project} subjects={props.subjects} />
        {props.notes.map((note) => (
          <NoteLink
            key={String(note.id)}
            {...props}
            note={note}
            progress={summaries.get(note.id)}
            selection={selection}
          />
        ))}
      </SidebarUI.NoteRows>
      <MergeAction
        action={action}
        onClose={() => setAction(null)}
        onMerged={() => setSelected(null)}
      />
      {action?.kind === 'delete' && (
        <NoteBatchDeleteDialog
          notes={action.notes}
          open
          onOpenChange={(open) => {
            if (!open) setAction(null);
          }}
          onDeleted={(ids) => {
            setSelected((current) => {
              const remaining = current?.filter((item) => !ids.includes(item.id)) ?? [];

              return remaining.length ? remaining : null;
            });
          }}
        />
      )}
    </>
  );
}

type SelectionControls = {
  items: readonly SelectedNote[] | null;
  start: (note: NoteDto) => void;
  toggle: (note: NoteDto) => void;
};

type RowProps = Props & {
  note: NoteDto;
  progress?: Progress;
  selection: SelectionControls;
};

/** Renders the same note row for each destination, with subject and workflow context. */

function NoteLink({ note, project, subjects, selectedNote, progress, selection }: RowProps) {
  const { t } = useI18n();
  const preferences = useWorkspacePreferences();
  const ownerId = project ?? note.projectIds[0];
  const owner = subjects.find((item) => item.id === ownerId);

  return (
    <SidebarNoteActions
      id={note.id}
      project={project ? String(project) : undefined}
      onSelect={() => selection.start(note)}
    >
      <SidebarUI.Item
        layout={preferences.sidebarDensity === 'compact' ? 'compact' : 'detailed'}
        label={note.title}
        data-note-id={String(note.id)}
        context={owner?.name ?? t('Notes')}
        icon={<NoteIcon aria-hidden="true" />}
        activity={progress?.running ? 'running' : undefined}
        timestamp={<NoteTime at={note.updatedAt} />}
        description={<NoteProgress progress={progress} />}
        selection={selection.items?.some((item) => item.id === note.id)}
        aria-current={selectedNote === String(note.id) ? 'page' : undefined}
        title={note.title}
        render={noteDestination(note, project, selection)}
      />
    </SidebarNoteActions>
  );
}

function noteDestination(note: NoteDto, project: Props['project'], selection: SelectionControls) {
  if (selection.items !== null)
    return <button type="button" aria-label={note.title} onClick={() => selection.toggle(note)} />;

  return (
    <Link
      to="/notes/$noteId"
      params={{ noteId: note.id }}
      search={
        (project ?? note.projectIds[0]) ? { project: String(project ?? note.projectIds[0]) } : {}
      }
    />
  );
}

/** Refreshes the displayed age without changing the stored timestamp. */

function NoteTime({ at }: { at: bigint }) {
  const { locale, date } = useI18n();
  const now = useNowMinute();
  const preferences = useWorkspacePreferences();

  return (
    <time dateTime={new Date(Number(at) * 1000).toISOString()} title={date(at)}>
      {preferences.sidebarTimeFormat === 'absolute' ? date(at) : age(locale, now - Number(at))}
    </time>
  );
}

function NoteProgress({ progress }: { progress?: Progress }) {
  const { t } = useI18n();

  if (!progress || (!progress.running && progress.generatedPageCount === 0n))
    return t('NoteEntryNote');

  const labels = {
    generating: 'SidebarGenerating',
    processing: 'SidebarProcessing',
    answering: 'SidebarWriting'
  } as const;
  const label = progress.activity === 'idle' ? undefined : t(labels[progress.activity]);

  return (
    <>
      {label && (
        <SidebarUI.NoteActivity title={label}>
          <Spinner size="xs" label={label} aria-hidden="true" />
          <span>{label}</span>
        </SidebarUI.NoteActivity>
      )}
      {progress.generatedPageCount > 0n && (
        <SidebarUI.NoteCount title={t('SidebarGeneratedPages')}>
          <PageIcon size={12} aria-hidden="true" />
          {String(progress.generatedPageCount)}
        </SidebarUI.NoteCount>
      )}
    </>
  );
}

function canMergeNotes(selected: readonly SelectedNote[], notes: readonly NoteDto[]) {
  if (selected.length < 2 || selected.length > 20) return false;

  const archived = new Set(notes.filter((note) => note.archivedAt != null).map((note) => note.id));

  return selected.every((note) => !archived.has(note.id));
}

function MergeAction({
  action,
  onClose,
  onMerged
}: {
  action: { kind: 'delete' | 'merge'; notes: SelectedNote[] } | null;
  onClose: () => void;
  onMerged: () => void;
}) {
  if (action?.kind !== 'merge') return null;

  return (
    <NoteMergeDialog
      notes={action.notes}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      onMerged={onMerged}
    />
  );
}
