import type { NoteDto } from '@study/contracts/notes/schemas';
import { age } from '@study/localization';
import { Button } from '@study/ui/button';
import { useNowMinute } from '@study/ui/clock';
import { IconButton } from '@study/ui/icon-button';
import { Sidebar as SidebarUI } from '@study/ui/sidebar';
import { Spinner } from '@study/ui/spinner';
import { Link } from '@tanstack/react-router';
import {
  FileText,
  MessagesSquare,
  SquareDashed,
  ChevronDown,
  Trash2,
  Merge,
  X
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import {
  NoteMergeDialog,
  NotePageDialog,
  NoteBatchDeleteDialog
} from '#client/features/note-workspace/index.ts';
import type { SelectedNote } from '#client/features/note-workspace/index.ts';
import { SubjectIdentity } from '#client/features/subjects/index.ts';
import { useI18n } from '#client/lib/i18n.tsx';
import { useWorkspacePreferences } from '#client/lib/study-client/workspace-preferences.queries.ts';

import { useSidebarProgress, useNoteSettlement } from './rich-sidebar.queries';
import { SidebarNoteActions } from './sidebar-note-actions';
import { SidebarNoteDrafts } from './sidebar-note-drafts';
import type { SidebarModel } from './use-sidebar';

type Props = Pick<SidebarModel, 'project' | 'subjects' | 'notes'> & {
  selectedNote: string | null;
};

type Progress = NonNullable<
  ReturnType<typeof useSidebarProgress>['progress']['data']
>['items'][number];

/** Groups notes using persisted overrides, page counts, and running work. */

export function RichSidebarNotes(props: Props) {
  return <SidebarNoteList key={String(props.project)} {...props} />;
}

function SidebarNoteList(props: Props) {
  const { t } = useI18n();
  const { settings, progress } = useSidebarProgress();
  const selectionToolbar = useRef<HTMLDivElement>(null);
  const noteRows = useRef<HTMLDivElement>(null);
  const selectionOrigin = useRef<string | undefined>(undefined);
  const [selected, setSelected] = useState<SelectedNote[] | null>(null);
  const [action, setAction] = useState<{
    kind: 'page' | 'delete' | 'merge';
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
  const threshold = settings.data?.settledPageThreshold ?? 1;
  const summaries = new Map(progress.data?.items.map((item) => [String(item.id), item]));
  const settled = (note: NoteDto) => {
    const summary = summaries.get(String(note.id));

    return (
      !!summary &&
      !summary.running &&
      (summary.settledOverride ?? summary.generatedPageCount >= BigInt(threshold))
    );
  };
  const archived = props.notes.filter((note) => note.archivedAt != null);
  const open = props.notes.filter((note) => note.archivedAt == null && !settled(note));
  const complete = props.notes.filter((note) => note.archivedAt == null && settled(note));

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
            aria-label={t('NoteCreatePage')}
            title={t('NoteCreatePage')}
            disabled={!selected.length}
            onClick={() => setAction({ kind: 'page', notes: [...selected] })}
          >
            <FileText aria-hidden="true" />
            {t('NoteCreatePage')}
          </Button>
          <Button
            size="sm"
            aria-label={t('NoteMerge')}
            title={t('NoteMerge')}
            disabled={!canMergeNotes(selected, props.notes)}
            onClick={() => setAction({ kind: 'merge', notes: [...selected] })}
          >
            <Merge aria-hidden="true" />
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
            <Trash2 aria-hidden="true" />
            <span data-selection-action-label>{t('SidebarDeleteSelected')}</span>
          </Button>
          <IconButton
            size="icon-sm"
            variant="ghost-muted"
            label={t('Cancel')}

            onClick={() => setSelected(null)}
          >
            <X aria-hidden="true" />
          </IconButton>
        </SidebarUI.SelectionBar>
      )}
      <SidebarUI.NoteGroups ref={noteRows}>
        <SidebarNoteDrafts project={props.project} subjects={props.subjects} />
        <SidebarUI.NoteGroup title={t('SidebarOpen')} count={open.length} defaultOpen>
          {open.map((note) => (
            <RichNote
              key={String(note.id)}
              {...props}
              note={note}
              progress={summaries.get(String(note.id))}
              settled={false}
              selection={selection}
            />
          ))}
        </SidebarUI.NoteGroup>
        <SettledNotes
          key={String(props.project)}
          {...props}
          notes={complete}
          summaries={summaries}
          selection={selection}
        />
        {archived.length > 0 && (
          <SidebarUI.NoteGroup title={t('NoteArchived')} count={archived.length} variant="settled">
            {archived.map((note) => (
              <RichNote
                key={String(note.id)}
                {...props}
                note={note}
                progress={summaries.get(String(note.id))}
                settled
                selection={selection}
              />
            ))}
          </SidebarUI.NoteGroup>
        )}
      </SidebarUI.NoteGroups>
      <MergeAction
        action={action}
        onClose={() => setAction(null)}
        onMerged={() => setSelected(null)}
      />
      {action?.kind === 'page' && action.notes[0] && (
        <NotePageDialog
          id={action.notes[0].id}
          notes={action.notes}
          open
          onOpenChange={(open) => {
            if (!open) setAction(null);
          }}
        />
      )}
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

/** Keeps completed work scannable while revealing older notes in deliberate batches. */

function SettledNotes(
  props: Props & { summaries: Map<string, Progress>; selection: SelectionControls }
) {
  const { t } = useI18n();
  const [visible, setVisible] = useState(10);
  const notes = props.notes.toSorted((a, b) =>
    a.updatedAt === b.updatedAt ? 0 : a.updatedAt > b.updatedAt ? -1 : 1
  );
  const more = Math.min(25, Math.max(0, notes.length - visible));

  return (
    <SidebarUI.NoteGroup title={t('SidebarSettled')} count={notes.length} variant="settled">
      <SidebarUI.SettledRows>
        {notes.slice(0, visible).map((note) => (
          <RichNote
            key={String(note.id)}
            {...props}
            note={note}
            progress={props.summaries.get(String(note.id))}
            settled
          />
        ))}
      </SidebarUI.SettledRows>
      {more > 0 && (
        <SidebarUI.NoteMore onClick={() => setVisible((count) => count + 25)}>
          <ChevronDown aria-hidden="true" />
          {t('SidebarShowMore', { count: more })}
        </SidebarUI.NoteMore>
      )}
    </SidebarUI.NoteGroup>
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
  settled: boolean;
  selection: SelectionControls;
};

/** Keeps settlement actions separate from navigation and disabled during active work. */

function RichNote(props: RowProps) {
  return (
    <SidebarUI.NoteEntry
      data-settled={props.settled || undefined}
      data-selecting={props.selection.items !== null || undefined}
    >
      <NoteLink {...props} />
      <NoteControls {...props} />
    </SidebarUI.NoteEntry>
  );
}

function canConvertNote({ settled, progress }: RowProps) {
  return !settled && progress?.activity !== 'generating';
}

function NoteControls(props: RowProps) {
  const { t } = useI18n();
  const settlement = useNoteSettlement(props.note.id);
  const preferences = useWorkspacePreferences();
  const [pageOpen, setPageOpen] = useState(false);
  const blocked = settlement.isPending || !!props.progress?.running;
  const pageAction = canConvertNote(props) ? (
    <SidebarUI.SettleAction disabled={blocked} onClick={() => setPageOpen(true)}>
      {t('SidebarTurnIntoPage')}
    </SidebarUI.SettleAction>
  ) : null;

  return (
    <>
      {!props.selection.items && props.note.archivedAt == null && (
        <NoteActionLayout
          compact={preferences.sidebarDensity === 'compact'}
          pageAction={pageAction}
        >
          <SidebarUI.SettleAction
            disabled={blocked}
            onClick={() => settlement.mutate(!props.settled)}
          >
            {t(props.settled ? 'SidebarReopen' : 'SidebarSettle')}
          </SidebarUI.SettleAction>
        </NoteActionLayout>
      )}
      {pageOpen && (
        <NotePageDialog
          id={props.note.id}
          notes={[{ id: props.note.id, title: props.note.title }]}
          open={pageOpen}
          onOpenChange={setPageOpen}
        />
      )}
      {settlement.error && (
        <SidebarUI.Message role="alert">{t('SidebarSettlementError')}</SidebarUI.Message>
      )}
    </>
  );
}

function NoteActionLayout({
  compact,
  pageAction,
  children
}: {
  compact: boolean;
  pageAction: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      {!compact && pageAction && <SidebarUI.NoteRowActions>{pageAction}</SidebarUI.NoteRowActions>}
      <SidebarUI.NoteRowActions placement="top">
        {compact && pageAction}
        {children}
      </SidebarUI.NoteRowActions>
    </>
  );
}

/** Renders subject identity, selection, and progress for one note destination. */

function NoteLink({
  note,
  project,
  subjects,
  selectedNote,
  progress,
  settled,
  selection
}: RowProps) {
  const { t } = useI18n();
  const preferences = useWorkspacePreferences();
  const owner = subjects.find(
    (item) =>
      note.projectIds.includes(item.id) && (item.id === project || note.projectIds[0] === item.id)
  );

  return (
    <SidebarNoteActions
      id={note.id}
      project={project ? String(project) : undefined}
      onSelect={() => selection.start(note)}
    >
      <SidebarUI.Item
        layout={
          settled ? 'summary' : preferences.sidebarDensity === 'compact' ? 'compact' : 'detailed'
        }
        label={note.title}
        data-note-id={String(note.id)}
        context={owner?.name ?? t('Notes')}
        icon={<NoteRowIcon owner={owner} settled={settled} />}
        timestamp={<NoteTime at={note.updatedAt} />}
        selection={selection.items?.some((item) => item.id === note.id)}
        description={settled ? undefined : <NoteProgress progress={progress} />}
        aria-label={note.title}
        aria-current={selectedNote === String(note.id) ? 'page' : undefined}
        title={note.title}
        render={noteDestination(note, project, selection)}
      />
    </SidebarNoteActions>
  );
}

function NoteRowIcon({
  owner,
  settled
}: {
  owner: Props['subjects'][number] | undefined;
  settled: boolean;
}) {
  if (owner) return <SubjectIdentity name={owner.name} icon={owner.icon} />;

  return settled ? <SquareDashed aria-hidden="true" /> : <MessagesSquare aria-hidden="true" />;
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

/** Shows workflow activity and retained generated-page counts. */

function NoteProgress({ progress }: { progress?: Progress }) {
  const { t } = useI18n();
  const preferences = useWorkspacePreferences();
  const labels = {
    idle: 'SidebarReady',
    generating: 'SidebarGenerating',
    processing: 'SidebarProcessing',
    answering: 'SidebarWriting'
  } as const;
  const label = progress ? labels[progress.activity] : 'SidebarStatusUnavailable';

  return (
    <>
      <SidebarUI.NoteActivity running={progress?.running} title={t(label)}>
        {progress?.running && <Spinner size="xs" label={t(label)} aria-hidden="true" />}
        <span>{t(label)}</span>
      </SidebarUI.NoteActivity>
      {preferences.sidebarShowPageCounts && <NotePageCount progress={progress} />}
    </>
  );
}

/** Reuses the page count in both detailed and compact note rows. */

function NotePageCount({ progress }: { progress?: Progress }) {
  const { t } = useI18n();

  return (
    <SidebarUI.NoteCount title={t('SidebarGeneratedPages')}>
      <FileText size={12} aria-hidden="true" />
      {progress ? String(progress.generatedPageCount) : '—'}
    </SidebarUI.NoteCount>
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
  action: { kind: 'page' | 'delete' | 'merge'; notes: SelectedNote[] } | null;
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
