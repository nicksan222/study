import { Sidebar } from '@study/ui/sidebar';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useNavigate, useSearch } from '@tanstack/react-router';
import { SquarePen, X } from 'lucide-react';

import {
  startDraftsOptions,
  startDraftKey,
  dismissStartDraft,
  startDraftOptions,
  startFilesOptions,
  creationFlowOptions
} from '#client/features/note-workspace/index.ts';
import { SubjectIdentity } from '#client/features/subjects/index.ts';
import { useI18n } from '#client/lib/i18n.tsx';

import type { SidebarModel } from './use-sidebar';

type Props = Pick<SidebarModel, 'project' | 'subjects'>;

/** Unsent work stays above saved notes, scoped like the rest of the sidebar. */
export function SidebarNoteDrafts({ project, subjects }: Props) {
  const drafts = useQuery(startDraftsOptions());
  const scopes = drafts.data.filter((scope) => !project || scope === String(project));

  if (!scopes.length) return null;

  return scopes.map((scope) => <DraftRow key={scope} scope={scope} subjects={subjects} />);
}

function DraftRow({ scope, subjects }: { scope: string; subjects: Props['subjects'] }) {
  const { t } = useI18n();
  const cache = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const search = useSearch({ from: '__root__' });
  const project = scope === 'unassigned' ? undefined : scope;
  const draft = useQuery(startDraftOptions(startDraftKey(project)));
  const files = useQuery(startFilesOptions([...startDraftKey(project), 'files']));
  const flow = useQuery(creationFlowOptions());
  const owner = subjects.find((subject) => String(subject.id) === project);
  const active = /^\/notes\/?$/.test(location.pathname) && search.project === project;
  const label = draftLabel(draft.data, files.data, t('NewNote'));
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
            <SquarePen aria-hidden="true" />
          )
        }
        description={t('SidebarDraft')}
        aria-label={label}
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
          <X aria-hidden="true" />
        </Sidebar.SettleAction>
      </Sidebar.NoteRowActions>
    </Sidebar.NoteEntry>
  );
}

function draftLabel(text: string, files: File[], fallback: string) {
  return text.trim().split('\n')[0] || files[0]?.name || fallback;
}
