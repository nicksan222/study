import { RegistryContext, useAtomValue } from '@effect/atom-react';
import { CreateNoteIcon, CloseIcon } from '@study/icons';
import { Sidebar } from '@study/ui';
import { Link, useLocation, useNavigate, useSearch } from '@tanstack/react-router';
import { useContext } from 'react';

import {
  startDrafts,
  startDraftKey,
  dismissStartDraft,
  startDraft,
  creationFlow
} from '#client/features/note-workspace/index.ts';
import { SubjectIdentity } from '#client/features/subjects/index.ts';
import { useI18n } from '#client/lib/i18n.tsx';

import type { SidebarModel } from './use-sidebar';

type Props = Pick<SidebarModel, 'project' | 'subjects'>;

/** Unsent work stays above saved notes, scoped like the rest of the sidebar. */
export function SidebarNoteDrafts({ project, subjects }: Props) {
  const drafts = { data: useAtomValue(startDrafts) };
  const scopes = drafts.data.filter((scope) => !project || scope === String(project));

  if (!scopes.length) return null;

  return scopes.map((scope) => <DraftRow key={scope} scope={scope} subjects={subjects} />);
}

function DraftRow({ scope, subjects }: { scope: string; subjects: Props['subjects'] }) {
  const { t } = useI18n();
  const cache = useContext(RegistryContext);
  const navigate = useNavigate();
  const location = useLocation();
  const search = useSearch({ from: '__root__' });
  const project = scope === 'unassigned' ? undefined : scope;
  const draft = { data: useAtomValue(startDraft(startDraftKey(project))) };
  const flow = { data: useAtomValue(creationFlow) };
  const owner = subjects.find((subject) => String(subject.id) === project);
  const active = /^\/notes\/?$/.test(location.pathname) && search.project === project;
  const label = draft.data.trim().split('\n')[0] || t('NewNote');
  const blocked = [flow.data.pending, flow.data.uncertain, flow.data.id].some(Boolean);

  return (
    <Sidebar.NoteEntry>
      <Sidebar.Item
        label={label}
        context={owner?.name ?? t('Notes')}
        icon={
          owner ? (
            <SubjectIdentity name={owner.name} icon={owner.icon} />
          ) : (
            <CreateNoteIcon aria-hidden="true" />
          )
        }
        description={t('SidebarDraft')}
        aria-current={active ? 'page' : undefined}
        title={label}
        render={<Link to="/notes" search={project ? { project } : {}} />}
      />
      <Sidebar.NoteRowActions>
        <Sidebar.SettleAction
          aria-label={t('SidebarDismissDraft')}
          title={t('SidebarDismissDraft')}
          disabled={blocked}
          onClick={() => {
            dismissStartDraft(cache, project);

            if (active) void navigate({ to: '/notes', search: project ? { project } : {} });
          }}
        >
          <CloseIcon aria-hidden="true" />
        </Sidebar.SettleAction>
      </Sidebar.NoteRowActions>
    </Sidebar.NoteEntry>
  );
}
